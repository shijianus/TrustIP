// Specs for the Service Status board's catalog and ordering: the provider list
// (categories, ids, the shared-page SendGrid row), the light derived from a
// product's own rows, incident filtering by component, `lastIncidentAt`, the
// faults-first ordering and the per-category tally. Inline fixtures only.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STATUS_PROVIDERS, STATUS_CATEGORIES, STATUS_PROVIDER_IDS } from '../common/service-status-providers.js';
import {
    assembleProvider, normalizeSummary, normalizeIncidents, componentsIndicator,
    orderByIndicator, categoryTally, indicatorRank,
} from '../common/service-status-transform.js';
import * as tone from '../frontend/utils/service-status-tone.js';

describe('STATUS_PROVIDERS catalog', () => {
    it('covers the reference board (31+ providers) with unique ids', () => {
        assert.ok(STATUS_PROVIDERS.length >= 31, `only ${STATUS_PROVIDERS.length} providers`);
        assert.equal(STATUS_PROVIDER_IDS.size, STATUS_PROVIDERS.length);
    });

    it('keeps every provider the board shipped before', () => {
        for (const id of ['claude', 'chatgpt', 'cursor', 'github', 'elevenlabs', 'cloudflare', 'groq', 'notion',
            'vercel', 'netlify', 'render', 'supabase', 'discord', 'figma', 'linear', 'stripe']) {
            assert.ok(STATUS_PROVIDER_IDS.has(id), id);
        }
    });

    it('adds the reference board providers that were missing', () => {
        for (const id of ['perplexity', 'flyio', 'digitalocean', 'npm', 'pypi', 'sentry', 'postman', 'clerk',
            'twilio', 'sendgrid', 'jira', 'reddit', 'twitch', 'pinterest', 'zoom']) {
            assert.ok(STATUS_PROVIDER_IDS.has(id), id);
        }
    });

    it('files every provider under a known category, https origins only', () => {
        for (const p of STATUS_PROVIDERS) {
            assert.ok(STATUS_CATEGORIES.includes(p.category), `${p.id}: ${p.category}`);
            assert.match(p.api, /^https:\/\/[^/]+$/, p.id);
            assert.match(p.page, /^https:\/\/[^/]+$/, p.id);
        }
    });

    it('computes SendGrid from its own rows on Twilio\'s page', () => {
        const sendgrid = STATUS_PROVIDERS.find((p) => p.id === 'sendgrid');
        assert.equal(sendgrid.api, 'https://status.twilio.com');
        assert.equal(sendgrid.components.ownIndicator, true);
        assert.ok(sendgrid.components.include.every((name) => name.startsWith('SendGrid')));
    });
});

describe('componentsIndicator', () => {
    it('takes the worst row, Statuspage\'s own roll-up', () => {
        assert.equal(componentsIndicator([{ status: 'operational' }]), 'none');
        assert.equal(componentsIndicator([{ status: 'operational' }, { status: 'under_maintenance' }]), 'maintenance');
        assert.equal(componentsIndicator([{ status: 'degraded_performance' }, { status: 'under_maintenance' }]), 'minor');
        assert.equal(componentsIndicator([{ status: 'partial_outage' }]), 'major');
        assert.equal(componentsIndicator([{ status: 'major_outage' }, { status: 'operational' }]), 'critical');
    });

    it('is unknown for no rows — absent rows are not a clean bill', () => {
        assert.equal(componentsIndicator([]), 'unknown');
        assert.equal(componentsIndicator(null), 'unknown');
    });
});

describe('ownIndicator selector', () => {
    const page = {
        status: { indicator: 'major' }, // the parent page is in trouble…
        components: [
            { id: 'a', name: 'PROGRAMMABLE VOICE', status: 'major_outage' },
            { id: 'b', name: 'SendGrid API', status: 'operational' },
            { id: 'c', name: 'SendGrid Webhooks', status: 'degraded_performance' },
        ],
    };

    it('ignores the page-wide light and rolls up the included rows', () => {
        const out = normalizeSummary(page, { include: ['SendGrid API', 'SendGrid Webhooks'], ownIndicator: true });
        assert.equal(out.indicator, 'minor');
        assert.deepEqual(out.components.map((c) => c.name), ['SendGrid API', 'SendGrid Webhooks']);
    });

    it('stays unknown when the summary could not be read', () => {
        assert.equal(normalizeSummary(null, { include: ['SendGrid API'], ownIndicator: true }).indicator, 'unknown');
    });

    it('without the flag the page-wide indicator still wins', () => {
        assert.equal(normalizeSummary(page, { include: ['SendGrid API'] }).indicator, 'major');
    });
});

