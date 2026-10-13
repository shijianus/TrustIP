# frontend/AGENTS.md

Conventions specific to the Vue 3 SPA under `frontend/`. Universal rules
(language, i18n, commits, testing) live in ../AGENTS.md.

## Overview

Vue 3 `<script setup>` + Pinia + vue-router (HTML5 history) + Tailwind CSS v4
over copied-in shadcn-vue primitives. Composition API everywhere; no TypeScript,
no Options API, no `dark:` dual pairs. Alias `@` → `frontend/`.

## Layout

```
App.vue · main.js · store.js · router/ · locales/ · style/style.css
firebase-init.js ← env-gated lazy Firebase Auth (boot path: utils/auth-hint.js)
sentry-init.js   ← env-gated Sentry (see "Error monitoring")
data/            ← static config — the tools registry drives router + cards + drawer
lib/ · utils/ · composables/   ← see "Conventions"
components/      ← sections + ip-infos/ advanced-tools/ report/ widgets/
                   svgicons/ ui/ dossier/ home/
```

Every file opens with a header comment stating its purpose — read those.

## Routing

`data/rail.js` is the single registry of destinations; `router/index.js` builds
one route per entry backed by a section or an advanced tool. A tool row may carry
`props` (bound by both `StandaloneTool.vue` and the drawer's `component :is`), which
is how one component serves several destinations: `AiServiceCheck.vue` is `/claude`
and `/gpt` as two rows with a different `service`, never two templates. Add the rail item
and the route, the header row and the standalone-chrome flag follow — a
hand-written `<router-link>` is how the row and the table disagree.

- **`/` renders `Home.vue`** and stops after the site routing table: the IP-query block and the table are the page, everything else is its own route. `components/home/` holds the two `/`-only sections and takes the visitor's address from the `ipinfo:finished` event rather than resolving it again, so it can't disagree with the cards on `/ipinfo`. No test *section* is mounted on `/`; the routing table's WebRTC evidence comes from a headless one-pass STUN gather instead — `composables/use-egress-leak.js` over `utils/webrtc-ice.js`, the same gatherer `/webrtc` uses, so there is one definition of what counts as a leak. It emits no event, writes no store state and enters no IP history: a visitor who never opened the WebRTC section must not be credited with running it, and the table only needed the address.
- **`composables/use-ip-cards.js` owns the address measurement**, not the card grid: `/` runs it for the summary card and the table, `IpInfos.vue` on `/ipinfo`. Exactly one is mounted and owns the `ipinfo:refresh` command — a second owner would resolve the visitor twice, differently.
- **`/<section>`** — one section in standalone chrome (`StandaloneSection`). **`/<tool alias>`** — an existing `/tools/:slug` under a short path; the canonical stays `/tools/<slug>`, which is what makes the alias safe.
- **`/ip` and `/ip/:ip`** — the dossier (`components/dossier/IpDossier.vue`), the one rail entry with neither `section` nor `tool`, so its route and its name in `App.vue`'s standalone set are written by hand.
- **`/#<SectionId>` no longer resolves on `/`**; `SECTION_ANCHOR_REDIRECTS` sends an old `/#WebRTC` to `/webrtc`.

### The routing table's destinations come from the server

`use-site-split.js` reads six signals (address country, system & version, IANA
zone, keyboard layout, language list, exit-vs-leak), POSTs them to `/api/split`,
and probes the work order that comes back. The judgement is made on the server
and never shipped to the browser (why: api/AGENTS.md):

- **Neither the scorer nor the catalog is bridged into the frontend** — `common/split-profile.js`, `common/timezone-countries.js` and `common/site-packs.js` are server-only, with deliberately no `utils/` bridge. `utils/latency-probes.js` is the one bridge: the six always-visible strip targets and the colour thresholds, nothing else. `utils/egress-attribution.js` is frontend-only by nature — it reads nothing but the rows this page already measured.
- **Nothing on screen explains the *guess*** — the row badge's country name is the whole of it. No score, no signal list, no "why these sites" panel; that request has been declined twice. The panel above the table explains *measurement*, which is a different subject: which address the visitor is, how many destinations were reached from each one, and which sites went out a different way.
- **A measured country is never out-voted** — every country one of the visitor's own addresses named (leak first, then the cards' geolocation, then the echoed exits) gets its pack, and the weighted guess only adds one more. `MIN_CONFIDENCE` is a floor on the guess, never on the evidence (server side: api/AGENTS.md).
- **`method: 'auto'` resolves at run time, never in the data file** — only a Cloudflare-fronted host answers `/cdn-cgi/trace`; a row with no address falls back to timing the connection and says which it measured. Pre-declaring a method is how the table lies after someone else changes their CDN.
- **A plan that fails is an empty table that says so** — no local fallback list; that list is the thing kept out of the bundle.
- **Slow signals fold into the running wave** — `ipinfo:finished` and a STUN answer routinely land mid-fan-out, so `replan()` queues a re-request instead of starting a second pool, and finished hosts are reused from `measured`, never re-probed.
- **The primary address is the leaked one, and only a leaked one** — `utils/egress-attribution.js` decides 主IP by `basis`: `webrtc` when a STUN server reflected a public address, else `volume` (the address the most destinations saw), else `source` (the visitor's own resolved IPv4), and returns which ruler decided. The busiest route is reported beside it as `defaultEgress`, never merged into it: on a Chinese split tunnel the machine and the road are in different countries, and averaging the two would invent a third. The remaining exits rank by how *few* destinations were reached from them — a minority route is the leak, a majority route is just the network.
- **One panel, then one flat list** (Website | IP | Geolocation) in server order: traffic ranking, then the shared block sorted by `groupRank`, then the canaries, then each picked country's rows in **catalog order** — a national pack's written order *is* that population's usage order, so re-sorting it by category is how 百度 ends up behind a chipmaker's corporate site. A ranking row has no address, so it shows what it did measure (sample dots, round trip) in the middle column, and its first column carries a rank chip plus a group chip — not the 国际 chip too.
- **"Egress addresses seen" is the union of three witnesses** — `knownExits` (every address the IP sources resolved, at the visitor's display count), what the homepage's STUN pass leaked, and the addresses the destinations echoed (`mergeEgressIps`), anything not already geolocated going through the same `/api/ipsb` lookup a row's address would. The rows alone under-report a network with a second exit.

## Conventions

- **Helpers shared with the backend live in `common/`**, re-exported through a thin `utils/` bridge so consumers keep `@/utils/...` imports (`utils/valid-ip.js`).
- **Helper placement:** Vue reactivity / lifecycle → `composables/` (`useXxx`); otherwise `utils/` (never `use-` prefixed). `lib/` stays shadcn-only. A pure function beside a composable exports from that composable's file.
- **The backend's address is a build flag, not a code change.** Every call site
  writes `/api/...`; `SITE_FUNCTIONS=1 vite build` bakes in a boot-time `fetch`
  rebase (`utils/site-functions-api.js`, installed from `main.js`) that sends
  same-origin `/api/*` to `/functions/v1/app/*`, which is where a Qoder Sites
  deployment can put server code. Unset, the bundle is untouched and the Express
  server answers `/api` as always. Third-party calls (traces, Globalping, DNS-leak
  providers, IP echoes) are never rebased — they are not this app's backend.
  The same build renames the `pt-BR` chunk to `pt_BR`: a locale tag plus a content
  hash spells a credential-shaped token, and the publishing platform rejects the
  artifact for it. The locale code itself is unchanged everywhere else.
- **`/api/configs` is how the two route tables reconcile, and a panel reads it
  before it calls.** Express mounts 34 routes and the edge function serves 11, so
  a component that just calls `/api/...` gets a 404 on the hosted build and renders
  it as a failed lookup — which tells the visitor the measurement was attempted and
  did not work. `trust` and `dossier` exist for exactly that reason: the panel
  declares the capability un-served instead. Adding an edge route means flipping its
  flag in `functions/shared/configs.js`; adding a *consumer* means honouring the
  flag. `tests/site-configs.test.js` pins that both halves expose the same key set
  and nothing on the edge is `true` for a route that is not in `handler.ts`.
- **A module a test imports uses relative specifiers with extensions** (`../store.js`, `../utils/getips/index.js`), not `@/`. The runner is plain `node --test`: it has no Vite alias resolution, so one `@/` in a chain makes the whole file unimportable and the module quietly goes untested — which is how `use-ip-cards.js` lost its settle-check coverage. `@/` stays the right choice for anything only the app loads (`*.vue` files, `data/`, `router/`).

### Events, commands, the report

- **Achievements are event-driven.** Components never touch the achievement system — they emit domain events unconditionally (`emitAppEvent('speedtest:finished', {…})` on `utils/app-events.js`); `data/achievement-rules.js` maps events → slugs and `composables/use-achievement-engine.js` owns every guard. New achievement = entry + rule + (only if no suitable event exists) a new event.
- **The shareable report rides the same bus.** Tests emit `<domain>:finished`; `composables/use-report-collector.js` normalizes via `utils/report-builders.js` into sections whitelisted by `common/report-schema.js`. New reportable test = event + builder + schema entry in the same change; changing result semantics means updating builder whitelist + schema enum too — builders fail soft and fixtures are frozen, so drift shows up as quietly missing fields, not errors. A report link is readable by anyone, so the **builder**, not the renderer, drops anything the visitor supplied (Persona: id / axis / verdict only, never the per-check `detail`; Invisibility: key + flag only).
- **Commands are the imperative twin of events** (`utils/app-commands.js`): an event says "this happened" (any subscribers); a command says "do this" — exactly one owner, and `dispatchAppCommand` resolves with the owner's result. Owners register via `composables/use-app-command.js` (scope-bound, setup-time); the payload is one plain JSON object whose shape the owner defines at its registration site. Handlers reject gated / invalid runs with `appCommandError(code, message)`; reserved codes `auth` / `quota` / `input`, plus `unavailable` / `timeout` from the bus. Cross-component triggers go through the bus, never template refs (refs stay for UI chrome).
- **Overlays take no keyboard shortcuts.** One document-level dispatcher (`utils/shortcut.js`) over the map `composables/use-shortcuts.js` registers — home-page actions only, cleared on Home unmount. The rule keys off form, not purpose: the `ui/` roots (`Dialog` / `Sheet` / `Drawer`) call `composables/use-overlay-shortcuts.js`, so anything built on them inherits it, and overlays nest. Esc and native scrolling keys stay with reka-ui / vaul / the browser.

### Advanced Tools gates decide listing only

`data/tools.js` gates (`requiresOriginalSite`, `requiresConfig: '<configs key>'`,
e.g. `asn` → `cloudFlare`) are read only via `isToolAvailable()`, by the card
grid and the nav; deep links (`?tool=`, `/tools/:slug`) are never gated.

### ASN Profile

- One `/api/asn-profile` request, one loading state, then the whole page; a
  section (reputation included — no `configs.originalSite` check) renders only
  when its `status` is `ok`. `ASNConnectivity.vue` gets `:expandable="false"
  :bordered="false"`; its defaults keep IPCard / QueryIP unchanged.
- `peeringdb` is operator self-reporting: vocabularies → locale keys
  (`PEERING_ENUMS`), names / cities as written. `ASN_PROFILE_TIMEOUT_MS` stays
  above the largest backend section deadline (tested).
- ASN Info's footer links `/tools/asn?q=AS<n>` (hidden when gated off); in
  QueryIP it emits `open-tool` via IpDetailPanel so the dialog closes first.

### Error monitoring (Sentry) is env-gated and invisible to app code

No `VITE_SENTRY_DSN_FRONTEND` → no Sentry in the bundle at all (build-time-gated
dynamic import, like `firebase-init.js`), and `main.js` skips the load under
`import.meta.env.DEV`, so `pnpm dev` reports nothing even with a DSN in `.env`.

- **Never import `@sentry/vue` in app code** — a static import drags the SDK into the main bundle. All config lives in `sentry-init.js`.
- **Signals ride the app-events bus**: components emit, `sentry-init.js` subscribes. The only one is `ip-source:exhausted` (a card's whole source chain failed), emitted only when another card resolved a valid IP of the same version — otherwise no-IPv6 / dead-network visitors are routine noise.
- `console.error` is captured and fingerprinted on its first argument, so name the failure there; `utils/getips/` source failures stay `console.warn`, invisible by design. Replay leaves page text unmasked deliberately (typed input masked; stated in the privacy policy). Backend 5xx is not captured frontend-side. Envelopes ship through the first-party tunnel `/api/monitoring` to beat ad blockers.

## UI system

**shadcn-vue first:** check `components/ui/`, then the shadcn-vue docs for
something to copy in; hand-rolled Tailwind only when neither fits. Keep across
upstream syncs: `Spinner` + `ToolLoadingSkeleton`, the `toggle` /
`toggle-group` `primary` pressed pair, the overlay roots' shortcut suspension,
and `select`'s trigger geometry (`py-1` + a flex value span, not `-webkit-box`
line-clamp — Safari lifts overflowing button content ~2px).

### Design tokens and status tones

Four business-semantic colors with paired `-foreground` at the top of
`style/style.css`: `--info` (waiting) · `--success` (ok-fast) · `--warning`
(ok-slow) · `--action` (run / trigger). Semantic tokens only, never `dark:` dual
pairs — tokens theme themselves. Button adds `action` / `success` variants; Badge
adds `success` and has hover globally disabled (display element — wrap it for
interactivity). FAB colors stay semantic, max two accents at once: `action` =
trigger, `default` = stateless panel, `success` = protective state active,
`secondary` = dock. Every business state → color mapping goes through
`composables/use-status-tone.js` (`wait` / `ok-fast` / `ok-slow` / `fail`),
normally via `ipFieldTone()` — no hand-rolled switches.

### Canonical patterns

Copy the named exemplar rather than re-inventing; the exemplar's classes are the
spec.

- **Trigger button** — `variant="action"` + `<Spinner v-if />` + `:disabled`; **input + icon trigger** — flex row, compact icon Button, no text label (QueryIP, Whois).
- **AutoFill-proof inputs** — all six attributes on every free-form Input (`autocomplete` / `autocorrect` / `autocapitalize` / `spellcheck` / `data-1p-ignore` / `data-lpignore`); placeholder copy avoids "address / 地址 / adresse / adresi", which iOS QuickType keys on.
- **Status card** — `keyboard-shortcut-card jn-card` + hover lift (IPCard): `jn-card` = shadow / border / outline, `keyboard-shortcut-card` = J/K target.
- **Flag** — `<Icon :icon="'circle-flags:' + code.toLowerCase()" />`.
- **Site icon** — `<SiteIcon :icon :name :seed :size />` (`widgets/`). The icon id lives on the catalog row (`common/site-packs.js` → `row.icon`; `CONNECTIVITY_PROBES` for the homepage strip), never in the component, and the PNG is committed at `public/favicons/<id>.png` (`pnpm fetch-favicons`), so no third-party icon service is contacted at render time. A new destination means a new icon id — `tests/site-split.test.js` fails on a row with no committed PNG, except the three documented sources that only ever return something undecodable and fall back to `Monogram`.
- **Dates & times** — through `utils/time-utils.js` with the vue-i18n locale; no hand-rolled `toLocaleDateString` / `Intl.DateTimeFormat` (exceptions carry a why-comment).
- **Fit-to-width** — IP / MAC strings in `<FitText>` (`HERO_TIERS` / `INLINE_TIERS`, `:max-lines="2"` on heroes), never length-threshold helpers.
- **Filter tags** — an open-ended facet row is a wrapping `ToggleGroup` of detached pills at `spacing=2` (IPHistory, DnsResolver), never the default `spacing=0` connected form whose seam breaks as soon as it wraps.
- **Shareable tool input** — read the query from `route.query.q` on mount, write it back with `router.replace` on every run (IpCalculator); works on `/tools/<slug>?q=` and `/?tool=<slug>&q=`.
- **Fixed option sets** — a known closed list is a `Select`, not a toggle row, once it outgrows a comfortable line (DnsResolver record types, MtrTest targets).
- **Qualifier + input + run** — `ButtonGroup` around the `Select` + `Input` so they read as one bordered control, a nested one around the run Button for the gap (DnsResolver). The trigger needs `w-auto shrink-0` — our `SelectTrigger` predates `data-slot` — and the row stays unwrapped at every width.
- **Tables vs lists** — real per-column header semantics → `<table>`; otherwise a bordered rounded `<ul>` with `divide-y`.
- **Key/value panels** — `widgets/KeyRow.vue` in a dashed `divide-y` `<dl>`, never a hand-rolled label/value row: `wide` for values that truncate, plain for values that wrap, and no `shrink-0` on either half. Headings from `widgets/SectionTitle`, verdicts from `widgets/VerdictChip`, and a capability this build does not measure is a `widgets/CapabilitySlot` naming what it needs — an absent row is a bug, a declared gap is information.
- **Dialog header** — `<DialogHeader :icon :title />`. **Drawer vs Sheet** — vaul bottom Drawer for the Advanced Tools panel and full-bleed expansions of an inline visual; side panels use `Sheet`.
- **Motion** — the hover lift is `transition-transform duration-300 ease-out hover:-translate-y-1.5`; loading is `<Spinner />`, never pulse-dots.

## Testing

Composables and utils are the target (`tests/composable-*.test.js`); Vue
rendering and browser APIs are out of scope for the Node runner. Visual changes
can't be self-tested — say so and let the user verify in `pnpm dev`.
