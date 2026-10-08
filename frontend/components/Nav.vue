<template>
  <!-- iOS PWA safe-area painter. Pairs with apple-mobile-web-app-status-bar-style=black-translucent
       in index.html — the only way to get a live status-bar tint on iOS PWA, since WebKit
       ignores JS theme-color writes and media-variant theme-color tags in standalone mode.
       Color tracks --page-bg (style.css), which follows .dark class. -->
  <div class="fixed top-0 left-0 right-0 z-50 pointer-events-none transition-colors duration-300"
    style="height: env(safe-area-inset-top); background: var(--page-bg);" aria-hidden="true"></div>
  <header
    class="fixed top-[env(safe-area-inset-top)] left-0 right-0 z-40 w-full border-b transition-transform duration-300 ease-out will-change-transform"
    :class="{ '-translate-y-full': isNavHidden,
    'bg-background/80 supports-[backdrop-filter:blur(0px)]:bg-background/60 backdrop-blur': !isPwa || (isPwa && !isMobile),
    'bg-page-bg': isPwa && isMobile }">
    <nav id="navbar-top" class="mx-auto flex w-full max-w-[1600px] items-center gap-2 px-3 sm:px-4 h-14">

      <!-- Left: Hamburger (only mobile) + Brand -->
      <div class="flex items-center gap-2">
        <Button v-if="isMobile" variant="ghost" size="icon" class="size-8" :aria-expanded="isNavMenuOpen"
          aria-label="Toggle navigation menu" @click="store.toggleSheet('navMenu')">
          <Menu />
        </Button>
        <a href="#" @click="handleLogoClick"
          class="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-lg font-semibold text-foreground no-underline hover:opacity-80 transition-opacity">
          <BrandWordmark :loading="!loaded" />
        </a>
      </div>

      <!-- GitHub repo link + star count from our own /api/github-stars
           (edge-cached). The count is hidden until it lands / on error, so the
           link itself never depends on the fetch. It used to sit beside the
           in-page anchor row; that row is the route rail on the next line. -->
      <div v-if="!isMobile" class="flex items-center gap-0.5">
        <Badge variant="outline" v-if="githubStarsLabel">
          <a :href="t('page.footerLink')" target="_blank" rel="noopener" class="inline-flex items-center gap-1"
            aria-label="Star on GitHub" title="Star on GitHub">
            <Icon icon="ri:star-fill" class="size-3.5 text-yellow-400" />
            <span class="tabular-nums">{{ githubStarsLabel }}</span>
            <Icon icon="ri:github-line" class="size-3.5" />
          </a>
        </Badge>
      </div>

      <!-- Right: Action area (ml-auto push to the right) -->
      <div class="ml-auto flex items-center gap-2">
        <!-- Earth Online entry (code name: pulse) -->
        <Pulse />

        <!-- Theme mode — reachable from the header on every page, not only
             from inside the preferences sheet. -->
        <ThemeToggle />

        <!-- Docs assistant entry point (ask box on desktop, icon on mobile) -->
        <DocsSearch />

        <!-- Preferences — standalone cog only for Firebase-less self-hosted
             instances (no user menu to host it). With the user system on,
             preferences lives inside the user dropdown for every state. -->
        <JnTooltip v-if="!isFireBaseSet" :text="t('nav.preferences.title')">
          <Button variant="ghost" size="icon" class="size-8 cursor-pointer" aria-label="Open preferences"
            @click="OpenPreferences">
            <Cog />
          </Button>
        </JnTooltip>

        <!-- Sign In / User Dropdown -->
        <DropdownMenu v-if="isFireBaseSet">
          <DropdownMenuTrigger as-child>
            <!-- Not signed in: the solid block reads as the "sign in"
                 call-to-action, and the menu opens on the sign-in options, so
                 the affordance is self-explaining one click deep. -->
            <Button v-if="!isSignedIn" size="sm" @click="getUserInfo" class="h-8 gap-1 px-1.5 cursor-pointer"
              aria-label="User menu">
              <UserRound class="size-5" />
              <ChevronDown class="opacity-60" />
            </Button>
            <!-- Signed in: avatar + chevron -->
            <Button v-else variant="ghost" size="sm" @click="getUserInfo" class="h-8 gap-1 px-1 cursor-pointer"
              aria-label="User menu">
              <span class="inline-flex size-7 overflow-hidden rounded-full">
                <img :src="userPhotoURL" :alt="userName" :title="userName" class="size-full object-cover"
                  referrerpolicy="no-referrer">
              </span>
              <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" class="w-56 shadow-md">
            <!-- Signed in -->
            <template v-if="isSignedIn">
              <div class="px-2 pt-2 pb-3">
                <div class="flex items-center gap-3">
                  <span class="inline-flex size-10 overflow-hidden rounded-full shrink-0">
                    <img :src="userPhotoURL" :alt="userName" class="size-full object-cover"
                      referrerpolicy="no-referrer">
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="truncate text-sm font-semibold leading-none">{{ userName }}</span>
                    <span v-if="remoteUserInfoFetched && remoteUserInfo.userLevel">
                      <Badge :class="levelBadgeClass"
                        class="border-transparent text-[10px] font-medium px-1.5 py-0 h-4">
                        {{ t('user.Level.' + remoteUserInfo.userLevel) }}
                      </Badge>
                    </span>
                    <span v-else-if="!remoteUserInfoFetched" class="text-xs text-muted-foreground">{{
                      t('user.Fields.Fetching') }}</span>
                  </div>
                </div>
                <dl class="mt-3 space-y-1 text-xs">
                  <div class="flex items-baseline justify-between gap-2">
                    <dt class="text-muted-foreground">{{ t('user.Fields.CreatedAt') }}</dt>
                    <dd class="font-medium">{{ userCreatedAt }}</dd>
                  </div>
                  <!-- How this account signs in. One account per email
                       address, so this is also the only way in. -->
                  <div v-if="linkedProviders.length" class="flex items-baseline justify-between gap-2">
                    <dt class="text-muted-foreground">{{ t('user.Fields.SignInMethods') }}</dt>
                    <dd class="flex min-w-0 items-center gap-1.5 font-medium">
                      <span v-for="provider in linkedProviders" :key="provider.providerId"
                        class="inline-flex items-center gap-1" :title="provider.label">
                        <Icon v-if="provider.icon" :icon="provider.icon" class="size-3.5 shrink-0" />
                        <span>{{ provider.label }}</span>
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="cursor-pointer" @select="store.setTriggerAchievements(true)">
                <Award />
                <span>{{ t('user.MyAchievements') }}</span>
              </DropdownMenuItem>
            </template>

            <!-- Not signed in -->
            <template v-else>
              <DropdownMenuItem class="cursor-pointer" @select="store.signInWithGoogle">
                <Icon icon="ri:google-line" />
                <span>{{ t('user.SignInWithGoogle') }}</span>
              </DropdownMenuItem>
              <DropdownMenuItem class="cursor-pointer" @select="store.signInWithGithub">
                <Icon icon="ri:github-line" />
                <span>{{ t('user.SignInWithGithub') }}</span>
              </DropdownMenuItem>
            </template>

            <DropdownMenuSeparator />
            <DropdownMenuItem class="cursor-pointer" @select="OpenPreferences">
              <Cog />
              <span>{{ t('nav.preferences.title') }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer" @select="store.setTriggerUserBenefits(true)">
              <HeartHandshake />
              <span>{{ t('user.Benefits.Title') }}</span>
            </DropdownMenuItem>

            <template v-if="isSignedIn">
              <DropdownMenuSeparator />
              <DropdownMenuItem class="cursor-pointer" @select="store.signOut">
                <LogOut />
                <span>{{ t('user.SignOut') }}</span>
              </DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>

    <!-- The flat route rail, on its own row under the brand row. It replaces
         the old in-page anchor row: the destinations are pages now, one per
         tool, and the dashboard keeps every section inline underneath it.
         Its own row (rather than squeezed into the brand row) is what lets the
         same ten items read at 1440px and scroll as a strip at 390px. -->
    <NavRail />

    <!-- Mobile navigation drawer. Flex column so the link list scrolls instead
         of clipping on short screens when Advanced Tools is expanded. -->
    <Sheet v-if="isMobile" :open="isNavMenuOpen" @update:open="onNavMenuChange">
      <SheetContent side="left" class="w-80 p-0 flex flex-col gap-0" :title="t('nav.Navigation')">
        <div class="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <h5 class="m-0 text-base font-semibold">{{ t('nav.Navigation') }}</h5>
          <SheetClose />
        </div>
        <nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          <template v-for="item in navItems" :key="item.id">
            <!-- Advanced Tools expands inline into its sub-tools (open by default)
                 so they're discoverable, not hidden behind a bare label. -->
            <Collapsible v-if="item.id === 'AdvancedTools'" v-model:open="mobileToolsOpen">
              <CollapsibleTrigger as-child>
                <button type="button"
                  :class="[navLinkClass(item.id, { block: true }), 'flex w-full items-center justify-between']">
                  <span>{{ t(`nav.${item.id}`) }}</span>
                  <ChevronDown class="size-4 shrink-0 opacity-60 transition-transform duration-200"
                    :class="{ 'rotate-180': mobileToolsOpen }" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div class="my-0.5 ml-3 flex flex-col gap-0.5 border-l pl-3">
                  <button v-for="tool in advancedTools" :key="tool.slug" type="button"
                    class="block w-full rounded-md px-3 py-1.5 text-left text-sm leading-snug text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                    @click="openTool(tool.slug)">
                    {{ t(tool.titleKey) }}
                  </button>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <!-- All other sections are their own page now, so the menu links to
                 them. They used to smooth-scroll to the section on `/`, which is
                 what made the homepage one long slide between modules. -->
            <RouterLink v-else :to="item.path" :class="navLinkClass(item.id, { block: true })"
              @click="store.setOpenSheet(null)">
              {{ t(`nav.${item.id}`) }}
            </RouterLink>
          </template>
          <a :href="t('page.footerLink')" target="_blank" rel="noopener"
            class="mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
            <Icon icon="ri:github-line" class="size-4" />
            <span>Star on GitHub</span>
            <!-- Same /api/github-stars count as the desktop badge (fetched on
                 mount); hidden until it lands / on error. -->
            <span v-if="githubStarsLabel"
              class="ml-auto tabular-nums text-muted-foreground inline-flex items-center gap-1">
              <Icon icon="ri:star-fill" class="size-3.5 text-yellow-400" />
              {{ githubStarsLabel }}
            </span>
          </a>
        </nav>
      </SheetContent>
    </Sheet>
  </header>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMainStore } from '@/store';
