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
- **Tool backends** — `get-whois` · `dns-resolver` · `mac-checker` · `cf-radar` · `asn-history` · `asn-connectivity` · `asn-profile` · `ooni-blocking` · `globalping-probes` · `service-status` · `google-map` · `github-stars` · `invisibility-test` · `dns-leak-test` · `persona` · `trust-score` · `ip-dossier` · `dnsbl` · `internetdb` · `split`
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

- **Key-free by design** — public registries, DoH, RIPEstat, the CAIDA snapshots on disk, blocklist zones over raw DNS. No `requiredEnv`, so it all works on a blank `.env`.
- **Every keyed feed is opt-in, and an unenabled capability is not a missing measurement.** `TRUST_IPAPIIS_FEED=true` adds the per-address `api.ipapi.is` call; `TRUST_PROVIDERS=proxycheck,abuseipdb,ip2location,ipinfo` adds the commercial anonymiser lists (`common/providers/`, one adapter per vendor, merged in `providers/vote.js`) — `ipinfo` among them only where the account has IPinfo's paid Privacy Detection, because the free Lite body carries no `privacy` object and would join `sources` while casting no vote. Off, `proxyVpnDb` / `anonymityNetworks` / `historicalAbuseReports` stay in `gaps` **and stay out of the confidence denominator** — a key-free deployment is how this fork ships, and it must not be permanently capped for a subscription it never claimed. On, a field the vendor simply did not send is `unknown` and *does* shrink confidence: absence read as "clean" is the inversion every rule in this group exists to prevent. The quota is the other half of the default: the geo card spends these keys once per visitor, and a per-lookup feed multiplies them by whatever an audit script polls, so an exhausted key would surface as a data gap instead of an outage. One address costs one call per vendor however many switches want a piece of it — the abuse feed is re-expressed in the providers' shape and folded into the same merge, never asked twice.
- One visitor request fans out into ~8 registry reads plus a blocklist pass (one DNS query per zone, and a canary query only when a zone is about to accuse) and, with the lists enabled, one parallel pass over the providers with a 5s budget each — `Promise.allSettled`, so a vendor's 500 is a missing vote and the response is still a 200 with the key-free sources in it. Each route therefore keeps its tight per-IP limiter plus `cacheable(24 * 60 * 60)`; RIPEstat's fair use is about one request per second per `sourceapp`.
- **The fan-out is cached, and the cache is a cost optimisation, never a data path.** `common/trust-cache.js` holds it — this process' LRU, plus Workers KV when the `CLOUDFLARE_*` trio is set, so a second instance or an overnight restart does not re-ask RIPEstat for the whole world. Every KV malfunction is a cache miss: a timeout, a 404, an HTML error page, or a value restored from a copied namespace whose own expiry has passed (the stored JSON carries it, because a reader cannot ask KV how much of the ttl is left). A deployment whose credentials broke must still answer with the evidence it would have produced with no cache at all. `TRUST_CACHE_TTL_SECONDS` is the clock for the keyed feeds — default 86400, clamped to [60s, 7d] so a mistyped value costs freshness or quota rather than silently disabling either — while the registry families keep 6h and blocklist membership keeps its own 30 minutes: a listing moves within days and must not be held on a subscription's schedule.
- **A vendor skipped for budget answers `unavailable` with reason `quota`, never `missing_key`.** `providers/quota.js` counts lookups per vendor per UTC day per process against `TRUST_PROVIDER_DAILY_MAX` (0 or a typo means no cap — a number nobody wrote must cost a deployment its throttle, not hand it a budget of one), and the charge lands only for an answer that actually left the process, so a vendor with no key does not eat the budget of the ones that answered. The ceiling is configuration because a free tier is the vendor's commercial decision and it changes without asking this repo; a number baked in from a pricing page rots into a wrong budget. Per-process accounting is the honest shape and its limit is stated: two instances each spend the ceiling, and a shared budget would need an atomic increment Workers KV does not offer.
- **A vendor's `yes` is worth exactly as much as the kind of source it came from.** `providers/answer.js` stamps each answer `list` (an anonymiser database — proxycheck.io, ipapi.is, ipinfo's privacy block) or `observation` (something seen, not something listed — a usage-type label, a Shodan tag). A `list` may decide a capability alone; an `observation` needs a second source, because one scanned port on a hosting range would otherwise accuse every address in it. Silence is never a clearance: a flag nobody carried stays `null` and the signal reads `unknown`, and a clean vote somebody *did* dissent from gets the accusation's absence but not the bonus (`PRIVACY_EFFECT.cleanContested`). The dissent survives as `votes` so the page can call it a close call.
- **`/api/dnsbl` is the one fast-moving fact and is cached for 30 minutes, not a day.** A listing appears and is delisted within days; the edge TTL matches the answer cache in `common/dnsbl.js` so a cleared address stops being accused within the hour. The score that embeds it is still a 24h snapshot — that is why the dossier ships `blocklists.results` with the zone names and raw codes alongside it.
- **`/api/internetdb` reports an observation, not a present tense.** Shodan's archive is key-free, so the route is the one trust fact a blank `.env` deployment can serve — and it is a *history* of what somebody's scanners saw, which is why the answer carries `generatedAt` and the edge TTL is six hours rather than a day. Its upstream answers an unscanned address and a malformed one with the same 404 body, so the route splits three states a consumer must not conflate: `record`, `no-record` (nobody looked — an answer, never a failure) and 500 (the request did not complete). Inside the ladder its tags arrive as `observation` authority, so an `open_proxy` can corroborate but cannot accuse on its own.
- **`/api/ip-card` is the one trust artifact built to leave, and its gate is a font, not a key.** The card carries the address, the country its own echo named, the AS, the class, the score and the clock the evidence was assembled on — and nothing else: no registrant contact, no vendor payload, no per-signal weights, because a PNG gets reposted somewhere nobody can inspect its source. Satori needs real font bytes and this build ships none, so `IP_CARD_FONT_PATH` (or a probe of the well-known system locations) decides whether the route exists at all: no font → 503 before any upstream is asked, and `/api/configs` says `ipCard: false` so the button is hidden rather than broken. Its labels come from the same locale packs the site renders, and `drawableLang` reads them in a language the chosen face can actually draw — a Latin-only host asked for `zh` gets English labels rather than a row of tofu boxes, and pointing `IP_CARD_FONT_PATH` at a CJK face is what lifts that.
- **The query name is the reversed address directly under the zone** — `7.100.51.198.bl.blocklist.de` (RFC 5782), built by `reversedLabels` in `common/ip-math.js`. `reverseName`'s `in-addr.arpa` form is for PTR only; under a blocklist zone it is an NXDOMAIN that reads as clean for every address. `tests/dnsbl.test.js` pins the exact names.
- **An interception canary guards every accusation.** A recursor that fabricates answers reports every address as listed, so before any listing is reported a guaranteed-nonexistent name is queried in the same zone through the same path; if that answers too, the pass is discarded and the next candidate resolver tried. A canary that could not be asked is `unverified`, never a cleared listing, and a refusal code (127.255.255.x) counts as neither listed nor clean.
- **A zone answer comes in four readings, and only one of them is about the address.** A documented listing, an undocumented 127.x code (the zone said yes and we cannot name which of its lists — still a yes), a `DIAGNOSTICS` refusal (the zone is talking about *our query*), and a `policy` code, which is the zone's rule about the address's **range** rather than anything it saw this address do. `policy` is guarded by the same canary as an accusation, because a recursor inventing it would hide a real listing behind "only the range's policy". Only an accusation accuses: a policy code beside a refusal is `policy`, never `listed`. Neither of the last two lands in `tally.answered`, so a pass made only of them scores `unknown` — the fourth state exists precisely so a residential block's sending policy can never be read as this address's clearance. `common/dnsbl-zones.js` carries the code tables and `tests/dnsbl-zones.test.js` refuses a code that is both a listing and a policy.
- **A pass with nothing to score says which kind of nothing it was.** `answered: 0` has two causes that read identically downstream — nobody replied, and everybody replied about the *range* — and only the pass itself can still tell them apart, so `common/dnsbl.js` sets `reason: 'policy-only'` there rather than leaving three consumers to re-derive a guess — only when every zone replied with policy or a refusal; a zone that timed out or failed means the pass did not hear "only the range", and it reads as the generic `no-answer`. A policy-only pass is still handed to the page (`blocklistSummary` keeps it at `answered: 0`), so its policy rows render under the gap line. The dossier turns that name into a sentence (`BLOCKLIST_GAP_REASONS`) and also carries it as `slots.blocklists.gapKey`, because the panel's generic gap line promises "a truthful recursor, and a zone that publishes this address family" — true of a network that blocks DNS, false of a pass that heard plenty, about the block. A reason with no copy of its own falls back to the generic line, so the key costs nothing for the five gaps that already read correctly.
- **A signal widens its evidence before it grows a row.** `nativeness` now compares two things — the RIR's registered country against the geo country, and, when those agree, the block's `OriginAS` against the AS actually carrying the address. It stayed one signal on purpose: a second row would widen the confidence denominator and move **every** address on the page, whereas sharing the existing rung changes nothing for an address whose answers agree and only charges the ones whose own registry contradicts their geolocation. Prefer that shape for any new judgement: widen what a signal reads, add a row only when the evidence is genuinely a different question. An unparseable origin (`NOT-SET`, `AS0`, out-of-range, absent) is read as absent, never as a mismatch. The same shape holds for the merged provider lists: a vendor saying "hosting range" **widens `registryClass`** rather than growing a row, speaks only where the registry's own text named no class, and is charged at the secondhand rung (`LIST_CLASS_EFFECT`, -16 — not the -34 the registry's own token costs). A secondhand claim never *pays* either: a list saying "mobile network" names the class at zero effect, because letting a vendor buy an address trust it did not earn is the same inversion pointed the other way.
- **Every trust response carries `generatedAt`.** These routes sit behind a 24h edge cache, so a consumer's own write time is not the age of the evidence — a stored row that cannot tell a fresh verdict from one the edge repeated for a day will be trusted for longer than it deserves.
- **Nothing connects to the queried address** — active probing would make the endpoint an amplification vector and let the target shape the answer. The latency grid is the one reachability measurement and is deliberately not taken here: the work order goes to the visitor's browser against Globalping, so the traffic and its quota belong to the visitor, and a server-side ping would report this datacenter's uplink as if it were the world's.
- **A signal that cannot be measured is reported as such, never as a pass.** The engine's `GAPS` and the dossier's `SLOTS` are the contract the UI renders against; a section that silently disappears is a bug, not a simplification.
- **A declared gap names the class of source that would close it.** `SLOTS[*].needs` is written for whoever fills the gap in, so it says *what to go and find* — "a VPN exit directory", "a per-prefix observation store" — never "not supported here". `tests/ip-dossier.test.js` pins one source pattern per declaring slot, so a rewrite into vagueness fails the run instead of becoming the next contributor's mystery. Two strings describe each gap and both are checked: the response's own `needs`, and the pack sentence the panel renders (`dossier.slot.*Needs`). They drifted once, and only this pin notices — routing visibility is not a VPN exit directory, and a reader told to go looking for the wrong dataset costs the same as one told nothing.
- **A slot may be partly real, and the response says which half.** `neighbours` carries the addresses the registered block puts either side of this one, plus the block's two edges — arithmetic on `network.cidr`, no query and no probe — while the question no registry answers, whether any of those addresses is *in use*, stays declared in `missing`. `buildNeighbours` stops at the block's ends rather than naming somebody else's address, keeps a `/32` as an answer ("this address holds its block alone") rather than a missing block, and returns null when the registry named no block at all: no block and a block of one are different sentences, and the page has two strings for them. `network.cidr` is the RIPEstat whois block, or — when that names none, as for ARIN IPv6 — the RIR's own RDAP block (`registeredBlockOf`, one lookup on the miss only); it arrives in three registry shapes — a CIDR (ARIN `CIDR`, RIPE-family `inet6num`), RIPE-family `inetnum`'s `a - b` range, or ARIN's comma list — and `blockContaining` (`common/ip-math.js`) keeps the part that actually holds the address; a block that does not contain it is somebody else's and reads as no block. With no block, `slots.neighbours` drops to a `placeholder` too, so the slot never claims a half it does not have.

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
- **Both entry paths produce at most `PLAN_COUNTRIES_MAX` packs.** The page posts signals and the scorer picks; a report or script may post `countries` directly, and the handler filters that list to known packs and caps it at the same number the judged path can reach. `requireSplitSignals`' 12-code ceiling is a body-size limit and was never a policy about the table — twelve codes in the door used to mean a hundred-row work order.
- **`requireSplitSignals` (`common/guards.js`) is the shape rule**: unknown keys dropped, every list and string capped, anything over a cap discarded rather than truncated — a clipped zone name resolves to no country and would read as a measurement. It reads a slice's `available` as `=== true`, so a producer that returns a *count* there (`exits.length || leaked.length`) ships a signal the scorer treats as never measured — which is how `net` silently stopped voting once. `tests/split-signals.test.js` pins the boolean.
- **The signals cross to this origin, which is a trade, not a free win.** Nothing stores or logs them, so a deployment that adds request-body capture must keep `/api/split` out of it.

