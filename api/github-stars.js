// /api/github-stars — stargazer count for this repo, fetched from GitHub's
// public REST API without a token (`stargazers_count` is available
// unauthenticated). Edge-cached for a day (see backend-server.js), so behind
// Cloudflare the origin hits GitHub at most once per cache window — well under
// the 60 req/hour unauthenticated limit.
import { fetchUpstream } from '../common/fetch-with-timeout.js';
import logger from '../common/logger.js';

// This fork's own repository — reporting the upstream's star count under our
// brand would credit the wrong project.
const REPO = 'shijianus/TrustIP';

export default async (req, res) => {
    // Defensive; app.get() in backend-server.js already gates method, but a
    // dedicated smoke test asserts this branch directly against the handler.
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const apiRes = await fetchUpstream(`https://api.github.com/repos/${REPO}`, {
            headers: {
                'Accept': 'application/vnd.github+json',
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
            return res.json({ stars: null });
        }

        if (!apiRes.ok) {
            throw new Error(`GitHub API responded ${apiRes.status}`);
        }
        const data = await apiRes.json();
        res.json({ stars: data.stargazers_count ?? 0 });
    } catch (error) {
        logger.error({ err: error }, 'github-stars handler failed');
        res.status(500).json({ error: 'Failed to fetch GitHub stars' });
    }
};