import { useI18n } from 'vue-i18n';
import { trackEvent } from '@/utils/analytics';
import { unixToDateTime } from '@/utils/time-utils';
import { Sheet, SheetContent, SheetClose } from '@/components/ui/sheet';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JnTooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Award, ChevronDown, UserRound, HeartHandshake,
  LogOut, Menu, Cog,
} from '@lucide/vue';
import DocsSearch from '@/components/widgets/DocsSearch.vue';
import NavRail from '@/components/NavRail.vue';
import Pulse from '@/components/widgets/Pulse.vue';
import ThemeToggle from '@/components/widgets/ThemeToggle.vue';
import { Icon } from '@iconify/vue';
import BrandWordmark from '@/components/widgets/BrandWordmark.vue';
import { RAIL_PAGE_ITEMS } from '@/data/rail.js';
import { ADVANCED_TOOLS } from '@/data/tools.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import { formatStarCount } from '@/utils/format-star-count.js';
import { isRunningAsPwa } from '@/utils/pwa.js';

const { t, locale } = useI18n();
const store = useMainStore();
const router = useRouter();
const route = useRoute();

const isMobile = computed(() => store.isMobile);
const loaded = computed(() => store.allHasLoaded);

// Running as an installed PWA (chromeless window). Distinct from the app's
// "standalone tool pages" — see utils/pwa.js.
const isPwa = isRunningAsPwa();