### ASN data

- **`/api/asn-profile`** (`common/asn-profile.js`) runs each ASN source's core
  under a deadline above the upstream timeouts it wraps (`INNER_TIMEOUTS`); a
  failed or late one is just absent. Always 200 `{ asn, status, incomplete,
  …sections }` (`ok` / `empty` / `error` / `disabled`; an upstream fault is
  `error`, never `empty`; `incomplete` = `ok` but partial); 502 if all fail.
- **Relationship counts follow the graph:** `asn-connectivity` neighbour
  lists come from local CAIDA (`common/as-relationships.js`), dropping the
  providers the graph walk distrusts. The Radar `asn` view (ASN Info) carries
  no prefix or relationship counts — the ASN Profile has both.
- **`/api/whois` `?q=`:** IPs (RDAP, whoiser fallback), domains (whoiser, RDAP
  fallback), AS numbers (`AS<n>` or bare digits — this fork's `rdapAsnRecord`,
  keyed by registry host like a domain answer); all carry a `__raw` block. The
  route's `normalizeAsnQuery` guard canonicalizes `as<n>` to `AS<n>` first. The
  ASN Profile reads the same registry object through the upstream's parsed
  `rdapAutnum` instead; both live in `common/rdap.js` over one bootstrap matcher.
  A port-43 reply that is prose rather than a record (`registryReplyFault`:
  "No match for…" → 404; "Malformed request." / rate limits → RDAP, else 502) is
  never served as a 200, and upstream faults answer `502 { error: 'Upstream
  request failed' }` with the cause only in the log.
