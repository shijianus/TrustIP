// The /api proxy frontend-server.js puts in front of the backend.
//
// X-Forwarded-For is *set* to the socket peer, never appended to: whatever the
// client sent in that header is its own claim, and the backend — which trusts
// this hop over loopback (TRUST_PROXY, common/client-ip.js) — keys every
// limiter, the ledger and its upstream headers on the address written here.
// Behind Cloudflare that peer is Cloudflare's edge, and the backend reads
// CF-Connecting-IP instead when TRUST_CF_CONNECTING_IP=1.

// `::ffff:203.0.113.9` is a dual-stack socket's spelling of an IPv4 peer.
export const peerAddress = (req) => {
    const peer = req?.socket?.remoteAddress || '';
    return /^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(peer) ? peer.slice(7) : peer;
};

/**
 * http-proxy-middleware options for the /api proxy.
 *
 * @param {number} backEndPort
 * @returns {object}
 */
export const apiProxyOptions = (backEndPort) => ({
    target: `http://localhost:${backEndPort}/api`,
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq, req) => {
            const peer = peerAddress(req);
            if (peer) proxyReq.setHeader('x-forwarded-for', peer);
            else proxyReq.removeHeader('x-forwarded-for');
        },
    },
});
