# api/AGENTS.md

Conventions for Express 5 handlers under `api/` and shared back-end code under
`common/`. Universal rules live in ../AGENTS.md.

## Overview

`backend-server.js` at the repo root wires every route and delegates to one
handler module under `api/`. `common/` holds shared back-end code (guards,
logger, fetch helper, MaxMind / CAIDA services, service-status poller), parts of
which the frontend also imports (`valid-ip.js`, `fetch-with-timeout.js`).

Roughly one handler file per route — each file's header comment states its route
and purpose, so read those for specifics:

- **Geo sources** — `ipinfo-io` · `ipapi-com` · `ipapi-is` · `ip2location-io` · `ip-sb` · `ipcheck-ing` · `maxmind`
- **Tool backends** — `get-whois` · `dns-resolver` · `mac-checker` · `cf-radar` · `asn-history` · `asn-connectivity` · `ooni-blocking` · `globalping-probes` · `service-status` · `google-map` · `github-stars` · `invisibility-test` · `dns-leak-test` · `persona` · `trust-score` · `ip-dossier` · `split`
- **User proxies** — `get-user-info` · `update-user-achievement`
- **Platform** — `configs` · `sentry-tunnel` · `share-report`

Two exceptions: all Cloudflare Radar data rides the single `/api/cfradar` route,
dispatched by `?view=` over the `RADAR_VIEWS` registry in `common/cf-radar.js`,
where each view declares its guards, TTL and fetch function (new Radar data = a
view function plus a registry row, never a new route); and `api/data/` holds
contributor-editable static config consumed by handlers — today `dns-resolvers.js`
(gated by `tests/dns-resolvers-data.test.js`).

### Trust score and dossier

`trust-score` answers one question about one address; `ip-dossier` answers the
whole IP page in one request. Neither is a handler-shaped upstream proxy: the
logic lives in `common/trust-score.js` (pure, no I/O, unit-tested with literals)
plus `common/trust-signals.js` / `common/ip-dossier.js`, and the handler files
stay thin shells. The dossier embeds `common/asn-announcement-history.js` (the
RIPEstat announcement rules, which `/api/asn-history` reads from the same place so
the two can never disagree) and `common/latency-matrix.js` (the latency grid's
probe plan) rather than sending the page out for a second request each. Before
touching this group:

- **Key-free by design** — public registries, DoH, RIPEstat, the CAIDA snapshots on disk. No `requiredEnv`, so it all works on a blank `.env`.
- One visitor request fans out into ~8 registry reads, so each route keeps its tight per-IP limiter plus `cacheable(24 * 60 * 60)` — RIPEstat's fair use is about one request per second per `sourceapp`.
- **Nothing connects to the queried address** — active probing would make the endpoint an amplification vector and let the target shape the answer. The latency grid is the one reachability measurement and is deliberately not taken here: the work order goes to the visitor's browser against Globalping, so the traffic and its quota belong to the visitor, and a server-side ping would report this datacenter's uplink as if it were the world's.
- **A signal that cannot be measured is reported as such, never as a pass.** The engine's `GAPS` and the dossier's `SLOTS` are the contract the UI renders against; a section that silently disappears is a bug, not a simplification.

### Site routing plan

`POST /api/split` is the only route here that answers a question about the caller
rather than an address someone passes in — and it still does no I/O:
`common/split-profile.js` (which countries this visitor's addresses name, plus six
weighted signals for the ones they don't) and `common/site-packs.js` (which
destinations exist) are pure; the handler is a shell, with no `requiredEnv` and no
upstream.