// The section pages, in rail order, so the mobile menu and the rail can never
// disagree about which sections exist or where they live.
const navItems = RAIL_PAGE_ITEMS.filter((item) => item.section);

// Tools shown in the nav, mirroring Advanced.vue's enabledCards: original-site-
// only tools stay hidden on self-hosted instances. Reactive on configs.
const configs = computed(() => store.configs);
const advancedTools = computed(() =>
  ADVANCED_TOOLS.filter((tool) => !tool.requiresOriginalSite || configs.value.originalSite),
);

// Mobile: Advanced Tools sub-list expanded by default for discoverability.
const mobileToolsOpen = ref(true);

// GitHub star count for the repo badge. Fetched from our own edge-cached
// endpoint; stays null (badge hides the count) if the request fails.
const githubStars = ref(null);
const githubStarsLabel = computed(() => formatStarCount(githubStars.value));
const fetchGithubStars = async () => {
  try {
    const res = await fetchWithTimeout('/api/github-stars');
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.stars === 'number') githubStars.value = data.stars;
  } catch {
    /* leave the badge without a count */
  }
};

// nav link style — the destination currently on screen reads as pressed
const navLinkClass = (id, { block = false } = {}) => {
  const base = 'rounded-md px-3 py-1.5 text-sm font-medium no-underline cursor-pointer transition-colors';
  const state = id === route.meta.section
    ? 'bg-accent text-accent-foreground'
    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground';
  return [base, state, block ? 'block' : ''].filter(Boolean).join(' ');
};

