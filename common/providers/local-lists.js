// The local anonymity lists (common/anonymity-lists.js) as one provider answer,
// so a deployment can let them vote in the trust score's privacy rows.
//
// Opt-in like every provider here (`TRUST_PROVIDERS=locallists`): the dossier
// shows the lists' membership either way, but folding them into the score
// moves the confidence denominator of every address, which is a deployment's
// decision and not a side effect of a download finishing.
//
// `list` authority — these are anonymiser / hosting directories. Only a hit is
// a vote, with one exception: the Tor Project's exit list is the directory of
// exits itself, so an IPv4 address it does not hold is a `false` for `isTor`.
// X4BNet's lists are curated rather than exhaustive, so a miss there stays
// `null`: absence from a curated list is not a clearance.

import { lookupAnonymity } from '../anonymity-lists.js';
import { answered, unavailable } from './answer.js';

export const LOCAL_LISTS_SOURCE = 'local-lists';

const hit = (entry) => (entry.status === 'listed' ? true : null);

/**
 * @param {string} ip
 * @param {function} [lookup]  injectable for tests
 * @returns {Promise<object>}
 */
export const askLocalLists = async (ip, lookup = lookupAnonymity) => {
    const lists = lookup(ip);
    const loaded = [lists.tor, lists.vpn, lists.datacenter].some((entry) => entry.status !== 'unavailable');
    if (!loaded) return unavailable(LOCAL_LISTS_SOURCE, 'not_loaded');
    return answered(LOCAL_LISTS_SOURCE, {
        authority: 'list',
        isTor: lists.tor.status === 'listed' ? true : lists.tor.status === 'not-listed' ? false : null,
        isVpn: hit(lists.vpn),
        isHosting: hit(lists.datacenter),
    });
};
