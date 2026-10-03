// `/` + `#<SectionId>` — the dashboard's in-page anchors, kept working now that
// the rail links to routes instead of scrolling (data/rail.js).
//
// The sections belong to Home.vue, so Home resolves the hash; the router's
// scrollBehavior deliberately steps aside for any `to.hash` (see router/index.js
// and the note below). One owner, because the two would otherwise fight: the
// router would jump to the top of the page and this would then scroll down.
//
// Why not return `{ el, offset }` from scrollBehavior instead: the router reads
// the anchor exactly once, at the moment navigation resolves. On a fresh load of
// `/#WebRTC` that is before the sections have painted, and the jump is silently
// lost. Even when it does resolve, the page is still growing underneath the
// scroll — the IP cards fill in, the trust panel renders — so a single jump
// lands short of the heading. Both are handled here: wait for the anchor, then
// re-check the landing until the layout settles.

import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { HEADER_HEIGHT, scrollToElement } from '../utils/scroll-to.js';

// Poll bounds for the anchor. The sections are static children of Home, so one
// tick normally suffices; the ceiling is only there so a hash that names nothing
// (a typo, or a section that isn't rendered in this configuration) gives up
// instead of spinning.
const ANCHOR_TRIES = 25;
const ANCHOR_DELAY = 40;

// Where the heading should end up: just below the fixed header, with the same
// breathing room the shortcut and drawer scrolls use.
const ANCHOR_TOP = HEADER_HEIGHT + 14;

// Landing tolerance, and how many times to re-aim. A section's own heading is
// the point of the link, so anything more than a couple of lines off is worth
// another pass; three is enough to outlast the last card's fetch without
// chasing a page that is genuinely still moving.
const SETTLE_TOLERANCE = 24;
const SETTLE_PASSES = 3;
const SETTLE_DELAY = 700;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves the anchor, or null once the tries run out. `find` defaults to the
// document lookup and is a parameter only so the waiting rule itself can be
// tested without a DOM.
export const waitForAnchor = (id, { tries = ANCHOR_TRIES, delay = ANCHOR_DELAY, find = null } = {}) => {
    if (!id) return Promise.resolve(null);
    const locate = find ?? (() => document.getElementById(id));
    return new Promise((resolve) => {
        let left = tries;
        const step = () => {
            const element = locate();
            if (element || --left <= 0) return resolve(element ?? null);
            setTimeout(step, delay);
        };
        step();
    });
};

// Scrolls until the landing holds. `measure` reports how far the target is from
// where it should be (in viewport pixels, so 0 is a perfect landing) and
// `scroll` re-aims at it. Returns the number of passes used — a caller that
// cares can tell a settled page from one that was still moving.
export const settleScroll = async ({ measure, scroll, tolerance = SETTLE_TOLERANCE, passes = SETTLE_PASSES, delay = SETTLE_DELAY }) => {
    let pass = 0;
    for (; pass < passes; pass++) {
        scroll();
        await wait(delay);
        if (Math.abs(measure()) <= tolerance) break;
    }
    return pass + 1;
};

export const useSectionHashScroll = () => {
    const route = useRoute();

    const scrollToHashedSection = async () => {
        if (!route.hash) return;
        const id = decodeURIComponent(route.hash).slice(1);
        const anchor = await waitForAnchor(id);
        if (!anchor) return;
        settleScroll({
            measure: () => {
                const element = document.getElementById(id);
                // Gone (a re-render replaced the section) — treat as settled
                // rather than throwing the scroll loop after it.
                if (!element) return 0;
                return element.getBoundingClientRect().top - ANCHOR_TOP;
            },
            scroll: () => scrollToElement(id, ANCHOR_TOP),
        });
    };

    onMounted(scrollToHashedSection);
    watch(() => route.hash, scrollToHashedSection);
};
