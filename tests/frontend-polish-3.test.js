// Batch C frontend follow-ups — source-level guards for template changes the
// Node runner cannot render: WebRTC candidates as cards below md, the
// connectivity round id plumbed per pass, and the shared skeleton / empty-state
// / status-pill primitives used where spinners, blank space or hue-only values
// used to be.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../frontend/${p}`, import.meta.url), 'utf8');

describe('WebRTC candidate list at 390px', () => {
  const src = read('components/WebRtcTest.vue');
  it('renders a md:hidden card list and hides the table below md', () => {
    assert.match(src, /<ul v-if="candidates\.length" class="md:hidden[^"]*" data-webrtc-cand-cards>/);
    assert.match(src, /<div v-if="candidates\.length" class="hidden md:block overflow-x-auto">/);
  });
  it('shows skeleton rows while candidates are gathering', () => {
    assert.match(src, /v-else-if="candState === 'running'"[\s\S]{0,200}data-webrtc-cand-skeleton/);
  });
});

describe('connectivity round id', () => {
  const src = read('components/ConnectivityTest.vue');
  it('no shared roundNo; each pass takes nextRound() at launch', () => {
    assert.doesNotMatch(src, /\broundNo\b/);
    assert.match(src, /checkAllConnectivity\(showToast, resetCards, !multi && !isAuto, nextRound\(\)\)/);
    assert.match(src, /checkAllConnectivity\(false, false, false, nextRound\(\)\)/);
    assert.match(src, /}, isManualRun, round\);/);
    assert.match(src, /note: round \? t\('testlog\.note\.round', \{ n: round \}\) : null/);
  });
  it('round counter resets per run', () => {
    assert.match(src, /roundsIssued = 0;\n\s+testLog\.begin\(/);
  });
});

describe('ui primitives in the main test components', () => {
  it('IP dossier: Skeleton loading + EmptyState error with retry', () => {
    const src = read('components/dossier/IpDossier.vue');
    assert.match(src, /<EmptyState tone="error"[\s\S]{0,120}@retry="load\(target\)"/);
    assert.doesNotMatch(src, /class="jn-skeleton/);
  });
  it('latency matrix: measured values are StatusPills', () => {
    const src = read('components/dossier/LatencyMatrix.vue');
    assert.match(src, /<StatusPill v-if="cell\.state === 'ok'/);
  });
  it('whois: skeleton while the lookup runs', () => {
    assert.match(read('components/advanced-tools/Whois.vue'), /data-whois-skeleton>\s*<SkeletonText/);
  });
  it('home: hero and IP cards use Skeleton', () => {
    assert.doesNotMatch(read('components/home/MyIpQuery.vue'), /class="jn-skeleton/);
    assert.doesNotMatch(read('components/ip-infos/IPCard.vue'), /animate-pulse/);
  });
});
