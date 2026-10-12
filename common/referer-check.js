// dotenv.config() is called once in backend-server.js before any handler
// imports this module, so process.env.ALLOWED_DOMAINS is already populated.
// Avoid the duplicate call to keep this a pure, fast function.

function refererCheck(referer) {
    // filter(Boolean): ''.split(',') is [''], and an empty entry would match the
    // empty hostname of file:, data: and javascript: referers.
    const allowedDomains = ['localhost', ...(process.env.ALLOWED_DOMAINS || '').split(',').filter(Boolean)];

    if (referer) {
        // Scanners send garbage Referer headers; a parse failure means
        // "not an allowed origin", never a thrown 500.
        let domain;
        try {
            domain = new URL(referer).hostname;
        } catch {
            return false;
        }
        return allowedDomains.includes(domain);
    }
    return false;  // if no referer is provided, return false
}

export { refererCheck };
