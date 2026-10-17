// Specs for the RSS status-feed adapter (rssToStatuspage) and the two AI
// providers it and the shared-page selector add: xAI (status.x.ai/feed.xml,
// no Statuspage API) and Replicate (its row on Cloudflare's status page).
// Inline fixtures only.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STATUS_PROVIDERS } from '../common/service-status-providers.js';
import { rssToStatuspage, assembleProvider } from '../common/service-status-transform.js';

const item = (title, guid, categories, date = 'Wed, 07 Oct 2026 00:24:33 GMT') => `
    <item>
      <title>${title}</title>
      <link>https://status.x.ai/api/${guid}</link>
      <guid isPermaLink="false">${guid}</guid>
      <description><![CDATA[<h3>Status</h3>]]></description>
      <pubDate>${date}</pubDate>
      ${categories.map((c) => `<category>${c}</category>`).join('\n      ')}
    </item>`;
const feed = (...items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>xAI</title>${items.join('')}</channel></rss>`;

describe('rssToStatuspage', () => {
    it('all items resolved → none; incidents keep their own links', () => {
        const pair = rssToStatuspage(feed(item('[API] Errors &amp; latency', 'ps_1', ['outage', 'resolved'])));
        assert.equal(pair.summary.status.indicator, 'none');
        const [incident] = pair.incidents.incidents;
        assert.equal(incident.name, '[API] Errors & latency');
        assert.equal(incident.status, 'resolved');
        assert.equal(incident.impact, 'major');
        assert.equal(incident.link, 'https://status.x.ai/api/ps_1');
        assert.equal(incident.started_at, new Date('Wed, 07 Oct 2026 00:24:33 GMT').toISOString());
    });

    it('the worst open item decides the light', () => {
        const pair = rssToStatuspage(feed(
            item('a', 'p1', ['disruption']),
            item('b', 'p2', ['outage', 'resolved']),
            item('c', 'p3', ['maintenance']),
        ));
        assert.equal(pair.summary.status.indicator, 'minor');
        assert.equal(rssToStatuspage(feed(item('d', 'p4', ['outage']))).summary.status.indicator, 'major');
    });

    it('a body that is not a feed is null (a failed fetch, not an all-clear)', () => {
        assert.equal(rssToStatuspage('<!DOCTYPE html><html>challenge</html>'), null);
        assert.equal(rssToStatuspage(null), null);
    });

    it('assembles into the board shape with feed links preferred over /incidents/<id>', () => {
        const provider = STATUS_PROVIDERS.find((p) => p.id === 'xai');
        const pair = rssToStatuspage(feed(item('x', 'ps_9', ['outage'])));
        const entry = assembleProvider(provider, pair.summary, pair.incidents);
        assert.equal(entry.indicator, 'major');
        assert.equal(entry.incidents[0].url, 'https://status.x.ai/api/ps_9');
    });
});

describe('AI providers added', () => {
    it('xAI reads its official RSS feed; Replicate its own row on Cloudflare\'s page', () => {
        const xai = STATUS_PROVIDERS.find((p) => p.id === 'xai');
        assert.equal(xai.format, 'rss');
        assert.equal(xai.api, 'https://status.x.ai');
        assert.equal(xai.category, 'ai');
        const replicate = STATUS_PROVIDERS.find((p) => p.id === 'replicate');
        assert.deepEqual(replicate.components, { include: ['Replicate'], ownIndicator: true });
        const summary = {
            status: { indicator: 'major' },
            components: [
                { id: 'a', name: 'Replicate', status: 'operational', group_id: 'g' },
                { id: 'b', name: 'Workers', status: 'major_outage' },
            ],
        };
        const entry = assembleProvider(replicate, summary, { incidents: [] });
        assert.equal(entry.indicator, 'none', 'Cloudflare\'s page-wide light is not Replicate\'s');
    });
});
