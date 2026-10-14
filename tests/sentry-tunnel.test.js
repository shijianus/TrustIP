// api/sentry-tunnel.js — envelope-header parsing, visitor-IP resolution and
// injection into event items, and the guard branches that return before any
// upstream forward (method gate / unconfigured / invalid envelope / foreign
// DSN). No real Sentry traffic is ever sent.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';

import tunnelHandler, { parseEnvelopeDsn, visitorIpFrom, injectUserIp } from '../api/sentry-tunnel.js';

const OUR_DSN = 'https://publickey@o111.ingest.sentry.io/222';

const makeRes = () => {
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        send(payload) { this.body = payload; return this; },
    };
    return res;
};

const envelopeFor = (dsn) => Buffer.from(`${JSON.stringify({ dsn })}\n{"type":"event"}\n{}`);

beforeEach(() => {
    delete process.env.VITE_SENTRY_DSN_FRONTEND;
});

test('parseEnvelopeDsn extracts the DSN from the envelope header', () => {
    const dsn = parseEnvelopeDsn(envelopeFor(OUR_DSN));
    assert.strictEqual(dsn.host, 'o111.ingest.sentry.io');
    assert.strictEqual(dsn.pathname, '/222');
});

test('parseEnvelopeDsn returns null for garbage input', () => {
    assert.strictEqual(parseEnvelopeDsn(Buffer.from('not json')), null);
    assert.strictEqual(parseEnvelopeDsn(Buffer.from('{"no_dsn":1}\n{}')), null);
});

test('parseEnvelopeDsn returns null for non-Buffer input', () => {
    assert.strictEqual(parseEnvelopeDsn(`{"dsn":"${OUR_DSN}"}\n{}`), null);
    assert.strictEqual(parseEnvelopeDsn(undefined), null);
});

test('returns 400 when the body is not a Buffer', async () => {
    process.env.VITE_SENTRY_DSN_FRONTEND = OUR_DSN;
    const res = makeRes();
    await tunnelHandler({ method: 'POST', body: `{"dsn":"${OUR_DSN}"}\n{}` }, res);
    assert.strictEqual(res.statusCode, 400);
});

test('rejects non-POST methods with 405', async () => {
    const res = makeRes();
    await tunnelHandler({ method: 'GET' }, res);
    assert.strictEqual(res.statusCode, 405);
});

test('returns 404 when no frontend DSN is configured', async () => {
    const res = makeRes();
    await tunnelHandler({ method: 'POST', body: envelopeFor(OUR_DSN) }, res);
    assert.strictEqual(res.statusCode, 404);
});

test('returns 400 on an unparseable envelope', async () => {
    process.env.VITE_SENTRY_DSN_FRONTEND = OUR_DSN;
    const res = makeRes();
    await tunnelHandler({ method: 'POST', body: Buffer.from('garbage') }, res);
    assert.strictEqual(res.statusCode, 400);
});

test('returns 403 when the envelope targets a foreign DSN', async () => {
    process.env.VITE_SENTRY_DSN_FRONTEND = OUR_DSN;
    const res = makeRes();
    const foreign = envelopeFor('https://otherkey@o999.ingest.sentry.io/888');
    await tunnelHandler({ method: 'POST', body: foreign }, res);
    assert.strictEqual(res.statusCode, 403);
});

// -- visitorIpFrom -----------------------------------------------------------

test('visitorIpFrom returns the Cloudflare connecting IP when Cloudflare is declared', () => {
    process.env.TRUST_CF_CONNECTING_IP = '1';
    try {
        assert.strictEqual(visitorIpFrom({ 'cf-connecting-ip': '203.0.113.7' }), '203.0.113.7');
        assert.strictEqual(visitorIpFrom({ 'cf-connecting-ip': '2001:db8::1' }), '2001:db8::1');
    } finally {
        delete process.env.TRUST_CF_CONNECTING_IP;
    }
});

test('visitorIpFrom ignores a client-written CF-Connecting-IP by default', () => {
    assert.strictEqual(visitorIpFrom({ 'cf-connecting-ip': '203.0.113.7' }), null);
});

