// The flat route rail — the app's information architecture in one row.
//
// One entry per destination, in display order, and the single list everything
// else reads: Nav.vue (the dashboard header), StandalonePageHeader.vue (the
// standalone pages' header), the router and App.vue's chrome switch. Nothing
// hand-writes a rail link, so the row and the routes cannot drift apart.
//
// Each item carries a full and a short label, resolved from the locale packs as
// `rail.full.<id>` / `rail.short.<id>`. CSS — not the data — decides which one
// shows (see NavRail.vue), so the collapse is one breakpoint everywhere and no
// locale ever needs a second list.
//
// Entry shape:
//   id        — stable key; the i18n label suffix, the route name and the
//               analytics name. Never reuse for a different destination.
//   path      — the route the item links to
//   section   — destination is also a section of the dashboard: that section's
//               DOM id, which the scroll-spy reports (`store.currentSection`).
//               Three uses: on `/` the item whose section is on screen lights
//               up, that item links to the section's anchor on `/` instead of
//               navigating away (resolveRailTarget), and a shared
//               `/` + `#<SectionId>` link resolves to the same place
//               (composables/use-section-hash.js).
//   tool      — destination is an advanced tool: its registry slug. The router
//               registers the path as an alias of `/tools/:slug`, so
//               data/tools.js keeps owning the component and this file owns the
//               address. One concern each, no duplication.
//
// `/ip` carries neither: the IP dossier page is registered by its own work, and
// the rail links to it either way. Until that route lands the router's
// catch-all sends it back to `/`.

export const RAIL_ITEMS = [
  { id: 'home', path: '/', section: 'IPInfo' },
  { id: 'ip', path: '/ip' },
  { id: 'link', path: '/link', section: 'Connectivity' },
  { id: 'webrtc', path: '/webrtc', section: 'WebRTC' },
  { id: 'dns', path: '/dns', section: 'DNSLeakTest' },
  { id: 'speedtest', path: '/speedtest', section: 'SpeedTest' },
  { id: 'ping', path: '/ping', tool: 'pingtest' },
  { id: 'status', path: '/status', tool: 'servicestatus' },
  { id: 'whois', path: '/whois', tool: 'whois' },
  { id: 'tools', path: '/tools', section: 'AdvancedTools' },
];

export const RAIL_BY_PATH = new Map(RAIL_ITEMS.map((item) => [item.path, item]));
export const RAIL_BY_SECTION = new Map(
  RAIL_ITEMS.filter((item) => item.section).map((item) => [item.section, item]),
);
export const RAIL_BY_TOOL = new Map(
  RAIL_ITEMS.filter((item) => item.tool).map((item) => [item.tool, item]),
);

// A rail item owns a route when it is backed by a section page or a tool
// alias. The dashboard is the exception it proves: `home` names the IPInfo
// section because the scroll-spy lights it while that section is on screen, but
// `/` renders Home.vue, which carries the fixed Nav — not standalone chrome.
export const isRailPage = (item) => item.path !== '/' && Boolean(item.section || item.tool);

export const RAIL_PAGE_ITEMS = RAIL_ITEMS.filter(isRailPage);

// Rail destinations that render standalone chrome (their own in-flow header
// instead of the dashboard's fixed Nav). App.vue drops the body padding for
// exactly this set.
export const STANDALONE_RAIL_NAMES = RAIL_PAGE_ITEMS.map((item) => item.id);

// Rail items whose destination is also a section of the dashboard — the set
// that can be reached either way, as a page or as an anchor on `/`.
export const RAIL_ANCHOR_PATHS = new Set(
  RAIL_PAGE_ITEMS.filter((item) => item.section).map((item) => item.path),
);