- **The blackness is the API.** The response is `{ rows }` — destinations to probe — and nothing else: no ranking, no weights, no explanation. There is no `GET`, because publishing the packs and the weight table would teach anyone how to place a visitor, and how to place them wrongly. `tests/api-handlers.test.js` asserts the shape and that no scoring vocabulary leaks; do not add a `debug` flag that returns the ranking.
- **The scorer stays out of the frontend bundle** — the one shared module with no `frontend/utils/` bridge, for the reason above (see frontend/AGENTS.md).
- **A measured country never has to win a vote.** `measuredCountries()` collects the countries this visitor's *addresses* named — leaked first, then the cards' own geolocation, then the echoed exits — up to `MEASURED_MAX`, and `confidentTop`'s `MIN_CONFIDENCE` floor gates only the one extra pack the guess is allowed to add (`INFERRED_MAX`). The floor exists to stop a coin flip, and an address is not a coin flip: when two exits in two countries split the geolocation signal 50/50, each half used to land near the floor and a confident third guess could crowd a real country out of the work order entirely.
- **A national pack's written order is that population's usage order.** `buildPlan` re-sorts the shared 国际 block by `groupRank` and ships country rows exactly as catalogued, because the table renders catalog order: sorting CN by category is how a chipmaker's corporate site ended up above 百度.
- **`EXIT_CANARIES` in `common/site-packs.js` is asked of everyone**, whatever the profile guessed, because the thing being looked for is what hides the evidence for it: a proxy that makes a machine read as American earns an American plan, an American plan holds no domestic destination, and nothing ever answers with the real address. It ships as just another row, so the response shape doesn't change; `tests/site-split.test.js` pins that it is there with an empty request and appears exactly once however many countries get picked (which is why the same host is *not* also in the CN pack).
- **`requireSplitSignals` (`common/guards.js`) is the shape rule**: unknown keys dropped, every list and string capped, anything over a cap discarded rather than truncated — a clipped zone name resolves to no country and would read as a measurement. It reads a slice's `available` as `=== true`, so a producer that returns a *count* there (`exits.length || leaked.length`) ships a signal the scorer treats as never measured — which is how `net` silently stopped voting once. `tests/split-signals.test.js` pins the boolean.
- **The signals cross to this origin, which is a trade, not a free win.** Nothing stores or logs them, so a deployment that adds request-body capture must keep `/api/split` out of it.

## Conventions