- **Offline datasets** (MaxMind, CAIDA, PeeringDB, IEEE MAC registries) are rows in
  `common/datasets.js`, run by one engine,
  `common/dataset-updater.js` (lock, atomic state, publish, boot download,
  daily schedule). A row holds only its own logic — find the newest remote
  version, fetch / distill it, validate, reload; a new dataset is a new row,
  never a new updater. Fetched at boot when its reader has nothing usable
  (missing, or a file it refuses) or a publish was cut short; refreshed daily at
  `DATASET_UPDATE_CRON` (default 04:30 local) unless `DATASET_AUTO_UPDATE=false`
  (a row's pre-engine flag, e.g. `CAIDA_AUTO_UPDATE`, still applies when that
  is unset), with a catch-up run at boot for a check a downtime skipped. Files
  changed on disk by anyone else (another process, a hand-placed `.mmdb`) are
  reloaded by the engine's watcher. MaxMind only with its credentials (City + ASN publish together);
  PeeringDB only with a Cloudflare key; its 116 MB dump is
  stream-distilled (never parsed whole) to a ~6 MB per-ASN index without
  contact data (`common/peeringdb-distill.js`). The IEEE row (MAC Lookup)
  needs no key: five registry CSVs published as downloaded, answered by the
  longest covering assignment (`common/oui-db.js`).

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
handler. A guard hands its canonical value on through `setQueryParam(req, name, value)`,
never `req.query[name] = value`: Express 5 re-parses `req.query` on every read, so
a plain write is lost (`tests/guards-express5.test.js` pins this through a real app):

