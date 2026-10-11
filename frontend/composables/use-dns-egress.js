// Which recursor is answering this browser's DNS, read quietly for the summary.
//
// The homepage shows the visitor's exit addresses and the table explains what each
// destination saw. Neither answers the one question that makes a split tunnel legible
// at a glance: if the exits are abroad and the name was resolved at home, the rules
// are not covering DNS. The `/dns` section answers that with its own seven-provider
// run, and this composable reads the same provider objects (`utils/dnsleaks/`) with a
// shorter chain, because the summary needs an address and not a report.
//
// Deliberately quiet, exactly like `use-egress-leak.js`: no event, no store write, no
// IP-history entry. A visitor who never opened the DNS section must not be credited
// with having run it, and a resolver address is not one of the visitor's own
// addresses — which is why it is never folded into the exit list.

import { shallowRef, onScopeDispose } from 'vue';

import { ipApi, fastly, ipleak, runWithRetry } from '../utils/dnsleaks/index.js';
import { isValidIP } from '../utils/valid-ip.js';

// Three, in the order the section itself prefers: `ipApi` answers from the recursor
// with no subdomain round-trip, `fastly` and `ipleak` corroborate it. Every resolver
// name is generated fresh inside the provider, so no call repeats another's cache.
const PROBES = [ipApi, fastly, ipleak];

export const useDnsEgress = ({ geoLookup } = {}) => {
    const resolvers = shallowRef([]);
    const running = shallowRef(false);

    let controller = null;
    let startedOnce = false;

    const record = (ip, provider) => {
        const known = new Set(resolvers.value.map((row) => row.ip));
        if (known.has(ip)) return;
        resolvers.value = [...resolvers.value, { ip, provider, country_code: '', org: '' }];
        if (!geoLookup) return;
        Promise.resolve(geoLookup(ip))
            .then((geo) => {
                if (controller?.signal.aborted) return;
                resolvers.value = resolvers.value.map((row) => (
                    row.ip === ip
                        ? { ...row, country_code: String(geo?.country_code || '').toUpperCase(), org: geo?.org || geo?.isp || row.org }
                        : row
                ));
            })
            .catch(() => { /* an unplaced resolver is still a resolver */ });
    };

    const run = async () => {
        if (startedOnce) return;
        startedOnce = true;
        controller = new AbortController();
        running.value = true;
        try {
            await Promise.allSettled(PROBES.map(async (provider) => {
                const result = await runWithRetry(provider);
                const ip = result?.ip;
                if (ip && isValidIP(ip)) record(ip, provider.name);
            }));
        } finally {
            if (!controller?.signal.aborted) running.value = false;
        }
    };

    const cancel = () => {
        controller?.abort();
        running.value = false;
    };

    onScopeDispose(cancel);

    return { resolvers, running, run, cancel };
};