// Firebase / User
const isFireBaseSet = computed(() => store.isFireBaseSet);
const isSignedIn = computed(() => store.isSignedIn);
const userName = computed(() => store.user?.displayName);
const userPhotoURL = computed(() => store.user?.photoURL);
const userCreatedAt = computed(() => unixToDateTime(store.user?.metadata.createdAt, locale.value));
const remoteUserInfo = computed(() => store.remoteUserInfo);
const remoteUserInfoFetched = computed(() => store.remoteUserInfoFetched);
// Sign-in methods attached to this account.
const linkedProviders = computed(() => store.linkedProviders);

// Level Badge Color: mapped to semantic token, keep each level color distinction
const levelBadgeClass = computed(() => {
  const level = remoteUserInfo.value?.userLevel;
  switch (level) {
    case 'Premium': return 'bg-action text-action-foreground';
    case 'Owner': return 'bg-foreground text-background';
    case 'Developer': return 'bg-success text-success-foreground';
    case 'HonoraryMember': return 'bg-warning text-warning-foreground';
    case 'Standard':
    default: return 'bg-muted-foreground text-background';
  }
});

const getUserInfo = async () => {
  if (remoteUserInfoFetched.value || !isSignedIn.value) return;
  store.setTriggerRemoteUserInfo(true);
};


const isNavMenuOpen = computed(() => store.openSheet === 'navMenu');
const onNavMenuChange = (val) => {
  store.setOpenSheet(val ? 'navMenu' : null);
};

// Opens the Preferences sheet
const OpenPreferences = () => {
  store.toggleSheet('preferences');
  trackEvent('Nav', 'NavClick', 'Preferences');
};

// At top → full refresh; mid-page → smooth scroll up. preventDefault
// avoids the native instant-jump of <a href="#">.
const handleLogoClick = (e) => {
  if (window.scrollY === 0) {
    store.setRefreshEveryThing(true);
  } else {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  trackEvent('Nav', 'NavClick', 'Logo');
};

// Open a tool from the nav by raising the homepage drawer — the `?tool=` query
// Advanced.vue watches. No scroll: the drawer is an overlay, and the grid that
// used to sit under it is a page of its own now.
const openTool = (slug) => {
  store.setOpenSheet(null);            // close the mobile nav Sheet (no-op on desktop)
  router.push({ path: '/', query: { tool: slug } });
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  trackEvent('Nav', 'NavClick', name);
};

// Mobile: hide nav on scroll-down, show on scroll-up.
// SCROLL_DELTA filters out micro-jitter; SHOW_AT_TOP forces the nav
// visible near the top of the page regardless of direction.
const isNavHidden = ref(false);
let lastScrollY = 0;
let scrollTicking = false;
const SCROLL_DELTA = 5;
const SHOW_AT_TOP = 48;

const onScroll = () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY;
    const dy = y - lastScrollY;
    if (y <= SHOW_AT_TOP) {
      isNavHidden.value = false;
    } else if (Math.abs(dy) > SCROLL_DELTA) {
      // Keep nav visible while the menu drawer is open so its close
      // affordance stays in place.
      if (dy > 0 && !isNavMenuOpen.value) {
        isNavHidden.value = true;
      } else if (dy < 0) {
        isNavHidden.value = false;
      }
    }
    lastScrollY = y;
    scrollTicking = false;
  });
};

watch(isMobile, (mobile) => {
  if (!mobile) {
    isNavHidden.value = false;
    window.removeEventListener('scroll', onScroll);
  } else {
    lastScrollY = window.scrollY;
    window.addEventListener('scroll', onScroll, { passive: true });
  }
}, { immediate: false });

onMounted(() => {
  if (isMobile.value) {
    lastScrollY = window.scrollY;
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  fetchGithubStars();
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
  clearTimeout(openToolTimer);
});
</script>
