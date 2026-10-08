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
//   section   — the DOM id of the home-page section this item's page renders
//               (`<h2 id>` inside the section component). It names which
//               component StandaloneSection.vue mounts and keys
//               SECTION_PAGE_BY_ID; it is no longer a scroll target, because
//               `/` does not host these sections any more.
//   tool      — destination is an advanced tool: its registry slug. The router
//               registers the path as an alias of `/tools/:slug`, so
//               data/tools.js keeps owning the component and this file owns the
//               address. One concern each, no duplication.
//
// `/ip` carries neither: the IP dossier page is registered by its own work, and
// the rail links to it either way. Until that route lands the router's
// catch-all sends it back to `/`.

export const RAIL_ITEMS = [
  { id: 'home', path: '/' },
  { id: 'ipinfo', path: '/ipinfo', section: 'IPInfo' },
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
export const RAIL_BY_TOOL = new Map(
  RAIL_ITEMS.filter((item) => item.tool).map((item) => [item.tool, item]),
);

// Section id → the page that renders it. The keyboard shortcuts drive a section
// by going to its page (which boots the test on arrival) rather than scrolling
// to it, because `/` no longer holds the sections.
export const SECTION_PATHS = new Map(
  RAIL_ITEMS.filter((item) => item.section).map((item) => [item.section, item.path]),
);

// A rail item owns a route when it is backed by a section page or a tool
// alias. `/` is the exception it proves: it carries no section at all now that
// the dashboard ends at the routing table, so it has no `section` to name and
// is not a page in this sense — it is the route everything else hangs off.
export const isRailPage = (item) => item.path !== '/' && Boolean(item.section || item.tool);

export const RAIL_PAGE_ITEMS = RAIL_ITEMS.filter(isRailPage);

// Rail destinations that render standalone chrome (their own in-flow header
// instead of the dashboard's fixed Nav). App.vue drops the body padding for
// exactly this set.
export const STANDALONE_RAIL_NAMES = RAIL_PAGE_ITEMS.map((item) => item.id);

// The link a rail item carries: its own route, always.
//
// This used to bend: while the visitor was on `/`, an item naming one of the
// dashboard's sections scrolled to that section instead of navigating. `/` no
// longer holds those sections — it ends at the routing table — so every item is
// a page and the row is a navigation rail at every width, on every route. The
// old `/#<SectionId>` links are redirected to their page by the router rather
// than resolved here, so a shared link still lands somewhere that exists.
export const resolveRailTarget = (item) => ({ path: item.path });

// Which rail item should read as current.
//
// `/` shows two blocks and owns no section, so the home item is simply current
// by being the route. Anywhere else the path decides, through the aliases the
// router registers: a tool's canonical `/tools/<slug>` and the rail's own short
// path light the same item, and a parameterised page (`/ip/1.2.3.4`) stays under
// its rail root.
export const resolveRail = (path) => {
  if (path === '/') return RAIL_BY_PATH.get('/');

  const exact = RAIL_BY_PATH.get(path);
  if (exact) return exact;

  const [root = '', second = ''] = path.split('/').filter(Boolean);
  if (root === 'tools') return RAIL_BY_TOOL.get(second) ?? null;
  return RAIL_BY_PATH.get(`/${root}`) ?? null;
};

// ── Section-backed pages ─────────────────────────────────────────────────────
//
// A section page renders the component that section owns, in standalone chrome.
// The section keeps reporting into `store.mountingStatus`, keeps owning its
// command on utils/app-commands.js and keeps its `<h2 id>` heading; what the
// page adds is the chrome around it (header, footer, head tags) and a boot
// dispatch for the tests the dashboard's orchestrator would otherwise have
// started.
//
// `boot` is that command, replayed here: a page whose whole subject is one test
// should run it on arrival. The shared `autoRun*` preferences stay a dashboard
// concern — they answer "which of the modules should I start unprompted", and
// here the visitor already asked for this one. Sections with no boot command
// (SpeedTest, AdvancedTools) idle behind their own Run control.
//
// The component is deliberately NOT named here: StandaloneSection.vue holds the
// section → component map. This file is imported by the router, by App.vue and
// by the Node test runner, and none of them has any use for a `.vue` reference
// — which is also why the tool-backed items name a slug and let data/tools.js
// keep the component.
export const RAIL_SECTION_PAGES = [
  {
    section: 'IPInfo',
    titleKey: 'ipInfos.Title',
    noteKey: 'ipInfos.Notes',
    boot: { command: 'ipinfo:refresh', payload: {} },
  },
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
