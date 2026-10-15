// Where the Express API listens, and where frontend-server.js reaches it.
//
// BACKEND_HOST (documented in .env.example) is the listen address; empty means
// 127.0.0.1. The shipped topologies — `pnpm start`, pm2 and the Docker image —
// run frontend-server.js beside the backend on one host, so the API is never
// reachable from outside it: a client that could reach it directly would skip
// the proxy that writes X-Forwarded-For. A deployment that splits the halves
// across hosts or containers sets BACKEND_HOST=0.0.0.0 (or an interface
// address) and widens TRUST_PROXY to the frontend's address.
//
// The proxy targets 127.0.0.1 rather than `localhost`: Node resolves
// `localhost` in the resolver's order, which can be ::1 first, and the backend
// listening on 127.0.0.1 does not answer there.

export const DEFAULT_BACKEND_HOST = '127.0.0.1';

/**
 * @param {string|undefined} value BACKEND_HOST as read from the environment
 * @returns {string}
 */
export const backendHost = (value) => String(value ?? '').trim() || DEFAULT_BACKEND_HOST;

/**
 * `host:port` for a URL — an IPv6 literal goes in brackets.
 *
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export const hostPort = (host, port) => (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`);
