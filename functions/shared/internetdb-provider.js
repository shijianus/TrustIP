// Shodan InternetDB: what somebody's scanners saw on one address. Key-free, so it
// is the trust fact a blank `.env` deployment can always serve.
//
// A 404 is not an error: it is the archive saying nobody has looked at this
// address, which is a different fact from "we looked and found nothing open", and
// a different one again from the request failing. The three states stay apart all
// the way to the route, which is the whole reason this file exists.

import { fetchUpstream } from './fetch-upstream.js';
import { answered, errored, toText, PROVIDER_TIMEOUT_MS } from './provider-answer.js';

export const INTERNETDB_SOURCE = 'internetdb.shodan.io';

const buildUrl = (ip) => `https://internetdb.shodan.io/${ip}`;

// Matched on words rather than whole tag names, because the archive's vocabulary
// is not a published enum: `tor` shows up on the exits and `open_proxy` on
// proxies, and a bare `proxy` is not ours to rule out.
const hasTag = (tags, word) => tags.some((tag) => String(tag).toLowerCase().split(/[^a-z0-9]+/).includes(word));

const textList = (value) => (Array.isArray(value) ? value.map(toText).filter(Boolean) : []);

const portList = (value) => (Array.isArray(value)
    ? value.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535).sort((a, b) => a - b)
    : []);

export const interpretInternetdb = (body) => {
    if (!body || typeof body !== 'object') return errored(INTERNETDB_SOURCE, 'no-data');
    // `{ detail }` is what the archive answers for an address it has never seen —
    // and, with the same body, for one that does not parse. Both are "no
    // observation", never a refusal and never a clean bill.
    if (body.detail && !body.ports && !body.tags) {
        return answered(INTERNETDB_SOURCE, { authority: 'observation', found: false });
    }

    const tags = textList(body.tags);

    return answered(INTERNETDB_SOURCE, {
        authority: 'observation',
        found: true,
        isProxy: hasTag(tags, 'proxy') ? true : null,
        isTor: hasTag(tags, 'tor') ? true : null,
        ports: portList(body.ports),
        hostnames: textList(body.hostnames),
        cpes: textList(body.cpes),
        tags,
        vulns: textList(body.vulns),
        observedIp: toText(body.ip),
    });
};

export const askInternetdb = async (ip) => {
    try {
        const res = await fetchUpstream(buildUrl(ip), { timeoutMs: PROVIDER_TIMEOUT_MS });
        if (res.status === 404) return answered(INTERNETDB_SOURCE, { authority: 'observation', found: false });
        if (!res.ok) return errored(INTERNETDB_SOURCE, `http-${res.status}`);
        return interpretInternetdb(await res.json());
    } catch (err) {
        console.warn('[internetdb] archive unavailable', { ip, error: err?.message });
        return errored(INTERNETDB_SOURCE, 'request-failed');
    }
};
