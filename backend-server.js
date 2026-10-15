import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { slowDown } from 'express-slow-down'
import pinoHttp from 'pino-http';
import logger from './common/logger.js';
import { requireReferer, requirePublicIP, requireValidPrefix, requireValidASN, requireValidDomain, requireValidProviderId,
    requireValidRecordType, requireValidReportId, requireSplitSignals,
    normalizeAsnQuery } from './common/guards.js';
import { withTimeZone } from './common/ip-timezone.js';

// Backend APIs
import mapHandler from './api/google-map.js';
// IP Info
import ipinfoHandler from './api/ipinfo-io.js';
import ipapicomHandler from './api/ipapi-com.js';
import ipCheckingHandler from './api/ipcheck-ing.js';
import ipapiisHandler from './api/ipapi-is.js';
import ip2locationHandler from './api/ip2location-io.js';
import ipsbHandler from './api/ip-sb.js';
import maxmindHandler from './api/maxmind.js';
// Others
import cfRadarHandler from './api/cf-radar.js';
import { RADAR_VIEWS, isCompleteRadarAnswer } from './common/cf-radar.js';
import asnHistoryHandler from './api/asn-history.js';
import asnConnectivityHandler from './api/asn-connectivity.js';
import ooniBlockingHandler from './api/ooni-blocking.js';
import globalpingProbesHandler from './api/globalping-probes.js';
import dnsResolver from './api/dns-resolver.js';
import serviceStatusHandler, {
    detailHandler as serviceStatusDetailHandler,
} from './api/service-status.js';
import { getSessionResult as dnsLeakGetResult } from './api/dns-leak-test.js';
import getWhois from './api/get-whois.js';
import sentryTunnelHandler from './api/sentry-tunnel.js';
import createReportHandler, { getReport as getReportHandler } from './api/share-report.js';
import invisibilitytestHandler from './api/invisibility-test.js';
import macChecker from './api/mac-checker.js';
import githubStarsHandler from './api/github-stars.js';
import personaEvaluateHandler from './api/persona.js';
import splitHandler from './api/split.js';
import trustScoreHandler from './api/trust-score.js';
import ipDossierHandler from './api/ip-dossier.js';
import dnsblHandler from './api/dnsbl.js';
import internetdbHandler from './api/internetdb.js';
import ipCardHandler from './api/ip-card.js';
import asnProfileHandler from './api/asn-profile.js';
import { isCompleteProfile } from './common/asn-profile.js';
// User
import validateConfigs from './api/configs.js';
import getUserinfo from './api/get-user-info.js';
import updateUserAchievement from './api/update-user-achievement.js';
import { reloadMaxMindDatabases, isMaxMindReady, getMaxMindDbPaths } from './common/maxmind-service.js';
import { bootstrapDatasets, startDatasetScheduler, watchDatasets } from './common/dataset-updater.js';
import { datasets } from './common/datasets.js';
import {
    bootstrapServiceStatus, startServiceStatusPolling, isServiceStatusPrimed,
} from './common/service-status-store.js';
import { isAsRelLoaded } from './common/as-rel-db.js';
import { isAsOrgLoaded } from './common/as-org-db.js';
import { isOuiLoaded } from './common/oui-db.js';
import { runOfflineBootstrap, requireOfflineData, isOfflineBootstrapping } from './common/offline-data.js';
import { cacheable, noStore } from './common/cache-control.js';
import { initUpstreamUserAgent } from './common/upstream-ua.js';
import { apiNotFound, jsonErrorHandler } from './common/error-handler.js';
import { trustProxySetting } from './common/client-ip.js';
import { backendHost, hostPort } from './common/backend-host.js';
import { exitOnBootFailure } from './common/boot-failure.js';
import { limiter, perMinute, clientKey, getClientIp } from './common/route-limiter.js';
import { securityHeaders } from './common/security-headers.js';
import { cspMiddleware } from './common/csp.js';

dotenv.config({ quiet: true });
initUpstreamUserAgent();

