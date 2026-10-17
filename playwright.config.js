// Playwright E2E smoke for the built app (e2e/README.md).
//
// The web server below boots the offline stack (e2e/support/serve-stack.mjs):
// backend-server.js with no keys and every upstream mocked, the frontend app over
// dist/ and dist-stun/, and a local STUN server. Build both first:
//   pnpm run build
//   VITE_TEST_EXTRA_STUN=127.0.0.1:43478 pnpm exec vite build --outDir dist-stun
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_FRONTEND_PORT || 42966);
const OUT = process.env.E2E_OUT_DIR || 'e2e/.out';

export default defineConfig({
    testDir: 'e2e',
    testMatch: /.*\.spec\.js$/,
    outputDir: `${OUT}/test-results`,
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    timeout: 90_000,
    expect: { timeout: 20_000 },
    reporter: [
        ['list'],
        ['html', { outputFolder: `${OUT}/report`, open: 'never' }],
        ['json', { outputFile: `${OUT}/results.json` }],
    ],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        locale: 'en-US',
        timezoneId: 'UTC',
        trace: 'on',
        screenshot: 'on',
        video: 'off',
        serviceWorkers: 'block',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1280, height: 900 },
                launchOptions: {
                    args: [
                        // Host candidates as real addresses rather than mDNS names,
                        // so the local STUN server sees a usable source.
                        '--disable-features=WebRtcHideLocalIpsWithMdns',
                    ],
                },
            },
        },
    ],
    webServer: {
        command: 'node e2e/support/serve-stack.mjs',
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: false,
        timeout: 90_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { E2E_LOG_DIR: `${OUT}/logs` },
    },
});
