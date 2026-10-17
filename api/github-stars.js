// /api/github-stars — stargazer count for this repo, fetched from GitHub's
// public REST API without a token (`stargazers_count` is available
// unauthenticated). The edge caches a day of it (see backend-server.js), but a
// self-hosted deployment has no edge and a query string is a new cache key, so
// the answer is also held in process: GitHub is asked at most once per
// ANSWER_TTL_MS (FAILURE_TTL_MS after a failure), whatever the request says —
// far under the 60 req/hour unauthenticated limit the badge shares with every
// other unauthenticated call from this host. GITHUB_TOKEN, when set, is sent as
// a Bearer token (5,000 req/hour, and no shared-IP 403s).
//
// The last count GitHub actually returned is kept — in process and in
// common/github-stars-db/last-good.json, so a restart keeps it — and served
// (with `stale: true`) when GitHub fails, instead of a 500 that hides the badge
// or a fabricated 0. A body without a numeric `stargazers_count` is a failure,
// never a count of zero.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchUpstream } from '../common/fetch-with-timeout.js';
import logger from '../common/logger.js';

const LAST_GOOD_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../common/github-stars-db/last-good.json');
let lastGoodFile = LAST_GOOD_FILE;

// This fork's own repository — reporting the upstream's star count under our
// brand would credit the wrong project.
const REPO = 'shijianus/TrustIP';

const ANSWER_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;

// { status, body, expiresAt } of the last GitHub round trip, and the round trip
// in flight, so concurrent misses share one call.
let held = null;
let inFlight = null;

// { stars, at } of the last successful count, or null.
const readLastGood = (file = lastGoodFile) => {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Number.isInteger(parsed?.stars) && parsed.stars >= 0 ? parsed : null;
    } catch {
        return null;
    }
};
let lastGood = readLastGood();

const writeLastGood = (value) => {
    lastGood = value;
    try {
        fs.mkdirSync(path.dirname(lastGoodFile), { recursive: true });
        fs.writeFileSync(lastGoodFile, `${JSON.stringify(value)}\n`);
    } catch (err) {
        logger.warn({ err }, 'github-stars: could not persist the last good count');
    }
};

// Test hooks: forget the held answer (and, with `lastGood: true`, the last good
// count in memory); point the persisted copy somewhere else (and re-read it).
export const resetGithubStarsCache = ({ lastGood: forget = false } = {}) => {
    held = null;
    inFlight = null;
    if (forget) lastGood = null;
};
export const useLastGoodFile = (file) => {
    lastGoodFile = file || LAST_GOOD_FILE;
    lastGood = readLastGood();
};

const authHeaders = () => (process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {});

const askGithub = async () => {
    try {
        const apiRes = await fetchUpstream(`https://api.github.com/repos/${REPO}`, {
            headers: {
                'Accept': 'application/vnd.github+json',
                ...authHeaders(),
            },
        });

        // A fork's repository is often private, freshly created or simply not
        // announced yet — GitHub answers 404 for all three. That is not a
        // failure: `stars: null` is the "no count to show" answer, and the nav
        // badge renders nothing for it (`formatStarCount(null)` is '').
        // Logged as a warn so a permanently missing repo stays visible in the
        // logs without becoming an alertable error.
        if (apiRes.status === 404) {
            logger.warn({ repo: REPO }, 'github-stars: repository not public yet, hiding the badge');
            return { status: 200, body: { stars: null }, ttl: ANSWER_TTL_MS };
        }

        if (!apiRes.ok) {
            throw new Error(`GitHub API responded ${apiRes.status}`);
        }
        const data = await apiRes.json();
        const stars = data?.stargazers_count;
        if (!Number.isInteger(stars) || stars < 0) throw new Error('GitHub answer carried no stargazers_count');
        writeLastGood({ stars, at: new Date().toISOString() });
        return { status: 200, body: { stars }, ttl: ANSWER_TTL_MS };
    } catch (error) {
        logger.error({ err: error }, 'github-stars handler failed');
        if (lastGood) {
            return { status: 200, body: { stars: lastGood.stars, stale: true, asOf: lastGood.at }, ttl: FAILURE_TTL_MS };
        }
        return { status: 500, body: { error: 'Failed to fetch GitHub stars' }, ttl: FAILURE_TTL_MS };
    }
};

export default async (req, res) => {
    // Defensive; app.get() in backend-server.js already gates method, but a
    // dedicated smoke test asserts this branch directly against the handler.
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    if (!held || held.expiresAt <= Date.now()) {
        inFlight ||= askGithub().then(({ status, body, ttl }) => {
            held = { status, body, expiresAt: Date.now() + ttl };
            inFlight = null;
        });
        await inFlight;
    }
    return res.status(held.status).json(held.body);
};
