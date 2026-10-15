// Validates the shared IP parser. frontend/utils/valid-ip.js is a thin
// re-export of common/valid-ip.js; we import both paths and assert they
// agree, which catches any regression where the re-export breaks (e.g.
// someone duplicates the implementation again).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isValidIP as isValidCommonIP, isValidDomain as isValidCommonDomain, isIPv6 as isCommonIPv6, isUsablePublicIP as isCommonUsablePublicIP, parseAsnQuery as parseCommonAsn } from '../common/valid-ip.js';
import { isValidIP as isValidFrontendIP, isValidDomain as isValidFrontendDomain, isIPv6 as isFrontendIPv6, isUsablePublicIP as isFrontendUsablePublicIP, parseAsnQuery as parseFrontendAsn } from '../frontend/utils/valid-ip.js';
// A third copy: the Qoder Sites edge function is dependency-free and cannot reach
// common/. If the two halves disagree about what counts as an AS input, the same
// query answers on the self-hosted build and 400s on the hosted one.
import { parseAsnQuery as parseEdgeAsn } from '../functions/shared/valid-ip.js';

const validAddresses = [
  '1.1.1.1',
  '8.8.8.8',
  '0.0.0.0',
  '10.100.101.200',
  '9.10.99.100',
  '199.200.249.250',
  '255.255.255.255',
  '2001:4860:4860::8888',
  '2001:0486:0000:0000:0000:0000:0000:0001',
  '::1',
];

const invalidAddresses = [
  '',
  'hello',
  '256.1.1.1',
  '1.1.1',
  '01.8.8.8',
  '8.008.8.8',
  '8.8.00.8',
  '8.8.8.08',
  '8.8.8.010',
  '8.8.8.001',
  '2001:::8888',
];

describe('IP validation helpers', () => {
  for (const ip of validAddresses) {
    it(`accepts ${ip}`, () => {
      assert.equal(isValidCommonIP(ip), true);
      assert.equal(isValidFrontendIP(ip), true);
    });
  }

  for (const ip of invalidAddresses) {
    it(`rejects ${ip || 'empty string'}`, () => {
      assert.equal(isValidCommonIP(ip), false);
      assert.equal(isValidFrontendIP(ip), false);
    });
  }
});

const validDomains = [
  'example.com',
  'sub.example.com',
  'a.b.c.example.co',
  'EXAMPLE.COM',
  'xn--n3h.example',
  'with-hyphen.io',
  '_dmarc.example.com',                  // RFC 8552 underscored service names —
  '_xmpp-server._tcp.example.com',       // DnsResolver has to be able to reach
  'selector1._domainkey.example.com',    // DMARC / DKIM / SRV records
];

const invalidDomains = [
  '',
  'nodot',
  '.example.com',
  'example.',
  'example..com',
  'has_underscore.com',   // underscore is a label prefix only, not mid-label
  'example._com',         // ...and never in the TLD
  '_.com',                // ...and never the whole label
  'trailing.dot.',
  'one.1',         // TLD must be 2+ letters, not digits
  '192.168.1.1',   // numeric-only TLD is rejected
  null,
  undefined,
  42,
];

describe('Domain validation helpers', () => {
  for (const d of validDomains) {
    it(`accepts ${d}`, () => {
      assert.equal(isValidCommonDomain(d), true);
      assert.equal(isValidFrontendDomain(d), true);
    });
  }

  for (const d of invalidDomains) {
    const label = d == null ? String(d) : (d === '' ? 'empty string' : d);
    it(`rejects ${label}`, () => {
      assert.equal(isValidCommonDomain(d), false);
      assert.equal(isValidFrontendDomain(d), false);
    });
  }
});

describe('isIPv6', () => {
  it('separates v6 from v4 for valid IPs, both import paths agreeing', () => {
    for (const [ip, expected] of [
      ['2001:4860:4860::8888', true],
      ['::1', true],
      ['1.1.1.1', false],
      ['255.255.255.255', false],
    ]) {
      assert.equal(isCommonIPv6(ip), expected);
      assert.equal(isFrontendIPv6(ip), expected);
    }
  });

  it('is false for non-strings (it does not validate, only discriminates)', () => {
    assert.equal(isCommonIPv6(null), false);
    assert.equal(isCommonIPv6(42), false);
  });
});

// Addresses outside publicly routable space — every IP form in the app
// short-circuits on these rather than spending a lookup that can only fail.
// Every v4 case below appeared in a real production Whois query.
const reservedAddresses = [
  '10.92.24.150',
  '172.16.0.1',
  '172.30.232.1',
  '192.168.1.1',
  '127.0.0.1',
  '169.254.10.1',
  '100.64.0.1',
  '198.18.0.2',
  '192.0.2.1',
  '203.0.113.9',
  '224.0.0.1',
  '255.255.255.255',
  '0.0.0.0',
  '::',
  '::1',
  '::ffff:c000:1',    // IPv4-mapped
  '64:ff9b::1',
  '100::1',
  '4000::1',          // unassigned — outside global unicast 2000::/3
  'fbff::1',          // unassigned, just below the ULA block
  'fd00::1',
  'fe80::1ff:fe23:4567:890a',
  '2001::1',          // Teredo
  '2001:20::1',       // ORCHIDv2
  '2001:db8::1',
  '2002:c000:204::1', // 6to4
  '3fff::1',          // documentation, RFC 9637
  'ff02::1',
];