describe('normalizeIncidents componentNames filter', () => {
    const feed = {
        incidents: [
            { id: '1', name: 'Voice down', created_at: '2026-10-10T00:00:00Z', components: [{ name: 'PROGRAMMABLE VOICE' }] },
            { id: '2', name: 'Mail delayed', created_at: '2026-10-11T00:00:00Z', components: [{ name: 'SendGrid Mail Sending' }] },
            { id: '3', name: 'No components', created_at: '2026-10-12T00:00:00Z' },
        ],
    };

    it('keeps only incidents naming one of the components', () => {
        const out = normalizeIncidents(feed, { pageUrl: 'https://status.twilio.com', componentNames: ['SendGrid Mail Sending'] });
        assert.deepEqual(out.map((i) => i.id), ['2']);
    });

    it('keeps everything without a filter', () => {
        assert.equal(normalizeIncidents(feed).length, 3);
    });
});

describe('assembleProvider board fields', () => {
    const provider = { id: 'npm', name: 'npm', category: 'dev', page: 'https://status.npmjs.org', api: 'https://status.npmjs.org' };

    it('carries category and the newest incident start as lastIncidentAt', () => {
        const out = assembleProvider(provider, { status: { indicator: 'none' }, components: [] }, {
            incidents: [
                { id: 'old', name: 'a', started_at: '2026-09-01T00:00:00Z' },
                { id: 'new', name: 'b', started_at: '2026-10-14T08:00:00Z' },
            ],
        });
        assert.equal(out.category, 'dev');
        assert.equal(out.lastIncidentAt, '2026-10-14T08:00:00Z');
    });

    it('lastIncidentAt is null with no incidents, category null when unset', () => {
        const out = assembleProvider({ ...provider, category: undefined }, null, null);
        assert.equal(out.lastIncidentAt, null);
        assert.equal(out.category, null);
    });

    it('filters a shared-page product\'s incidents to its own rows', () => {
        const sendgrid = STATUS_PROVIDERS.find((p) => p.id === 'sendgrid');
        const out = assembleProvider(sendgrid, { status: { indicator: 'major' }, components: [
            { id: 'x', name: 'SendGrid API', status: 'operational' },
        ] }, { incidents: [
            { id: 'v', name: 'voice', started_at: '2026-10-14T00:00:00Z', components: [{ name: 'PROGRAMMABLE VOICE' }] },
            { id: 's', name: 'api', started_at: '2026-10-01T00:00:00Z', components: [{ name: 'SendGrid API' }] },
        ] });
        assert.equal(out.indicator, 'none');
        assert.deepEqual(out.incidents.map((i) => i.id), ['s']);
        assert.equal(out.lastIncidentAt, '2026-10-01T00:00:00Z');
    });
});

describe('orderByIndicator', () => {
    const list = [
        { id: 'a', indicator: 'none' },
        { id: 'b', indicator: 'minor' },
        { id: 'c', indicator: 'unknown' },
        { id: 'd', indicator: 'critical' },
        { id: 'e', indicator: 'none' },
        { id: 'f', indicator: 'major' },
        { id: 'g', indicator: 'maintenance' },
        { id: 'h', indicator: 'minor' },
    ];

    it('pins faults on top, worst first, and keeps catalog order otherwise', () => {
        assert.deepEqual(orderByIndicator(list).map((p) => p.id), ['d', 'f', 'b', 'h', 'g', 'a', 'c', 'e']);
    });

    it('does not mutate its input', () => {
        const copy = list.map((p) => ({ ...p }));
        orderByIndicator(list);
        assert.deepEqual(list, copy);
    });

    it('ranks unknown below every real fault and above green', () => {
        assert.ok(indicatorRank('unknown') < indicatorRank('maintenance'));
        assert.ok(indicatorRank('unknown') > indicatorRank('none'));
        assert.equal(indicatorRank('bogus'), indicatorRank('unknown'));
    });
});

describe('categoryTally', () => {
    it('counts up / total / faults per category in the given order, skipping empty ones', () => {
        const out = categoryTally([
            { category: 'cloud', indicator: 'none' },
            { category: 'cloud', indicator: 'major' },
            { category: 'ai', indicator: 'none' },
            { category: 'ai', indicator: 'maintenance' },
            { category: 'ai', indicator: 'unknown' },
        ], ['ai', 'cloud', 'dev']);
        assert.deepEqual(out, [
            { id: 'ai', total: 3, up: 1, faults: 0 },
            { id: 'cloud', total: 2, up: 1, faults: 1 },
        ]);
    });
});

describe('frontend re-exports', () => {
    it('are the back end\'s own functions', () => {
        assert.equal(tone.orderByIndicator, orderByIndicator);
        assert.equal(tone.categoryTally, categoryTally);
        assert.equal(tone.STATUS_CATEGORIES, STATUS_CATEGORIES);
    });
});
