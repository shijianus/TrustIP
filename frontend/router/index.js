import { createRouter, createWebHistory } from 'vue-router';
import Home from '@/components/Home.vue';
import { RAIL_PAGE_ITEMS } from '@/data/rail.js';

// Real pages:
//   /              → the homepage. Advanced tools open as an in-page drawer,
//                    driven by the `?tool=<slug>` query (handled in Advanced.vue).
//   /tools/:slug   → a standalone full page for one tool (shareable + SEO).
//   /r/:id         → read-only shared diagnostic report (KV-backed, noindex).
//   one per rail item → the flat route rail (frontend/data/rail.js). Each entry
//                    below is that rail item's own address, registered from the
//                    rail registry rather than hand-written, so the row at the
//                    top of the page and the route table cannot disagree:
//   /<section>     → a home-page section on its own page (StandaloneSection).
//                    `/` and `/link` mount the SAME component — the dashboard's
//                    scroll-spy, mounting-status and shortcut wiring are
//                    therefore untouched, and a section change lands on both
//                    halves in one build. `/` keeps every section inline, so the
//                    two coexist by sharing the component, not by copying it.
//   /<tool alias>  → an existing /tools/:slug page under a short path. Same
//                    component record, with the slug in `meta`; StandaloneTool
//                    resolves `params.slug ?? meta.tool`. The tool page keeps
//                    its canonical on /tools/<slug>, which is what makes the
//                    alias safe rather than a second copy of the content.
//   /ip            → deliberately absent: the IP dossier page is registered by
//                    that work. The rail links it either way; until the route
//                    lands the catch-all below sends it back to `/`.
//
// Home is imported eagerly (it's the default landing); everything else is
// lazy so it stays out of the homepage bundle.
const StandaloneTool = () => import('@/components/StandaloneTool.vue');
const StandaloneSection = () => import('@/components/StandaloneSection.vue');
const IpDossier = () => import('@/components/dossier/IpDossier.vue');
const PrivacyPolicy = () => import('@/components/PrivacyPolicy.vue');
const ReportPage = () => import('@/components/report/ReportPage.vue');

// Rail destinations, in rail order. A section-backed item gets the section
// page; a tool-backed item aliases the tool page.
const railRoutes = RAIL_PAGE_ITEMS.map((item) => (
  item.section
    ? { path: item.path, name: item.id, component: StandaloneSection, meta: { section: item.section } }
    : { path: item.path, name: item.id, component: StandaloneTool, meta: { tool: item.tool } }
));

const routes = [
  { path: '/', name: 'home', component: Home },
  ...railRoutes,
  // The dossier is the rail's one destination that is neither a dashboard
  // section nor an existing tool, so it is not derived from the registry — it
  // is the reason the registry has an entry with neither `section` nor `tool`.
  // `/ip` asks about the visitor's own address; `/ip/:ip` about any other, and
  // that form is the shareable, linkable one.
  { path: '/ip', name: 'ip', component: IpDossier },
  { path: '/ip/:ip', name: 'ip-address', component: IpDossier },
  { path: '/tools/:slug', name: 'tool', component: StandaloneTool },
  { path: '/privacy', name: 'privacy', component: PrivacyPolicy },
  { path: '/r/:id', name: 'report', component: ReportPage },
  // Unknown paths fall back to the homepage.
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // `/#<SectionId>` is Home's to resolve: it owns the sections, and it is the
    // one place that knows when they are actually on screen. Jumping here from
    // the router would race the first paint on a fresh load of such a URL (the
    // anchor may not exist yet, and the router reads it only once) and would
    // fight Home's own scroll on an in-app one. See
    // composables/use-section-hash.js.
    if (to.path === '/' && to.hash) return false;
    // Opening/closing the drawer only flips the query on the home route — don't
    // scroll the homepage in that case. Genuine page changes go to the top.
    if (to.path === from.path) return false;
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

export default router;