- **Handler shape.** Single default export `async (req, res) => …`: read `req.query` / `req.body`, call upstream, write one response.
- **Every upstream call uses `fetchUpstream`** (`common/fetch-with-timeout.js`, 8s). Never a bare `fetch()` / `https.get()` — a hanging provider must time out, not pin the connection. It injects a default `User-Agent` of `TrustIP/v<version>/<VITE_SITE_URL>` (`common/upstream-ua.js`, because some upstream WAFs block undici's `node` UA); a caller-supplied `User-Agent` always wins.
- **Error shape.** `500 { error: error.message }` on upstream failure, `400` on bad input. Terse — the frontend doesn't display these verbatim.
- **An unset environment variable is a supported state, never a crash.** Every read carries a fallback or an early "not configured" return before any request leaves the process: `500 { error: 'API key is missing' }` for a key-mandatory upstream, `503` for report sharing (KV trio), `{ stars: null }` for a private repo. Geo sources declare theirs with `requiredEnv` in `common/geo-handler.js`, checked before `buildUrl` runs; `/api/configs` booleanizes the same variables so the frontend hides the feature rather than calling it.
- **Response shape.** Geo handlers normalize to the canonical frontend shape (`ip` / `country_code` / `latitude` / `asn` / `org` / …); new sources match it. `timezone` is the exception — no handler produces it (see enrichment below).
- **`?lang` is never validated in a handler.** Pass the raw tag through: `lookupMaxMind` normalizes it onto `SUPPORTED_LANGS` (`common/maxmind-service.js`) and the private-API proxies forward it upstream. No allow-lists.
- **Logging.** Shared logger only, `logger.error({ err, ...ctx }, 'msg')`; no `console.*`, no "received request" lines (`pino-http` covers those when enabled).
- **Sentry is env-gated and invisible to handlers.** `sentry-instrument.js` (loaded via `node --import` *before* express, so ESM loader hooks can instrument route tracing) inits, and `backend-server.js` attaches `setupExpressErrorHandler` after the routes. No `SENTRY_DSN_BACKEND` → `@sentry/node` never loads; `SENTRY_ENVIRONMENT=development` skips the init. Handlers never import Sentry or capture: uncaught throws and 5xx traces are automatic, caught failures stay on the logger — a hook in `common/logger.js` mirrors warn+ to Sentry Logs and elevates error+ to grouped Issues. Periodic jobs wrap their tick in `common/sentry-cron.js`; `common/sentry-scrub.js` redacts API-key query params from telemetry URLs.

## Security & Boundaries

### Guards live in middleware, not handlers

`common/guards.js`, attached in `backend-server.js`. Handlers never repeat these
checks, and a new param shape means a new guard here — never open-coded in the
handler:

- `requireReferer` — global on `/api/*` (ALLOWED_DOMAINS + localhost).
- `requirePublicIP()` — per-route for `?ip=`: reserved space (RFC 1918, loopback, CGNAT, link-local, documentation …) is rejected here, so no geo source is ever asked about an address it can't answer for. `isUsablePublicIP` in `common/valid-ip.js` is the single definition, shared with the front-end IP forms.
- `requireValidDomain()` — `?domain=`, lowercased in place for one canonical edge-cache key. Leading underscores are allowed on any label but the TLD, so RFC 8552 service names (`_dmarc.…`, `_domainkey.…`) stay reachable for DMARC / DKIM lookups.
- `requireValidPrefix()` — `?prefix=` (CIDR); the frontend quantizes to the BGP DFZ floor (/24 v4, /48 v6) for maximal CF edge-cache reuse.
- `requireValidASN()` — `?asn=`, strips `AS`, rewrites to numeric.
- `requireValidCountry()` — `?country=` (alpha-2), uppercased in place. Syntactic only — an unassigned code just yields an empty upstream series.
- `requireValidProviderId()` / `requireValidReportId()` — whitelist `?id=` against service-status slugs, and the `/api/report/:id` param (22-char base64url).
- `requireValidRecordType()` — whitelists `?type=` against `DNS_RECORD_TYPES` (`common/dns-record-types.js`) and uppercases it. That list is the single source the DnsResolver picker and the `resolveDns` switch also read; without the guard the DoH branch forwards any string verbatim to four third-party endpoints.

### Response enrichment lives in middleware too

`withTimeZone()` (`common/ip-timezone.js`), on all seven geo routes, derives
`timezone` (IANA name) from the `latitude` / `longitude` the handler just returned
and adds it on the way out — 2xx only, same res.json hook and same rule as
`cacheable`. No handler computes or forwards a timezone, not even the private-API
pass-throughs; a new geo source inherits the field by adding the middleware. It is
derived from the response's own coordinates so the zone can never contradict the
city beside it, and only the zone name ships — the frontend renders the UTC
offset, because these routes sit behind a 24h edge cache and a cached offset goes
an hour wrong at every DST switch.

### Private-API header pass-through (intentional exception)

Handlers proxying the upstream project's private IPCheck.ing API
(`ipcheck-ing`, `invisibility-test`, `update-user-achievement`, `get-user-info`,
`dns-leak-test`, `persona`) forward the caller's headers
(`headers: { ...req.headers }`) — the upstream needs caller context
(Accept-Language, auth tokens). `persona` strips the framing headers first
(`host` / `content-length` / …) because it re-serializes the body. Do **not**
replicate this for third-party upstreams; those get only what's explicitly needed.

### Defensive method gates

Some handlers keep a `req.method !== 'GET'` branch although the route already
gates the method — smoke tests assert on that branch directly. Leave the gate in
place when a test covers it.

## Edge caching

`/api/*` defaults to `Cache-Control: no-store`; slowly-changing public routes opt
in via `cacheable(maxAge)` in `backend-server.js` —
`app.get('/api/whois', cacheable(24 * 60 * 60), …)`, written as multiplied
expressions, never raw seconds. `maxAge` also accepts a `(req) => seconds`
resolver (`/api/cfradar` reads its TTL from the view registry); a falsy
resolution keeps no-store, so unknown views never cache. Only status < 400 gets
`public, max-age=N`, so CF never caches error pages, and handlers never touch
`Cache-Control` themselves. **Auth'd / per-user endpoints must not be wrapped** —
their caching belongs to the upstream that owns the auth context.

## Testing

- Handlers get smoke tests in `tests/api-handlers.test.js`: method gating, param branches, "API key missing" early returns. A new or touched handler ships its block in the same change.
- Never hit real upstreams — assert on branches that return before the first `fetchUpstream`, or stub `globalThis.fetch` when the behavior under test lives past it (restored in the shared `afterEach`).
- Middleware is covered by `tests/guards.test.js` — don't duplicate its assertions per handler. Fetch timeout / abort: `tests/fetch-with-timeout.test.js`.
