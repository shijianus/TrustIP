// Refresh / initial load sequence orchestration
//
// Input:
//   - store: main store
//   - t: i18n translation function
//   - infoMaskLevel: ref<number> — reset to 0 when refreshing
//   - sections: the SECTION_IDS this route actually mounts (default ['IPInfo'])
//
// Output:
//   - loadingControl(): the initial load sequence starts, once every section
//     this route runs has reported itself mounted
//
// Internal:
//   - monitor store.shouldRefreshEveryThing, trigger refresh → reset loadingStatus → dispatch section commands → Alert → reset flag
//
// Sections are driven through the command bus (utils/app-commands.js): the
// owner components register ipinfo:refresh / connectivity:run / webrtc:run /
// dnsleak:run at setup, before loadingControl's mounted gate opens. Dispatches
// here are fire-and-forget — completion is reported on the event bus.
//
// A route gets scoped to the sections it mounts: `/` runs the address engine
// only, so it neither waits on nor starts the leak and connectivity tests —
// those live on their own pages now. The modules a route does not run have
// their loading flags settled immediately, because `allHasLoaded` gates the
// info-mask button and the brand shimmer and would otherwise wait forever.

import { watch } from 'vue';
import { dispatchAppCommand } from '../utils/app-commands.js';

const runCommand = (name, payload) => {
    dispatchAppCommand(name, payload).catch((error) => {
        console.warn(`[refresh-orchestrator] ${name} failed:`, error);
    });
};

function scheduleTimedTasks(tasks) {
    tasks.forEach((task) => {
        setTimeout(() => {
            task.action();
            if (task.after) task.after();
        }, task.delay);
    });
}

export function useRefreshOrchestrator({ store, t, infoMaskLevel, sections = ['IPInfo'] }) {
    // The loading flags of every module, minus the ones this route actually
    // runs. A route that does not mount a test must still settle its flag, or
    // `allHasLoaded` — which gates the info-mask button and the brand shimmer —
    // waits forever for a component that is not on the page.
    const OTHERS = ['Connectivity', 'WebRTC', 'DNSLeakTest'].filter((k) => !sections.includes(k));
    // Which command re-runs each module, and with what payload. Only the ones
    // this route mounts are dispatched: `R` means "re-run what is on this page",
    // and a command with no owner here would only produce an `unavailable`
    // rejection for a test the visitor is not looking at.
    const REFRESH_COMMANDS = {
        IPInfo: { command: 'ipinfo:refresh', payload: undefined, delay: 0 },
        DNSLeakTest: { command: 'dnsleak:run', payload: { isRefresh: true }, delay: 100 },
        WebRTC: { command: 'webrtc:run', payload: { isRefresh: true }, delay: 200 },
        Connectivity: { command: 'connectivity:run', payload: { trigger: 'refresh' }, delay: 300 },
    };

    const refreshingAlert = () => {
        store.setAlert(
            true,
            'text-success',
            t('alert.refreshEverythingMessage'),
            t('alert.refreshEverythingTitle'),
        );
    };

    const refreshEverything = () => {
        const mine = sections.map((key) => ({ key, ...REFRESH_COMMANDS[key] })).filter((e) => e.command);
        mine.forEach(({ key }) => store.setLoadingStatus(key, false));

        scheduleTimedTasks([
            ...mine.map(({ command, payload, delay }) => ({ action: () => runCommand(command, payload), delay })),
            { action: refreshingAlert, delay: 300 },
        ]);
        infoMaskLevel.value = 0;
        store.setRefreshEveryThing(false);
    };

    const loadingControl = (t1 = 0) => {
        const mountedStatus = sections.every((key) => store.mountingStatus[key]);
        if (mountedStatus) {
            // The modules this route runs. Each one owns its own command; a
            // dispatch here is fire-and-forget and completion rides the event bus.
            setTimeout(() => runCommand('ipinfo:refresh'), t1);
            // Nothing else is loading on this route, so nothing should keep the
            // page waiting on it.
            OTHERS.forEach((key) => store.setLoadingStatus(key, true));
        } else {
            setTimeout(() => loadingControl(t1), 100);
        }
    };

    watch(
        () => store.shouldRefreshEveryThing,
        (newVal) => {
            if (newVal) refreshEverything();
        },
    );

    return { loadingControl };
}
