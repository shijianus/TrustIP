// The weighting contract for the profile that picks which countries get tested.
//
// These tests are the specification in executable form. The weights are not an
// implementation detail a reader can check by eye — they decide what the table
// shows, they move when a signal cannot be measured, and a change to one of them
// silently changes every visitor's experience. So each rule is asserted against
// literals: no browser, no network, no fixture that could drift.
//
// Where a rule says "promoted", the base weight is asserted too — a promotion that
// quietly became the default would leave this file passing and the page lying.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    SIGNALS,
    MIN_CONFIDENCE,
    MEASURED_MAX,
    INFERRED_MAX,
    scoreProfile,
    confidentTop,
    measuredCountries,
    scriptOf,
    osVotes,
    timezoneVotes,
    keyboardVotes,
    languageVotes,
    networkVotes,
} from '../common/split-profile.js';
import { hasPack } from '../common/site-packs.js';

// A desktop every signal agrees about. Deliberately Turkish rather than Latin-
// keyboarded: a plain QWERTY is *uninformative* by design, and a fixture that
// quietly drops a signal cannot be used to assert the full weight table.
const cnDesktop = {
    geo: { available: true, countries: ['CN'] },
    os: { available: true, platform: 'Windows', version: '10.0.19045' },
    tz: { available: true, zone: 'Asia/Shanghai' },
    ime: { available: true, layout: 'qwerty', keys: { KeyQ: 'q', KeyW: 'w' } },
    lang: { available: true, languages: ['zh-CN', 'en-US'] },
    net: { available: true, exitCountries: ['CN'], leakedCountries: [] },
};

// Every one of the six signals produces votes here, so the arithmetic of the
// weight table can be asserted at its full sum.
const istanbul = {
    ...cnDesktop,
    geo: { available: true, countries: ['TR'] },
    tz: { available: true, zone: 'Europe/Istanbul' },
    ime: { available: true, layout: 'qwerty', keys: { Semicolon: 'ş', KeyQ: 'q' } },
    lang: { available: true, languages: ['tr', 'en-US'] },
    net: { available: true, exitCountries: ['TR'], leakedCountries: [] },
};

describe('the weight table', () => {
    it('carries the six signals at their documented base weights', () => {
        const weights = Object.fromEntries(SIGNALS.map((s) => [s.id, s.weight]));
        assert.deepEqual(weights, { geo: 40, os: 20, tz: 15, ime: 10, lang: 5, net: 15 });
    });

    it('names the promotions it can apply, and to what', () => {
        const promoted = Object.fromEntries(SIGNALS
            .filter((s) => s.promoted)
            .map((s) => [s.id, `${s.promoted.when}:${s.promoted.to}`]));
        assert.deepEqual(promoted, { os: 'geoMissing:55', tz: 'geoMissing:25', net: 'leaking:25' });
    });

    it('applies no promotion when every signal answered', () => {
        const { weights, applied } = scoreProfile(istanbul);
        assert.deepEqual(weights, { geo: 40, os: 20, tz: 15, ime: 10, lang: 5, net: 15 });
        assert.equal(applied, 105);
    });

    it('hands the missing location over to the system and the clock', () => {
        const { weights, applied } = scoreProfile({ ...istanbul, geo: { available: false, reason: 'unresolved' } });
        assert.equal(weights.os, 55);
        assert.equal(weights.tz, 25);
        // Untouched: the input method and the language keep their own shares.
        assert.equal(weights.ime, 10);
        assert.equal(weights.lang, 5);
        assert.equal(applied, 55 + 25 + 10 + 5 + 15);
    });

    it('raises the network signal when a leak disagrees with the exit', () => {
        const leaked = scoreProfile({
            ...cnDesktop,
            net: { available: true, exitCountries: ['US'], leakedCountries: ['CN'] },
        });
        assert.equal(leaked.weights.net, 25);
        assert.ok(leaked.weights.geo === 40, 'a leak does not demote the address itself');
    });

    it('raises it for two exits in two countries even without a leak', () => {
        const split = scoreProfile({
            ...cnDesktop,
            net: { available: true, exitCountries: ['CN', 'US'], leakedCountries: [] },
        });
        assert.equal(split.weights.net, 25);
    });

    it('stacks both promotions at once', () => {
        const { weights, applied } = scoreProfile({
            ...istanbul,
            geo: { available: false, reason: 'unresolved' },
            net: { available: true, exitCountries: ['US'], leakedCountries: ['CN'] },
        });
        assert.deepEqual(weights, { geo: 40, os: 55, tz: 25, ime: 10, lang: 5, net: 25 });
        assert.equal(applied, 55 + 25 + 10 + 5 + 25);
    });
});

