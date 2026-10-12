// Request headers for the IPCheck.ing proxy routes.
//
// These handlers used to spread `...req.headers` into the upstream request,
// which handed a third party everything the visitor's browser sent us
// (cookies for this site, any made-up header, client-supplied
// X-Forwarded-For / CF-Connecting-IP) and also replayed hop-level framing
// (content-length, expect, connection, transfer-encoding) that broke the
// rebuilt request. Only what the upstream actually reads travels now:
// content negotiation, the visitor's Firebase bearer token, the browser's
// own identity hints, and the client address as this server resolved it.

const FORWARDED = [
    'accept',
    'accept-language',
    'authorization',
    'user-agent',
    'referer',
    'origin',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'dnt',
];

// The visitor's address as this deployment resolves it: Cloudflare's header
// when Cloudflare fronts the site (it overwrites any client-sent value), else
// Express's req.ip, which honours the `trust proxy` hop count instead of
// believing the leftmost X-Forwarded-For entry.
export const resolveClientIp = (req) => {
    const cf = req.headers?.['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
    return typeof req.ip === 'string' && req.ip ? req.ip : null;
};

export const upstreamHeaders = (req, extra = {}) => {
    const headers = {};
    for (const name of FORWARDED) {
        const value = req.headers?.[name];
        if (typeof value === 'string' && value) headers[name] = value;
    }
    const ip = resolveClientIp(req);
    if (ip) {
        headers['x-forwarded-for'] = ip;
        headers['x-real-ip'] = ip;
    }
    return { ...headers, ...extra };
};