const app = express();
// Don't advertise the framework on every response.
app.disable('x-powered-by');
app.use(securityHeaders);
// Default every /api/* response to no-store, ahead of the limiters and the body
// parser so their 429 / 400 / 413 are never cacheable. Routes that want edge
// caching declare it explicitly via `cacheable(maxAge)` (common/cache-control.js).
app.use('/api', noStore);
const backEndPort = parseInt(process.env.BACKEND_PORT || 11966, 10);
// Loopback unless BACKEND_HOST widens it — see common/backend-host.js.
const backEndHost = backendHost(process.env.BACKEND_HOST);
// Local rate-limit ledger file — opt-in: empty means no file is written.
// The logger.warn in the limiter handler always fires regardless (and flows
// to Sentry Logs when a backend DSN is configured), so the file only adds a
// permanent on-disk record for deployments that want one (e.g. Sentry-less
// self-hosts, or feeding a firewall script).
const blackListIPLogFilePath = process.env.SECURITY_BLACKLIST_LOG_FILE_PATH || '';
const rateLimitSet = parseInt(process.env.SECURITY_RATE_LIMIT || 0, 10);
const speedLimitSet = parseInt(process.env.SECURITY_DELAY_AFTER || 0, 10);

// Which peers may name the client in X-Forwarded-For (TRUST_PROXY, default
// `loopback` — frontend-server.js on the same host). See common/client-ip.js.
const trustProxy = trustProxySetting();
if (trustProxy.invalid) logger.warn({ TRUST_PROXY: process.env.TRUST_PROXY }, '⚠️ TRUST_PROXY is not understood; using loopback');
app.set('trust proxy', trustProxy.value);

// HTTP request logging on /api/* — off by default to keep pm2 logs lean.
// Set LOG_HTTP=true in .env to enable. Mounted before the rate limiter
// so 429s are also logged when enabled.
if (process.env.LOG_HTTP === 'true') {
    app.use('/api', pinoHttp({
        logger,
        customLogLevel: (req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
        },
        customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
        customErrorMessage: (req, res, err) => `${req.method} ${req.url} → ${res.statusCode}: ${err.message}`,
        serializers: {
            req: (req) => ({ method: req.method, url: req.url }),
            res: (res) => ({ statusCode: res.statusCode }),
        },
    }));
    logger.info('📝 HTTP request logging enabled (LOG_HTTP=true)');
}

// Every limiter, the slow-down, the ledger and the upstream headers key on one
// resolved address per request (common/route-limiter.js → common/client-ip.js).

// Host-local time with an explicit UTC offset ("2026-07-14 10:23:45 +0800"),
// matching the pretty-log timestamp style — ledger entries stay unambiguous
// whatever timezone the deployment runs in.
const formatDate = (timestamp) => {
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    const offsetMin = -d.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} `
        + `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
};

// Append-or-update one line in the rate-limit log, keeping the original
// timestamp on repeat offenders so we can see when an IP *first* showed up.
function logLimitedIP(ip) {
    const logPath = path.join(__dirname, blackListIPLogFilePath);

    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        logger.info({ logDir }, 'Created log directory');
    }

    fs.readFile(logPath, 'utf8', (err, data) => {
        if (err && err.code !== 'ENOENT') {
            logger.error({ err }, 'Error reading the log file');
            return;
        }

        const now = Date.now();
        let newCount = 1;
        let logExists = false;
        let updatedData = '';

        if (data) {
            const lines = data.split('\n');
            updatedData = lines.map(line => {
                const [currentIp, count, timestamp] = line.split(',');
                if (currentIp === ip) {
                    newCount = parseInt(count, 10) + 1;
                    logExists = true;
                    return `${ip},${newCount},${timestamp}`;
                }
                return line;
            }).join('\n');
        }

        if (!logExists) {
            const newLine = `${ip},${newCount},${formatDate(now)}`;
            updatedData += (updatedData ? '\n' : '') + newLine;
        }

        fs.writeFile(logPath, updatedData, 'utf8', err => {
            if (err) {
                logger.error({ err }, 'Failed to write to log file');
            }
        });
    });
}

const rateLimiter = limiter({
    windowMs: 20 * 60 * 1000,
    max: rateLimitSet,
    message: 'Too Many Requests',
    // The Sentry tunnel is exempted — it has its own limiter at the route.
    // Telemetry sharing the app quota is how reporting silently dies: one
    // 429 and the browser SDK drops every event for the next minute.
    skip: (req) => req.path === '/monitoring',
    handler: (req, res, next) => {
        const ip = getClientIp(req);
        // Log on the exact transition into rate-limited state — not every
        // blocked request — to avoid log flooding when an abusive client
        // keeps hammering after being limited. The warn line is the primary
        // record (mirrored to Sentry Logs when configured); the on-disk
        // ledger is the opt-in extra.
        if (req.rateLimit.current === req.rateLimit.limit + 1) {
            logger.warn({ ip }, 'IP rate-limited');
            if (blackListIPLogFilePath) {
                logLimitedIP(ip);
            }
        }
        res.status(429).json({ message: 'Too Many Requests' });
    }
});