test('visitorIpFrom returns null without a trustworthy header', () => {
    assert.strictEqual(visitorIpFrom({}), null);
    assert.strictEqual(visitorIpFrom(undefined), null);
    assert.strictEqual(visitorIpFrom({ 'cf-connecting-ip': 'not-an-ip' }), null);
    // Spoofable generic headers are deliberately ignored.
    assert.strictEqual(visitorIpFrom({ 'x-forwarded-for': '203.0.113.7' }), null);
});

// -- injectUserIp ------------------------------------------------------------

const IP = '203.0.113.7';

// Builds an envelope from [itemHeaderObject, payloadString] pairs.
const buildEnvelope = (items) => Buffer.from(
    `${JSON.stringify({ dsn: OUR_DSN })}\n` +
    items.map(([header, payload]) => `${JSON.stringify(header)}\n${payload}`).join('\n'),
);

// Re-parses an envelope's items into [header, payloadString] pairs, honoring
// per-item `length` so the assertions walk the buffer the way Sentry would.
const parseItems = (buf) => {
    const items = [];
    let pos = buf.indexOf(0x0a) + 1;
    while (pos < buf.length) {
        const headerNl = buf.indexOf(0x0a, pos);
        const header = JSON.parse(buf.subarray(pos, headerNl).toString('utf8'));
        const start = headerNl + 1;
        const end = typeof header.length === 'number'
            ? start + header.length
            : (buf.indexOf(0x0a, start) === -1 ? buf.length : buf.indexOf(0x0a, start));
        items.push([header, buf.subarray(start, end).toString('utf8')]);
        pos = buf[end] === 0x0a ? end + 1 : end;
    }
    return items;
};

test('injectUserIp stamps ip_address onto event items', () => {
    const body = buildEnvelope([[{ type: 'event' }, '{"message":"boom"}']]);
    const [[, payload]] = parseItems(injectUserIp(body, IP));
    assert.deepStrictEqual(JSON.parse(payload).user, { ip_address: IP });
});

test('injectUserIp recomputes an explicit item length', () => {
    const original = '{"message":"boom"}';
    const body = buildEnvelope([[{ type: 'event', length: Buffer.byteLength(original) }, original]]);
    const [[header, payload]] = parseItems(injectUserIp(body, IP));
    assert.strictEqual(header.length, Buffer.byteLength(payload));
    assert.deepStrictEqual(JSON.parse(payload).user, { ip_address: IP });
});

test('injectUserIp overwrites ip_address but keeps other user fields', () => {
    const body = buildEnvelope([
        [{ type: 'event' }, '{"user":{"id":"u1"}}'],
        // The SDK can only ever hold a worse guess at the visitor's IP
        // (e.g. a leftover "{{auto}}" sentinel) — ours always wins.
        [{ type: 'transaction' }, '{"user":{"id":"u2","ip_address":"{{auto}}"}}'],
    ]);
    const items = parseItems(injectUserIp(body, IP));
    assert.deepStrictEqual(JSON.parse(items[0][1]).user, { id: 'u1', ip_address: IP });
    assert.deepStrictEqual(JSON.parse(items[1][1]).user, { id: 'u2', ip_address: IP });
});

test('injectUserIp leaves non-event items byte-identical', () => {
    // Attachment payloads are opaque bytes (may contain newlines when a
    // length is present) and must never be re-serialized.
    const attachment = 'line1\nline2';
    const body = buildEnvelope([
        [{ type: 'attachment', length: Buffer.byteLength(attachment) }, attachment],
        [{ type: 'event' }, '{}'],
    ]);
    const items = parseItems(injectUserIp(body, IP));
    assert.strictEqual(items[0][1], attachment);
    assert.deepStrictEqual(JSON.parse(items[1][1]).user, { ip_address: IP });
});

test('injectUserIp returns non-Buffer bodies unchanged', () => {
    const str = '{"dsn":"x"}\n{"type":"event"}\n{}';
    assert.strictEqual(injectUserIp(str, IP), str);
    assert.strictEqual(injectUserIp(undefined, IP), undefined);
});

test('injectUserIp returns malformed bodies unchanged', () => {
    const headerOnly = Buffer.from('{"dsn":"x"}');
    assert.strictEqual(injectUserIp(headerOnly, IP), headerOnly);
    const badItem = Buffer.from('{"dsn":"x"}\nnot-json\n{}');
    assert.strictEqual(injectUserIp(badItem, IP), badItem);
});
