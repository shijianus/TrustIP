// frontend-server.js — the static server for `pnpm start`: the app itself is
// built in common/frontend-app.js, this file only reads the ports and listens.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './common/logger.js';
import { createFrontendApp } from './common/frontend-app.js';

dotenv.config({ quiet: true });

const backEndPort = parseInt(process.env.BACKEND_PORT || 11966, 10);
const frontEndPort = parseInt(process.env.FRONTEND_PORT || 18966, 10);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, './dist');

const frontendApp = createFrontendApp({ distDir, backEndPort });

// Start static file server
frontendApp.listen(frontEndPort, () => {
  logger.info(`🚀 Static file server ready on http://localhost:${frontEndPort}`);
});