const speedLimiter = slowDown({
    keyGenerator: clientKey,
    windowMs: 60 * 60 * 1000,
    delayAfter: speedLimitSet,
    delayMs: (used, req) => (used - req.slowDown.limit) * 400,
    maxDelayMs: 5000,
    skip: (req) => req.path === '/monitoring' || req.path === '/maxmind',
})

if (rateLimitSet !== 0) {
    app.use('/api', rateLimiter);
    logger.info(`🛡️  Rate limiter enabled — ${rateLimitSet} requests per 20 minutes`);
}

if (speedLimitSet !== 0) {
    app.use('/api', speedLimiter);
    logger.info(`🐢 Speed limiter enabled — slow down after ${speedLimitSet} requests`);
}

// 500kb instead of the 100kb default: shared diagnostic reports (POST
// /api/report) legitimately reach ~100KB; the report handler enforces its
// own tighter cap (REPORT_MAX_BYTES) after schema validation.
// Must stay above REPORT_MAX_BYTES (common/report-schema.js) or report
// uploads die here with a raw 413 before the handler's own size check.
app.use(express.json({ limit: '500kb' }));

// Global referer gate for all /api/* routes. Handlers no longer repeat this
// check individually — see common/guards.js.
app.use('/api', requireReferer);

// Readiness gates for routes reading local data (common/offline-data.js):
// 503 while that data is still downloading at boot, a no-op afterwards.
const needsMaxMind = requireOfflineData([isMaxMindReady]);
const needsAsGraph = requireOfflineData([isAsRelLoaded, isAsOrgLoaded]);
const needsOui = requireOfflineData([isOuiLoaded]);
const needsServiceStatus = requireOfflineData([isServiceStatusPrimed]);

const FIVE_MIN_CACHE = 5 * 60;
const ONE_HOUR_CACHE = 60 * 60;
const ONE_DAY_CACHE = 24 * 60 * 60;
const SEVEN_DAYS_CACHE = 7 * 24 * 60 * 60;
const THIRTY_DAYS_CACHE = 30 * 24 * 60 * 60;
const ONE_YEAR_CACHE = 365 * 24 * 60 * 60;

// Per-route budgets. The global limiter is opt-in (SECURITY_RATE_LIMIT), so any
// route that spends a vendor key, a third party's fair-use allowance, KV writes
// or a fan-out carries its own `perMinute(n)` budget, mounted after its
// validation guard and before `cacheable` so a 429 stays no-store. Each call is
// an independent bucket. An edge-cached 200 never reaches here — the limiters
// bound what the origin spends, not what visitors see.
//   - keyed geolocation vendors (ipinfo, ipapi.com, ip.sb, ipapi.is,
//     ip2location, IPCheck.ing): VENDOR_LOOKUP_MAX each — one IP page asks each
//     once, so a person never comes near it
//   - whois, OONI, Cloudflare Radar: 20 — public fair-use APIs
//   - asn-profile: 10 — Radar plus five sources per request, like the dossier
//   - Google Static Maps: 30 — every lat/lon pair is a billed image
//   - shared reports: 30 reads, 5 writes (each a Cloudflare KV write)
//   - persona / split: 10 — per-visitor computations a person reruns by hand
const VENDOR_LOOKUP_MAX = 30;
//   - IPCheck.ing proxies (invisibility, DNS-leak session, user info,
//     achievements): KEYED_PROXY_MAX each — every call spends the shared key
const KEYED_PROXY_MAX = 20;