describe('scoring', () => {
    it('puts the country every signal agrees on first, decisively', () => {
        const { ranking, top } = scoreProfile(cnDesktop);
        assert.equal(ranking[0].cc, 'CN');
        assert.ok(ranking[0].pct > 60, `${ranking[0].pct}% is not decisive`);
        assert.deepEqual(top, ['CN']);
    });

    it('lets a WebRTC leak pull the visitor home while keeping the exit on screen', () => {
        // The case the whole feature is for: the traffic leaves through the
        // United States, the machine is in China. Both countries have to be
        // tested, because the split between them is the thing worth seeing — and
        // the leaked one leads, because a routing table that starts where the
        // visitor actually sits is answering the question they came with.
        const { ranking, top, measured } = scoreProfile({
            geo: { available: true, countries: ['US'] },
            os: { available: true, platform: 'Windows', version: '10.0.19045' },
            tz: { available: true, zone: 'Asia/Shanghai' },
            ime: { available: true, layout: 'qwerty', keys: { KeyQ: 'q' } },
            lang: { available: true, languages: ['zh-CN', 'en'] },
            net: { available: true, exitCountries: ['US'], leakedCountries: ['CN'] },
        });
        assert.deepEqual(measured, ['CN', 'US']);
        assert.deepEqual(top, ['CN', 'US']);
        assert.ok(ranking.find((r) => r.cc === 'CN').pct >= MIN_CONFIDENCE);
    });

    it('tests every country an address named, whatever the guess says', () => {
        // The old bug this replaces: one mainland IPv4 and one overseas IPv6 split
        // the geolocation signal down the middle, so each half landed near the
        // confidence floor and a confident guess could crowd a *measured* country
        // out of the table. A fact does not have to out-vote a guess to be tested.
        const split = {
            geo: { available: true, countries: ['CN', 'US'] },
            os: { available: true, platform: 'Windows', version: '10.0.22631' },
            tz: { available: true, zone: 'Asia/Shanghai' },
            ime: { available: true, layout: 'qwerty', keys: { KeyQ: 'q' } },
            lang: { available: true, languages: ['zh-CN'] },
            net: { available: true, exitCountries: ['CN', 'US'], leakedCountries: [] },
        };
        assert.deepEqual(scoreProfile(split).measured, ['CN', 'US']);
        // Both halves are individually below the floor as *guesses*: the ranking
        // still spends its arithmetic on them, and it is still not what decides.
        for (const entry of scoreProfile(split).ranking.filter((r) => ['CN', 'US'].includes(r.cc))) {
            assert.ok(entry.pct > 0 && entry.pct < 100, `${entry.cc} ${entry.pct}`);
        }
    });

    it('caps measured countries, and gives a country no pack nothing at all', () => {
        const wide = scoreProfile({
            geo: { available: true, countries: ['CN', 'US', 'JP', 'KR', 'DE', 'FR'] },
            net: { available: true, exitCountries: ['CN', 'US', 'JP', 'KR', 'DE', 'FR'], leakedCountries: [] },
        });
        assert.equal(wide.measured.length, MEASURED_MAX);
        assert.ok(wide.top.every(hasPack), 'a country with no destinations cannot be picked');
    });

    it('adds one guessed country to a measured list rather than replacing it', () => {
        // The clock and the keyboard are on the record for a reason: an exit that
        // resolves to Singapore while every browser signal says Taiwan is exactly
        // the disagreement worth a row of destinations.
        const { top, measured, inferred } = scoreProfile({
            geo: { available: true, countries: ['SG'] },
            os: { available: true, platform: 'Windows', version: '10.0.19045' },
            tz: { available: true, zone: 'Asia/Taipei' },
            ime: { available: true, layout: 'qwerty', keys: { KeyQ: 'q' } },
            lang: { available: true, languages: ['zh-TW'] },
            net: { available: true, exitCountries: ['SG'], leakedCountries: [] },
        });
        assert.deepEqual(measured, ['SG']);
        assert.deepEqual(inferred, ['TW']);
        assert.deepEqual(top, ['SG', 'TW']);
    });

    it('never spends an inference slot on a country already measured', () => {
        const { top } = scoreProfile(cnDesktop);
        assert.deepEqual(top, ['CN']);
        assert.equal(top.length, 1);
    });

    it('caps the guessed half at one country and only those with destinations', () => {
        const { ranking, top } = scoreProfile({
            geo: { available: false },
            os: { available: true, platform: 'Windows', version: '6.1.7601' },
            tz: { available: false },
            ime: { available: true, layout: 'other', keys: { KeyQ: 'й', KeyW: 'ц' } },
            lang: { available: false },
            net: { available: false },
        });
        assert.ok(ranking.length > 3, 'a legacy Windows machine should spread over several countries');
        assert.ok(ranking.some((r) => r.cc === 'AF' && !r.hasPack), 'countries without a pack still get scored');
        assert.ok(top.every((cc) => cc !== 'AF'), '…but they never get a section');
        assert.ok(top.length <= INFERRED_MAX, `${top.length} countries from a guess alone`);
    });

    it('normalises percentages over the weights that actually applied', () => {
        const full = scoreProfile(istanbul);
        // Same visitor, no keyboard API: the dropped signal's share moves to the
        // rest, so the leader's percentage rises rather than the total falling.
        const noKeyboard = scoreProfile({ ...istanbul, ime: { available: false, reason: 'unsupported' } });
        const leader = (r) => r.ranking.find((e) => e.cc === r.top[0]).pct;
        assert.ok(leader(noKeyboard) > leader(full), `${leader(noKeyboard)} vs ${leader(full)}`);
        assert.equal(noKeyboard.applied, full.applied - 10);
    });

    it('reports each unmeasured signal with the weight it would have had', () => {
        const { gaps } = scoreProfile({
            ...istanbul,
            ime: { available: false, reason: 'unsupported' },
            net: { available: true, exitCountries: [], leakedCountries: [] },
        });
        const byId = Object.fromEntries(gaps.map((g) => [g.id, g]));
        assert.equal(byId.ime.reason, 'unsupported');
        assert.equal(byId.ime.weight, 10);
        // Measured, and empty: a different failure from "the browser refused".
        assert.equal(byId.net.reason, 'uninformative');
        assert.equal(gaps.length, 2);
    });

    it('treats a signal that never arrived like one that cannot be measured', () => {
        const { gaps, applied } = scoreProfile({ geo: cnDesktop.geo });
        assert.equal(gaps.length, 5);
        assert.deepEqual(gaps.map((g) => g.reason).filter((r) => r !== 'absent'), []);
        assert.equal(applied, 40);
    });
});

