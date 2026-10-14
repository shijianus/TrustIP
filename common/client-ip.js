// Which address a request came from, decided once for every consumer: the
// per-IP limiters, the rate-limit ledger, and the X-Forwarded-For this server
// sends upstream all read `resolveClientIp`, so a client cannot be one address
// to the limiter and another to the ledger.
//
// Two knobs, both documented in .env.example:
//
//   TRUST_PROXY — Express's `trust proxy`, i.e. which socket peers may tell us
//     the client's address in X-Forwarded-For. Default `loopback`: the shipped
//     topology is frontend-server.js proxying to this backend over the loopback
//     interface (one container, or pm2 on one host), and frontend-server writes
//     the header from its own socket. A client connecting to the backend
//     directly is not on loopback, so whatever X-Forwarded-For it sends is
//     ignored and its socket address is the key. Accepts `false`, a hop count,
//     or a comma list of `loopback` / `linklocal` / `uniquelocal` / addresses /
//     CIDRs. `true` (believe any peer) is refused: it is exactly the setting
//     that lets every client choose its own address.
//
//   TRUST_CF_CONNECTING_IP=1 — believe the CF-Connecting-IP header. Only
//     Cloudflare overwrites it; anywhere else a client writes it itself, so it
//     is off unless the deployment says Cloudflare fronts it (and should then
//     only accept connections from Cloudflare). X-Real-IP is never read.

import { parseIp, parseCidr } from './ip-math.js';
import { isValidIP } from './valid-ip.js';

const DEFAULT_TRUST_PROXY = 'loopback';
const PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const OFF = new Set(['false', '0', 'off', 'none', 'no']);

/**
 * The value to hand `app.set('trust proxy', …)`, read from TRUST_PROXY.
 * Anything unparseable falls back to the default rather than to "trust
 * everyone" or "trust no one", and says so through `invalid`.
 *
 * @param {string|undefined} raw
 * @returns {{ value: string|number|false, invalid: boolean }}
 */
export const trustProxySetting = (raw = process.env.TRUST_PROXY) => {
    const text = String(raw ?? '').trim().toLowerCase();
    if (!text) return { value: DEFAULT_TRUST_PROXY, invalid: false };
    if (OFF.has(text)) return { value: false, invalid: false };
    if (/^\d{1,2}$/.test(text)) return { value: Number(text), invalid: false };
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    const ok = parts.length > 0 && parts.every((p) => PRESETS.has(p) || parseIp(p) || parseCidr(p));
    return ok ? { value: parts.join(','), invalid: false } : { value: DEFAULT_TRUST_PROXY, invalid: true };
};

export const trustsCfConnectingIp = () => ['1', 'true'].includes(String(process.env.TRUST_CF_CONNECTING_IP || '').trim().toLowerCase());

// `::ffff:203.0.113.9` is how a dual-stack socket spells an IPv4 peer; one
// client must be one key, whichever way the socket wrote it.
const unmap = (ip) => (/^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(ip) ? ip.slice(7) : ip);

/**
 * The visitor's address as this deployment resolves it: CF-Connecting-IP only
 * when TRUST_CF_CONNECTING_IP is set, otherwise Express's `req.ip` (which
 * applies TRUST_PROXY), otherwise the socket peer.
 *
 * @param {object} req  an Express request (or anything with headers/ip/socket)
 * @returns {string|null}
 */
export const resolveClientIp = (req) => {
    if (trustsCfConnectingIp()) {
        const cf = req?.headers?.['cf-connecting-ip'];
        if (typeof cf === 'string' && isValidIP(cf.trim())) return unmap(cf.trim());
    }
    if (typeof req?.ip === 'string' && req.ip) return unmap(req.ip);
    const peer = req?.socket?.remoteAddress;
    return typeof peer === 'string' && peer ? unmap(peer) : null;
};