- `requireReferer` — global on `/api/*` (ALLOWED_DOMAINS + localhost, 127.0.0.1, [::1]).
- `requirePublicIP()` — per-route for `?ip=`: reserved space (RFC 1918, loopback, CGNAT, link-local, documentation …) is rejected here, so no geo source is ever asked about an address it can't answer for. `isUsablePublicIP` in `common/valid-ip.js` is the single definition, shared with the front-end IP forms.
- `requireValidDomain()` — `?domain=`, lowercased (`setQueryParam`) for one canonical edge-cache key. Leading underscores are allowed on any label but the TLD, so RFC 8552 service names (`_dmarc.…`, `_domainkey.…`) stay reachable for DMARC / DKIM lookups.
- `requireValidPrefix()` — `?prefix=` (CIDR); the frontend quantizes to the BGP DFZ floor (/24 v4, /48 v6) for maximal CF edge-cache reuse.
- `requireValidASN()` — `?asn=` in AS1…AS4294967295, rewritten as bare digits.
- `normalizeAsnQuery()` — `/api/whois` `?q=`: `AS<n>` (prefix required) is canonicalized to `AS<n>` (400 on AS0 / past 32 bits); anything else, a bare number included, passes through to the handler. Both use `common/asn-input.js`.
- `requireValidCountry()` — `?country=` (alpha-2), uppercased. Syntactic only — an unassigned code just yields an empty upstream series.
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

