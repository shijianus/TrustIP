// Express tail middleware for backend-server.js.
//
// Express's built-in final handler renders the full stack trace (absolute
// paths, dependency versions) whenever NODE_ENV isn't "production" — and this
// project deliberately never sets NODE_ENV. These two keep every /api answer
// JSON and keep stacks in the log, never in the response.

import logger from './logger.js';

// Unknown /api/* paths: JSON like every other API response, not the HTML
// "Cannot GET" page.
export const apiNotFound = (req, res) => {
    res.status(404).json({ error: 'Not found' });
};

// Body-parser failures (malformed JSON, oversized body) keep their 4xx status;
// anything else becomes a generic 500. Four parameters are what mark this as
// an error handler to Express, so `next` stays in the signature.
// eslint-disable-next-line no-unused-vars
export const jsonErrorHandler = (err, req, res, next) => {
    const raw = Number(err?.status ?? err?.statusCode);
    const status = Number.isInteger(raw) && raw >= 400 && raw < 600 ? raw : 500;
    if (status >= 500) {
        logger.error({ err, path: req.path }, 'Unhandled request error');
    }
    if (res.headersSent) {
        res.end();
        return;
    }
    const message = status === 400 ? 'Invalid request body'
        : status === 413 ? 'Request body too large'
        : status < 500 ? 'Bad request'
        : 'Internal Server Error';
    res.status(status).json({ error: message });
};