// Cacheable routes — TTLs picked against each upstream's natural refresh cadence.
// Short Cache
app.get('/api/service-status', needsServiceStatus, cacheable(FIVE_MIN_CACHE), serviceStatusHandler);
app.get('/api/service-status/detail', requireValidProviderId(), needsServiceStatus, cacheable(FIVE_MIN_CACHE), serviceStatusDetailHandler);
// Cache for 1 day
app.get('/api/ipinfo', requirePublicIP(), perMinute(VENDOR_LOOKUP_MAX), withTimeZone(), cacheable(ONE_DAY_CACHE), ipinfoHandler);
app.get('/api/ipapicom', requirePublicIP(), perMinute(VENDOR_LOOKUP_MAX), withTimeZone(), cacheable(ONE_DAY_CACHE), ipapicomHandler);
app.get('/api/ipsb', requirePublicIP(), perMinute(VENDOR_LOOKUP_MAX), withTimeZone(), cacheable(ONE_DAY_CACHE), ipsbHandler);
app.get('/api/ipapiis', requirePublicIP(), perMinute(VENDOR_LOOKUP_MAX), withTimeZone(), cacheable(ONE_DAY_CACHE), ipapiisHandler);
app.get('/api/ip2location', requirePublicIP(), perMinute(VENDOR_LOOKUP_MAX), withTimeZone(), cacheable(ONE_DAY_CACHE), ip2locationHandler);
app.get('/api/maxmind', requirePublicIP(), needsMaxMind, withTimeZone(), cacheable(ONE_DAY_CACHE), maxmindHandler);
app.get('/api/whois', normalizeAsnQuery(), perMinute(20), cacheable(ONE_DAY_CACHE), getWhois);
app.get('/api/github-stars', cacheable(ONE_DAY_CACHE), githubStarsHandler);
// Feature flags derived from env vars — they only change on a redeploy, so
// an hour of caching is safe.
app.get('/api/configs', cacheable(ONE_HOUR_CACHE), validateConfigs);
// OONI aggregates cover a 30-day window aligned to UTC days — the payload
// only drifts as new measurements land, so 1 day of edge cache keeps us polite
// to OONI's free API without the view going meaningfully stale.
app.get('/api/ooni-blocking', requireValidDomain(), perMinute(20), cacheable(ONE_DAY_CACHE), ooniBlockingHandler);
// Which countries have online Globalping probes — coverage changes slowly,
// and the pickers fail open anyway, so a week of edge cache is fine.
app.get('/api/globalping-probes', cacheable(SEVEN_DAYS_CACHE), globalpingProbesHandler);
// ASN Profile aggregate: every source in one answer; reputation inside it is
// not per-user. A complete answer is cached for a week; a degraded one (a
// section in error or incomplete) for a day — an upstream that fails for
// some ASes every time would otherwise send every visit back to all sources.
// Not boot-gated: a section whose local data is still downloading answers
// 'error' on its own (api/asn-profile.js), and nothing degraded is cached
// during that window.
app.get('/api/asn-profile', requireValidASN(), perMinute(10), cacheable(SEVEN_DAYS_CACHE, {
    cacheIf: isCompleteProfile,
    degradedMaxAge: () => (isOfflineBootstrapping() ? 0 : ONE_DAY_CACHE),
}), asnProfileHandler);
// All Cloudflare Radar data rides one route; `?view=` picks the dataset and
// the TTL comes from that view's registry entry (common/cf-radar.js) — 7d
// for the ASN summary and prefix list (same as /api/asn-profile), 30d for
// country traffic, 1h for the outage feed. A partial answer (some upstream
// calls failed, or prefix countries MaxMind couldn't fully work out) is
// served but not cached.
// Own-key lookup: ?view=constructor / __proto__ must not reach Object.prototype.
app.get('/api/cfradar', perMinute(20), cacheable((req) => (Object.hasOwn(RADAR_VIEWS, String(req.query.view)) ? RADAR_VIEWS[req.query.view].ttl : undefined), { cacheIf: isCompleteRadarAnswer }), cfRadarHandler);
// Cache for 30 days — registry / historical data that changes on a monthly
// (or slower) cadence: IEEE OUI assignments, ASN metadata, ASN interconnection,
// and append-only BGP routing history.
app.get('/api/asn-history', requireValidPrefix(), cacheable(THIRTY_DAYS_CACHE), asnHistoryHandler);
app.get('/api/asn-connectivity', requireValidASN(), needsAsGraph, cacheable(THIRTY_DAYS_CACHE), asnConnectivityHandler);
app.get('/api/macchecker', needsOui, cacheable(THIRTY_DAYS_CACHE), macChecker);
// TrustMy.IP's own trust assessment. One visitor request fans out into seven
// registry reads (PTR, RIR allocation, AS overview, announcement set, RPKI,
// geo, blocklist zones), so it gets a far tighter per-IP budget than the global
// limiter — a scanner walking a /8 would otherwise spend our RIPEstat fair-use
// allowance on the first minute. Twenty-four hours of edge cache is the other
// half of that protection: registry facts about a prefix do not change within a
// day. Note what that means for the one signal that does change within a day —
// a score's blocklist verdict is up to 24h old, so `/api/dnsbl` is the fresh
// source for that signal and the score is the considered summary of it.
const trustScoreLimiter = limiter({
    windowMs: 60 * 1000,
    max: 12,
    message: 'Too Many Requests',
});
app.get('/api/trustscore', requirePublicIP(), trustScoreLimiter, cacheable(24 * 60 * 60), trustScoreHandler);
// The IP page's single request. Same fan-out concern as /api/trustscore, one
// step worse: it answers the registry evidence plus two extra geolocation
// sources, so it gets its own budget rather than sharing the smaller one and
// starving the endpoint the home page depends on.
const dossierLimiter = limiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too Many Requests',
});
app.get('/api/dossier', requirePublicIP(), dossierLimiter, cacheable(24 * 60 * 60), ipDossierHandler);
// Blocklist membership is the fastest-moving fact this API reports: a listing
// appears and is delisted within days. The edge cache therefore matches the 30
// minute answer cache in common/dnsbl.js rather than the registry routes' day,
// so a delisted address stops being accused within the hour it was cleared.
const dnsblLimiter = limiter({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Too Many Requests',
});
app.get('/api/dnsbl', requirePublicIP(), dnsblLimiter, cacheable(30 * 60), dnsblHandler);
// The scan archive is key-free, so this route costs a third party nothing but our
// own bandwidth — and it is the one trust fact that is a *history*: an address
// answering on 22 today may not have when Shodan looked. Six hours is short enough
// that a fresh observation shows up within the working day and long enough that a
// scanner walking a /8 cannot turn our bandwidth into Shodan's problem.
const internetdbLimiter = limiter({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Too Many Requests',
});
app.get('/api/internetdb', requirePublicIP(), internetdbLimiter, cacheable(6 * 60 * 60), internetdbHandler);
// The shareable card is the same evidence as the score, drawn once: a PNG is a
// published artifact, so it lives or dies by the same 24h clock the score it shows
// sits behind — and it is asked for by the same address, so a per-IP limiter of the
// dossier's size is the right ceiling.
const ipCardLimiter = limiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too Many Requests',
});
app.get('/api/ip-card', requirePublicIP(), ipCardLimiter, cacheable(24 * 60 * 60), ipCardHandler);
// Long Cache
app.get('/api/map', perMinute(30), cacheable(ONE_YEAR_CACHE), mapHandler);
// Non-cacheable routes — auth-context, debug tools, or per-request lookups.
app.get('/api/ipchecking', requirePublicIP(), perMinute(VENDOR_LOOKUP_MAX), withTimeZone(), ipCheckingHandler);
// One lookup fans out to 24 resolvers (18 UDP + 6 DoH), so it gets its own
// per-IP budget like the other fan-out routes; the global limiter is opt-in.
const dnsResolverLimiter = limiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too Many Requests',
});
app.get('/api/dnsresolver', requireValidDomain('hostname'), requireValidRecordType(), dnsResolverLimiter, dnsResolver);
// The IPCheck.ing proxies each spend IPCHECKING_API_KEY's monthly quota on every
// origin request, whatever the id or token says, so each carries its own budget.
// A real visitor polls a DNS-leak session three times and an invisibility result
// four times per test, signs in once and earns achievements one at a time.
app.get('/api/dnsleaktest/session/:token', perMinute(KEYED_PROXY_MAX), dnsLeakGetResult);
app.get('/api/invisibility', perMinute(KEYED_PROXY_MAX), invisibilitytestHandler);
app.get('/api/getuserinfo', perMinute(KEYED_PROXY_MAX), getUserinfo);
app.put('/api/updateuserachievement', perMinute(KEYED_PROXY_MAX), updateUserAchievement);
// Shared reports stay no-store: an edge cache could serve a report past its
// KV expiry, and private diagnostic data doesn't belong in a public cache.
app.get('/api/report/:id', requireValidReportId(), perMinute(30), getReportHandler);
app.post('/api/report', perMinute(5), createReportHandler);
// One observation in, one graded report out — per-visitor by definition.
app.post('/api/persona/evaluate', perMinute(10), personaEvaluateHandler);
// One set of profile signals in, one routing work order out. Per-visitor, never
// cached, and the only route whose *answer* is a secret from its own client — see
// api/split.js for why the scoring lives on this side of the wire.
app.post('/api/split', requireSplitSignals(), perMinute(10), splitHandler);