describe('measuredCountries', () => {
    it('leads with the leak, because the leak is where the machine sits', () => {
        assert.deepEqual(measuredCountries({
            geo: { available: true, countries: ['US'] },
            net: { available: true, exitCountries: ['US'], leakedCountries: ['CN'] },
        }), ['CN', 'US']);
    });

    it('asks nothing of a signal that could not be measured', () => {
        assert.deepEqual(measuredCountries({
            geo: { available: false, reason: 'unresolved' },
            net: { available: true, exitCountries: ['DE'], leakedCountries: [] },
        }), ['DE']);
        assert.deepEqual(measuredCountries({}), []);
    });

    it('drops a country this build has no destinations for', () => {
        assert.deepEqual(measuredCountries({ geo: { available: true, countries: ['KP', 'KR'] } }), ['KR']);
    });
});

describe('confidentTop', () => {
    it('refuses a coin flip', () => {
        const ranking = [
            { cc: 'CN', pct: 9.4, hasPack: true },
            { cc: 'TW', pct: 8.1, hasPack: true },
            { cc: 'IR', pct: 40, hasPack: true },
            { cc: 'US', pct: 30, hasPack: true },
        ];
        assert.deepEqual(confidentTop(ranking), ['IR', 'US']);
    });

    it('skips a confident country that has no destinations', () => {
        assert.deepEqual(confidentTop([{ cc: 'KP', pct: 60, hasPack: false }, { cc: 'KR', pct: 20, hasPack: true }]), ['KR']);
    });
});

