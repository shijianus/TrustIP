// Baseline response headers for both Express servers (backend-server.js and
// frontend-server.js — each serves dist/ in some deployment).
//
// Deliberately not set here:
//   - Content-Security-Policy: the SPA loads Google Analytics, the GitBook
//     docs embed, the IPCheck.ing invisibility probe, Firebase auth and Sentry;
//     an enforced policy needs a staged Report-Only rollout against real
//     traffic first, or it breaks those features.
//   - Strict-Transport-Security: only meaningful on HTTPS, which these Node
//     servers never terminate themselves — set it at the TLS edge (Cloudflare).
export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Clickjacking: the signed-in UI must not be framed by another origin.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Same-origin API calls keep the full Referer (the /api Referer gate needs
    // it); third parties only learn the origin.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
};