// Sentry tunnel — first-party relay for the frontend SDK's envelopes
// Mounted only when this deployment actually built the frontend with a DSN.
//
// `type` must be a catch-all FUNCTION: Replay envelopes are binary
// (deflate-compressed recording) and fetch sends those with NO Content-Type
// header at all — a '*/*' string matcher skips such requests and req.body
// would never be populated.
if (process.env.VITE_SENTRY_DSN_FRONTEND) {
    // Dedicated, more generous per-IP limiter
    const monitoringLimiter = limiter({
        windowMs: 20 * 60 * 1000,
        max: 600,
        message: 'Too Many Requests',
    });
    app.post('/api/monitoring', monitoringLimiter, express.raw({ type: () => true, limit: '10mb' }), sentryTunnelHandler);
}

// Set static file server
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// The same dist/ frontend-server.js serves, reachable here on the API port
// (a split deployment widens BACKEND_HOST), so its pages carry the same
// Content-Security-Policy (common/csp.js) rather than none; /api answers skip it.
const distDir = path.join(__dirname, './dist');
const staticCsp = cspMiddleware({ indexPath: path.join(distDir, 'index.html'), env: process.env });
app.use((req, res, next) => (req.path.startsWith('/api/') ? next() : staticCsp(req, res, next)));
app.use(express.static(distDir));

