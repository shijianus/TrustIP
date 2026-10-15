// Per-client rate limiters for backend-server.js.
//
// Every limiter keys on the same resolved address (resolveClientIp in
// common/client-ip.js), so the route limiters, the global one, the slow-down
// and the ledger always agree on who the client is. IPv6 clients are keyed by
// their /56, as express-rate-limit recommends, so one host cannot rotate
// through its own prefix to reset a budget.
//
// `limiter` is the one constructor: each call returns an independent budget,
// so a route that gets its own `limiter(...)` never shares a bucket with
// another route.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { resolveClientIp } from './client-ip.js';

export const getClientIp = (req) => resolveClientIp(req) || 'unknown';
export const clientKey = (req) => ipKeyGenerator(getClientIp(req));

/**
 * An express-rate-limit middleware keyed on the resolved client address.
 * Options pass straight through; `keyGenerator` cannot be overridden.
 *
 * @param {object} options express-rate-limit options
 * @returns {import('express').RequestHandler}
 */
export const limiter = (options) => rateLimit({ message: 'Too Many Requests', ...options, keyGenerator: clientKey });

/**
 * A fixed one-minute budget of `max` requests per client — the shape every
 * per-route limiter in backend-server.js uses.
 *
 * @param {number} max
 * @returns {import('express').RequestHandler}
 */
export const perMinute = (max) => limiter({ windowMs: 60 * 1000, max });