### Offline data gates boot, not the listener

The backend listens before any missing offline dataset or the service-status
snapshot is fetched; snapshots already on disk load first, so only a first
boot waits on downloads. During that window `requireOfflineData([...probes])`
(`common/offline-data.js`) answers 503 on a route whose data is still missing
— never edge-cached — and is a no-op after boot, when a missing dataset means
a failed download served degraded. A route reading local data declares its
probes (`isMaxMindReady`, `isAsRelLoaded`, …) in `backend-server.js`. Answers
assembled from parts don't gate: an ASN Profile section whose data is still
loading (`isStillLoading`) answers `error`, leaving the others to answer.

### Per-route rate limits

Limiters live in `backend-server.js`, built by `common/route-limiter.js`, which
keys every one on the address `common/client-ip.js` resolved (IPv6 by /56). The
global limiter is opt-in (`SECURITY_RATE_LIMIT`), so a route that spends a vendor
key, a third party's fair-use allowance, a Cloudflare KV write or a fan-out gets
its own budget — `perMinute(n)`, or a named `limiter({...})` where the window is
not a minute — mounted after its validation guard and before `cacheable`, so a
429 stays `no-store`. Every `perMinute` / `limiter` call is an independent
bucket. `tests/route-limits.test.js` lists the metered routes and fails when one
loses its limiter; a new metered route joins that list.

### Private-API header pass-through (intentional exception)

Handlers proxying the upstream project's private IPCheck.ing API
(`ipcheck-ing`, `invisibility-test`, `update-user-achievement`, `get-user-info`,
`dns-leak-test`, `persona`, and `asn-profile`'s reputation section) forward the
caller context the upstream needs (Accept-Language, auth tokens) through
`upstreamHeaders(req)` (`common/upstream-headers.js`): an allow-list plus the
client address as `common/client-ip.js` resolved it — never `{ ...req.headers }`,
which would hand a third party this site's cookies and let a client choose the
address the upstream sees. `asn-profile`'s reputation call sits behind a shared
7-day public cache, so it uses `anonymousUpstreamHeaders(req)`: the same list
without `Authorization` — no visitor's token shapes an answer everyone is served.
Third-party upstreams get only what's explicitly needed.

### Defensive method gates

Some handlers keep a `req.method !== 'GET'` branch although the route already
gates the method — smoke tests assert on that branch directly. Leave the gate in
place when a test covers it.

## Edge caching

`/api/*` defaults to `Cache-Control: no-store`; slowly-changing public routes opt
in via `cacheable(maxAge)` (`common/cache-control.js`) in `backend-server.js` —
`app.get('/api/whois', cacheable(24 * 60 * 60), …)`, written as multiplied
expressions, never raw seconds. `maxAge` also accepts a `(req) => seconds`
resolver (`/api/cfradar` reads its TTL from the view registry); a falsy
resolution keeps no-store, so unknown views never cache. `{ cacheIf }` vetoes the
full TTL for a 2xx body and `{ degradedMaxAge }` gives a vetoed one a shorter TTL
instead of no-store: `/api/asn-profile` caches a complete answer for 7 days and a
degraded one for 1 day (none inside the boot window); cfradar caches no partial
view answer (`isCompleteRadarAnswer`). The header is stamped on both `res.json` and
`res.send` (a PNG from `/api/ip-card`), and stashed on `res.locals.cacheControl`
for stream handlers. Only status < 400 gets
`public, max-age=N`, so CF never caches error pages, and handlers never touch
`Cache-Control` themselves. **Auth'd / per-user endpoints must not be wrapped** —
their caching belongs to the upstream that owns the auth context.

## Testing

- Handlers get smoke tests in `tests/api-handlers.test.js`: method gating, param branches, "API key missing" early returns. A new or touched handler ships its block in the same change.
- Never hit real upstreams — assert on branches that return before the first `fetchUpstream`, or stub `globalThis.fetch` when the behavior under test lives past it (restored in the shared `afterEach`).
- Middleware is covered by `tests/guards.test.js` — don't duplicate its assertions per handler. Fetch timeout / abort: `tests/fetch-with-timeout.test.js`.
