// What backend-server.js does when its boot sequence rejects: log the error
// once through the shared logger and exit with code 1, so a supervisor (pm2,
// Docker's restart policy) sees a failed start rather than an unhandled
// rejection's stack on stderr. pino flushes its transport on process exit.

import logger from './logger.js';

/**
 * @param {unknown} err the rejection reason
 * @param {{ log?: { error: Function }, exit?: (code: number) => void }} [deps] injectable for tests
 */
export const exitOnBootFailure = (err, { log = logger, exit = (code) => process.exit(code) } = {}) => {
    log.error({ err }, '❌ Backend boot failed; exiting');
    exit(1);
};