// Sentry error capture — the SDK itself is initialized (or not) by
// sentry-instrument.js via `node --import`; this attaches the Express error
// handler only when a DSN made that init happen. Must come after every route.
if (process.env.SENTRY_DSN_BACKEND) {
    const Sentry = await import('@sentry/node');
    Sentry.setupExpressErrorHandler(app);
    logger.info('🛰️  Sentry backend monitoring enabled');
}

// JSON 404 for unknown /api/* paths, then a last-resort error handler that
// never renders a stack trace — see common/error-handler.js.
app.use('/api', apiNotFound);
app.use(jsonErrorHandler);


// Boot sequence. Snapshots already on disk are in memory before the listener
// opens (CAIDA / PeeringDB / IEEE load at import, MaxMind just below), so a
// restart serves at once. Missing ones download behind the listener:
// meanwhile only the routes reading them answer 503 (requireOfflineData
// above). A failed download stays non-fatal — that route then serves degraded
// (MaxMind / IEEE → 503; CAIDA → empty graph, RIPEstat fallback or no
// peering section).
const bootBackend = async () => {
    const { cityDbPath, asnDbPath } = getMaxMindDbPaths();
    if (fs.existsSync(cityDbPath) && fs.existsSync(asnDbPath)) {
        await reloadMaxMindDatabases('startup').catch(() => {});
    }

    // Awaited, so a port in use or an address this host does not have
    // rejects the boot instead of throwing from inside the listen callback.
    await new Promise((resolve, reject) => {
        app.listen(backEndPort, backEndHost, (err) => (err ? reject(err) : resolve()));
    });
    logger.info(`🚀 Backend server ready on http://${hostPort(backEndHost, backEndPort)}`);

    // Watching from before the downloads: a dataset another process
    // publishes (or someone places by hand) while a boot step is still
    // running is reloaded, not taken as the watcher's baseline.
    watchDatasets(datasets);

    await runOfflineBootstrap([
        async () => {
            await bootstrapDatasets(datasets);
            if (isMaxMindReady()) return;
            await reloadMaxMindDatabases('startup').catch(() => {
                logger.error('❌ MaxMind API will return 503 until databases are available: set MAXMIND_ACCOUNT_ID + '
                    + 'MAXMIND_LICENSE_KEY, or drop GeoLite2-City.mmdb + GeoLite2-ASN.mmdb into common/maxmind-db/');
            });
        },
        bootstrapServiceStatus,
    ]);

    startDatasetScheduler(datasets);
    startServiceStatusPolling();
};

// A boot step that throws leaves no half-started server behind: one ❌ line
// and exit code 1, which pm2 and Docker's restart policy act on. The steps
// that can fail on bad data or config (downloads, DATASET_UPDATE_CRON)
// degrade inside their own step instead of reaching this.
bootBackend().catch(exitOnBootFailure);