const publicAddresses = [
  '1.1.1.1',
  '8.8.8.8',
  '9.9.9.9',
  '172.15.255.255',   // just below the RFC 1918 /12
  '172.32.0.1',       // just above it
  '100.63.255.255',   // just below CGNAT
  '100.128.0.1',      // just above it
  '198.20.0.1',       // just above the benchmarking /15
  '223.255.255.255',  // last address before multicast
  '204.1.92.8',
  '2001:4860:4860::8888',
  '2400:cb00::1',
  '2a03:f80:372:1c55::1',
  '2000::1',          // lower bound of global unicast
  '2001:1::1',        // just above Teredo
  '2001:30::1',       // just above ORCHIDv2
  '2001:db9::1',      // neighbour of the documentation prefix
  '3fff:1000::1',     // just above the RFC 9637 documentation block
];

describe('isUsablePublicIP', () => {
  for (const ip of reservedAddresses) {
    it(`rejects ${ip} as outside public space`, () => {
      assert.equal(isCommonUsablePublicIP(ip), false);
      assert.equal(isFrontendUsablePublicIP(ip), false);
    });
  }

  for (const ip of publicAddresses) {
    it(`accepts ${ip}`, () => {
      assert.equal(isCommonUsablePublicIP(ip), true);
      assert.equal(isFrontendUsablePublicIP(ip), true);
    });
  }

  // Validation is folded in, so anything that isn't an IP is not usable.
  for (const junk of [...invalidAddresses, null, undefined, 42]) {
    it(`rejects the non-address ${JSON.stringify(junk)}`, () => {
      assert.equal(isCommonUsablePublicIP(junk), false);
      assert.equal(isFrontendUsablePublicIP(junk), false);
    });
  }
});

describe('parseAsnQuery', () => {
  const accepted = [
    ['AS15169', 15169],
    ['as15169', 15169],
    ['As15169', 15169],
    // The bare number is the form people copy out of a BGP table. It is valid as
    // neither an IP nor a domain, so accepting it costs nothing in ambiguity.
    ['15169', 15169],
    [' AS 9268 ', 9268],
    ['\tas  13335\n', 13335],
    ['AS000001', 1],
    ['4294967294', 4294967294],
  ];

  const rejected = [
    // AS0 and the 32-bit reserved tail have no registry object to find.
    ['0', null], ['AS0', null], ['4294967295', null], ['99999999999', null],
    // Not an AS, and each of these belongs to a different branch of the WHOIS input.
    ['8.8.8.8', null], ['example.com', null], ['1.2.3.4', null], ['AS', null],
    ['1e9', null], ['abc', null], ['-5', null], ['12 34', null], ['', null],
    [null, null], [undefined, null], [42, null], [{}, null],
  ];

  for (const [input, expected] of [...accepted, ...rejected]) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(parseCommonAsn(input), expected);
      assert.equal(parseFrontendAsn(input), expected);
      assert.equal(parseEdgeAsn(input), expected);
    });
  }

  // `as?` is "a" plus an optional "s", not an optional "as". Writing the prefix
  // that way makes every bare number fail to parse while `AS15169` still works —
  // which is exactly the silent half-break this pins.
  // The query is `?q=` verbatim: a long whitespace run ending in a non-digit used
  // to cost quadratic backtracking (16 000 spaces held the event loop ~430 ms).
  it('rejects a 100k-space query in linear time on every copy', () => {
    for (const parse of [parseCommonAsn, parseFrontendAsn, parseEdgeAsn]) {
      for (const input of [' '.repeat(100_000) + 'x', 'AS' + ' '.repeat(100_000) + 'x', ' '.repeat(100_000)]) {
        const started = performance.now();
        assert.equal(parse(input), null);
        assert.ok(performance.now() - started < 50, `took ${(performance.now() - started).toFixed(1)} ms`);
      }
    }
  });

  it('reads padding as padding but refuses an over-long query', () => {
    assert.equal(parseCommonAsn(' '.repeat(100_000) + 'AS15169' + ' '.repeat(100_000)), 15169);
    assert.equal(parseCommonAsn('AS' + ' '.repeat(60) + '15169'), null);
  });

  it('does not require the prefix to be spelled at all', () => {
    assert.equal(parseCommonAsn('15169'), 15169);
    assert.equal(parseCommonAsn('AS15169'), parseCommonAsn('15169'));
  });

  it('an IP and an AS number never both claim the same input', () => {
    for (const ip of validAddresses.slice(0, 6)) {
      assert.equal(isValidCommonIP(ip), true);
      assert.equal(parseCommonAsn(ip), null, `${ip} parsed as an AS too`);
    }
  });
});
