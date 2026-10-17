// /api/asn-profile?asn=<n> — everything the ASN Profile page shows, in one
// answer: Radar ASN summary + prefix list (common/cf-radar.js), CAIDA
// topology and neighbours (./asn-connectivity.js), RDAP autnum
// (common/rdap.js), ASRank (common/asrank.js), PeeringDB — the local index
// (common/peeringdb-db.js), else the public API (common/peeringdb-api.js) — and, when the private API is configured,
// reputation (common/asn-reputation.js). Composition, deadlines and statuses
// live in common/asn-profile.js. `asn` arrives as a canonical number string
// (requireValidASN). 200 unless every configured source failed (502).

import { RADAR_VIEWS, hasRadarApiKey, loadAsnSummary, isCompleteRadarAnswer } from '../common/cf-radar.js';
import { rdapAutnum, isAutnumMissing } from '../common/rdap.js';
import { queryAsRank } from '../common/asrank.js';
import { requestAsnReputation } from '../common/asn-reputation.js';
import { isPeeringdbLoaded } from '../common/peeringdb-db.js';
import { isPeeringdbApiEnabled, resolvePeeringdbNet } from '../common/peeringdb-api.js';
import { isAsRelLoaded } from '../common/as-rel-db.js';
import { isAsOrgLoaded } from '../common/as-org-db.js';
import { isStillLoading } from '../common/offline-data.js';
import {
    SOURCE_TIMEOUTS, buildSectionLoaders, composeAsnProfile, allSourcesFailed,
} from '../common/asn-profile.js';
import { getAsnConnectivity } from './asn-connectivity.js';
import { anonymousUpstreamHeaders } from '../common/upstream-headers.js';

// A section whose local data isn't there fails (status 'error'): left out
// of the answer and keeping it out of the week-long cache, while every other
// section answers as usual — never an 'empty' / 'disabled' that would be
// cached for a week.

// Connectivity needs the as-rel snapshot (without it every graph is empty);
// as2org only names the nodes, RIPEstat covers a failed download, so it
// counts only while still downloading. Exported for tests.
export const connectivityReadiness = ({ relLoaded = isAsRelLoaded, orgLoaded = isAsOrgLoaded, fetch = getAsnConnectivity } = {}) =>
    (...args) => {
        if (!relLoaded()) throw new Error('CAIDA as-rel snapshot not loaded');
        if (isStillLoading(orgLoaded)) throw new Error('CAIDA as2org snapshot still loading');
        return fetch(...args);
    };

// PeeringDB answers from the local index when it is loaded, else from the
// public API (PEERINGDB_API, on by default), so the section no longer needs
// the Cloudflare key. 'disabled' only where neither path exists; configured
// for the index, not yet loaded and with the API switched off, it is an error.
// Exported for tests.
export const peeringdbReadiness = ({ configured = hasRadarApiKey, loaded = isPeeringdbLoaded, apiFallback = isPeeringdbApiEnabled } = {}) => () => {
    if (loaded()) return true;
    if (apiFallback()) return true;
    if (!configured()) return false;
    throw new Error('PeeringDB index not loaded');
};

// The record from whichever path resolvePeeringdbNet takes; an API failure
// (timeout, 5xx, 429) throws so the section is 'error' and the answer is not
// cached for a week. Exported for tests.
export const peeringdbLookup = (resolve = resolvePeeringdbNet) => async (asn) => {
    const answer = await resolve(asn);
    if (answer.status === 'error') throw new Error(`PeeringDB API ${answer.reason || 'failed'}`);
    return answer.record || null;
};

export default async (req, res) => {
    const asn = Number(req.query.asn);
    const loaders = buildSectionLoaders({
        hasRadarKey: hasRadarApiKey,
        // The summary plus its failed segments, so a partial one isn't cached.
        fetchRadarAsn: (n) => loadAsnSummary(String(n)),
        fetchRadarPrefixes: (n) => RADAR_VIEWS['bgp-prefixes'].fetch({ asn: String(n) }),
        isPartialPrefixes: (body) => !isCompleteRadarAnswer(body),
        getConnectivity: connectivityReadiness(),
        rdapAutnum: (n) => rdapAutnum(n, { timeoutMs: SOURCE_TIMEOUTS.autnum }),
        isAutnumMissing,
        queryAsRank: (n) => queryAsRank(n, { timeoutMs: SOURCE_TIMEOUTS.rank }),
        // Private-API call: only the allow-listed headers and the resolved
        // client address go upstream (common/upstream-headers.js), never the
        // visitor's cookies or a client-written X-Forwarded-For.
        requestReputation: (n) => requestAsnReputation(n, anonymousUpstreamHeaders(req), { timeoutMs: SOURCE_TIMEOUTS.reputation }),
        isPeeringdbLoaded: peeringdbReadiness(),
        lookupPeeringdb: peeringdbLookup(),
    });
    const body = await composeAsnProfile(asn, loaders);
    if (allSourcesFailed(body)) {
        return res.status(502).json({ error: 'All sources failed', status: body.status });
    }
    return res.json(body);
};
