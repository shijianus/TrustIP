// ecosystem.config.cjs — pm2 process definitions for production.
// `pm2 start ecosystem.config.cjs` so nobody has to remember the node flags:
// the backend must load sentry-instrument.js via --import BEFORE express for
// Sentry's ESM auto-instrumentation (a no-op without SENTRY_DSN_BACKEND, so
// Sentry-less deployments can use this file unchanged).
// CommonJS on purpose: pm2 reads its config synchronously and the package is
// "type": "module", hence the .cjs extension.
module.exports = {
    apps: [
        {
            name: 'trustip-backend',
            script: 'backend-server.js',
            cwd: __dirname,
            node_args: '--import ./sentry-instrument.js',
        },
        {
            name: 'trustip-frontend',
            script: 'frontend-server.js',
            cwd: __dirname,
        },
    ],
};