// The link a rail item should carry, given where the visitor already is.
//
// On `/` the dashboard is showing every one of its sections, so a rail item
// that names one scrolls to it rather than navigating away: the destination the
// anchor row used to be, kept available now that the same target also has a page
// of its own. Anywhere else — and for any destination that is not a section —
// the item is a route, so the row stays a navigation rail instead of turning
// into a scroll list that does nothing on a page without those sections.
//
// Returns a vue-router location: `{ path }`, or `{ path: '/', hash }` for the
// in-dashboard case. The hash keeps its leading `#` — that is how the section
// ids appear in a URL, and an href without it would not be a fragment.
export const railAnchorTarget = (path) => ({
  path: '/',
  hash: `#${RAIL_BY_PATH.get(path)?.section ?? ''}`,
});

export const resolveRailTarget = (item, currentPath) =>
  currentPath === '/' && RAIL_ANCHOR_PATHS.has(item.path)
    ? railAnchorTarget(item.path)
    : { path: item.path };

// Which rail item should read as current.
//
// On `/` there is no destination to match, so the scroll-spy section takes
// over — the same item that used to be highlighted as an anchor row. Anywhere
// else the path decides, through the aliases the router registers: a tool's
// canonical `/tools/<slug>` and the rail's own short path light the same item,
// and a parameterised page (`/ip/1.2.3.4`) stays under its rail root.
export const resolveRail = (path, currentSection = null) => {
  if (path === '/') return RAIL_BY_SECTION.get(currentSection) ?? RAIL_BY_PATH.get('/');

  const exact = RAIL_BY_PATH.get(path);
  if (exact) return exact;

  const [root = '', second = ''] = path.split('/').filter(Boolean);
  if (root === 'tools') return RAIL_BY_TOOL.get(second) ?? null;
  return RAIL_BY_PATH.get(`/${root}`) ?? null;
};

// ── Section-backed pages ─────────────────────────────────────────────────────
//
// A section page renders the SAME component the dashboard renders — the same
// file, mounted once per route — so `/` and `/link` cannot drift: a change to
// ConnectivityTest.vue lands on both in the same build. That shared mount is
// also why the dashboard keeps its own behaviour untouched: the section keeps
// reporting into `store.mountingStatus`, keeps owning its command on
// utils/app-commands.js and keeps its `<h2 id>` anchor, all of which Home.vue
// drives exactly as before. What the page adds is chrome around it (header,
// footer, head tags) and a boot dispatch for the tests the orchestrator would
// otherwise have started.
//
// `boot` is the command the dashboard's refresh orchestrator dispatches for
// that section, replayed here: a page whose whole subject is one test should
// run it on arrival. The shared `autoRun*` preferences stay a dashboard
// concern — they answer "which of six modules should I start unprompted", and
// here the visitor already asked for this one. Sections with no boot command
// (SpeedTest, AdvancedTools) idle behind their own Run control on the
// dashboard too.
//
// The component is deliberately NOT named here: StandaloneSection.vue holds the
// section → component map. This file is imported by the router, by App.vue and
// by the Node test runner, and none of them has any use for a `.vue` reference
// — which is also why the tool-backed items name a slug and let data/tools.js
// keep the component.
export const RAIL_SECTION_PAGES = [
  {
    section: 'Connectivity',
    titleKey: 'connectivity.Title',
    noteKey: 'connectivity.Note',
    boot: { command: 'connectivity:run', payload: { trigger: 'boot' } },
  },
  {
    section: 'WebRTC',
    titleKey: 'webrtc.Title',
    noteKey: 'webrtc.Note',
    boot: { command: 'webrtc:run', payload: {} },
  },
  {
    section: 'DNSLeakTest',
    titleKey: 'dnsleaktest.Title',
    noteKey: 'dnsleaktest.Note',
    boot: { command: 'dnsleak:run', payload: {} },
  },
  {
    section: 'SpeedTest',
    titleKey: 'speedtest.Title',
    noteKey: 'speedtest.Note',
  },
  {
    section: 'AdvancedTools',
    titleKey: 'advancedtools.Title',
    noteKey: 'advancedtools.Note',
  },
];

export const SECTION_PAGE_BY_ID = new Map(RAIL_SECTION_PAGES.map((page) => [page.section, page]));