describe('signal voters', () => {
    it('separates the three UTC+8 clocks that a single offset would merge', () => {
        assert.deepEqual(Object.keys(timezoneVotes('Asia/Taipei')), ['TW']);
        assert.deepEqual(Object.keys(timezoneVotes('Asia/Shanghai')), ['CN']);
        assert.deepEqual(Object.keys(timezoneVotes('Asia/Urumqi')), ['CN']);
        assert.deepEqual(Object.keys(timezoneVotes('Asia/Kolkata')), ['IN']);
    });

    it('splits a shared zone across everyone who reads it', () => {
        const votes = timezoneVotes('Asia/Bangkok');
        assert.ok(Object.keys(votes).includes('TH'));
        assert.ok(Object.keys(votes).length > 1, 'Bangkok is not Thailand alone');
        assert.ok(Math.abs(Object.values(votes).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'a signal spends one whole vote');
    });

    it('reads a locator clock as nothing at all', () => {
        for (const zone of ['Etc/GMT+8', 'Etc/UTC', 'UTC', 'Factory', '']) {
            assert.deepEqual(timezoneVotes(zone), {}, `${zone} must not name a country`);
        }
    });

    it('names a keyboard by the letters it carries', () => {
        assert.equal(scriptOf('й'), 'cyrillic');
        assert.equal(scriptOf('ض'), 'arabic');
        assert.equal(scriptOf('پ'), 'arabic');
        assert.equal(scriptOf('ㅂ'), 'hangul');
        assert.equal(scriptOf('あ'), 'kana');
        assert.equal(scriptOf('ก'), 'thai');
        assert.equal(scriptOf('q'), null);
    });

    it('tells the Persian layout from every Arabic one', () => {
        // پ چ ژ گ exist on the Persian keyboard and on no Arabic layout, which is
        // the cleanest national signal a key map can give.
        assert.deepEqual(keyboardVotes({ keys: { KeyQ: 'ض', KeyI: 'پ' }, layout: 'other' }), { IR: 1 });
        const arabic = keyboardVotes({ keys: { KeyQ: 'ض', KeyW: 'ص' }, layout: 'other' });
        assert.equal(arabic.IR, undefined);
        assert.ok(arabic.SA > 0 && arabic.EG > 0);
    });

    it('spreads a Cyrillic keyboard across the countries that use one', () => {
        const votes = keyboardVotes({ keys: { KeyQ: 'й', KeyW: 'ц' }, layout: 'other' });
        assert.ok(votes.RU > votes.UA && votes.UA > 0);
    });

    it('scores a Turkish key at the characters that make it Turkish', () => {
        const votes = keyboardVotes({ keys: { Semicolon: 'ğ', KeyQ: 'q' }, layout: 'qwerty' });
        assert.ok(votes.TR > 0);
        assert.equal(votes.TR, Math.max(...Object.values(votes)));
    });

    it('refuses to guess from a plain Latin QWERTY', () => {
        // The honest answer, and the one that moves the weight elsewhere: a third
        // of the planet types on this layout.
        assert.deepEqual(keyboardVotes({ keys: { KeyQ: 'q', KeyW: 'w' }, layout: 'qwerty' }), {});
    });

    it('lets the first language preference carry the guess', () => {
        const votes = languageVotes(['zh-Hant-TW', 'en-US']);
        assert.ok(votes.TW > votes.US, `${JSON.stringify(votes)}`);
        assert.deepEqual(languageVotes([]), {});
    });

    it('reads a Windows era out of the version, including the 10-or-11 blur', () => {
        assert.ok(Object.keys(osVotes({ platform: 'Windows', version: '6.1.7601' })).includes('IR'), 'legacy Windows');
        const ten = osVotes({ platform: 'Windows', version: '10.0.19045' });
        const eleven = osVotes({ platform: 'Windows', version: '10.0.22631' });
        assert.ok(ten.CN > 0 && eleven.CN > 0);
        assert.ok(eleven.US > ten.US, 'build 22000+ is the Windows 11 population');
        assert.deepEqual(osVotes({ platform: 'BeOS', version: '5' }), {});
    });

    it('trusts a leaked address over the exit it disagrees with', () => {
        const votes = networkVotes({ exitCountries: ['US'], leakedCountries: ['CN'] });
        assert.ok(votes.CN > votes.US, 'the leak is where the machine sits');
        const alone = networkVotes({ exitCountries: ['US'], leakedCountries: [] });
        assert.deepEqual(alone, { US: 1 });
    });

    it('never lets one signal spend more than its weight', () => {
        for (const votes of [
            osVotes({ platform: 'Windows', version: '10.0.19045' }),
            timezoneVotes('Asia/Bangkok'),
            keyboardVotes({ keys: { KeyQ: 'й' }, layout: 'other' }),
            languageVotes(['ru-RU', 'en', 'uk', 'de', 'fr']),
            networkVotes({ exitCountries: ['US', 'GB'], leakedCountries: ['CN', 'HK'] }),
        ]) {
            const total = Object.values(votes).reduce((a, b) => a + b, 0);
            assert.ok(Math.abs(total - 1) < 1e-9 || total === 0, `${JSON.stringify(votes)} totals ${total}`);
        }
    });
});
