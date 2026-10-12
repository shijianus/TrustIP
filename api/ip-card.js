// GET /api/ip-card?ip=<public ip>&lang=<tag>
//
// One PNG about one address: the shareable form of the dossier's headline facts —
// the address, the country its own echo named, the AS behind it, what kind of network
// the registries say it is, the trust score and the clock the evidence was assembled
// on. A verdict that cannot be shared becomes a screenshot, and a screenshot is where
// the provenance goes, so the timestamp is on the image's face rather than in a header
// nobody carries.
//
// What is *not* on it: an API key, a vendor payload, a registrant's name or contact,
// and the per-signal weight table. This is the one trust artifact in the build that is
// made to leave — it gets reposted somewhere we cannot correct it — so the lines
// `common/trust-score.js` and the provider adapters hold are applied here as well.
//
// The route is gated on a font, not on a credential: `common/ip-card.js` explains why
// text needs font bytes and why this build ships none. When no font can be found the
// answer is 503 *before* any upstream is asked, and `/api/configs` says `ipCard: false`
// so the UI never offers a button that cannot work.
//
// Presence, syntax and public routability of `?ip` are guaranteed upstream by
// `requirePublicIP`; `?lang` is passed through unvalidated, as everywhere else, and
// resolved down the locale fallback chain by the card module.

import { gatherTrustEvidence } from '../common/trust-signals.js';
import { assessTrust } from '../common/trust-score.js';
import { renderCard, cardLabel, isCardConfigured } from '../common/ip-card.js';
import logger from '../common/logger.js';

export default async (req, res) => {
    const ipAddress = req.query.ip;

    if (!isCardConfigured()) {
        return res.status(503).json({ error: 'Card rendering is not configured' });
    }

    try {
        const evidence = await gatherTrustEvidence(ipAddress);
        const result = assessTrust(evidence);
        const lang = req.query.lang;

        const png = await renderCard({
            ip: ipAddress,
            country: evidence.geo?.country_code || evidence.rir?.country || null,
            asn: evidence.geo?.asn || null,
            org: evidence.asName || evidence.geo?.org || null,
            clsLabel: cardLabel(lang, `trustip.value.${result.cls}`),
            score: Number.isFinite(result.score) ? result.score : null,
            band: Number.isFinite(result.band) ? result.band : null,
            generatedAt: new Date().toISOString(),
            lang,
        });

        if (!png) {
            // The gate passed and the render still found nothing: a font file that
            // became unreadable between the two calls. Same answer, same reason.
            return res.status(503).json({ error: 'Card rendering is not configured' });
        }

        res.set('Content-Type', 'image/png');
        res.set('Content-Length', String(png.length));
        return res.status(200).send(png);
    } catch (e) {
        logger.error({ err: e, ip: ipAddress }, 'ip-card handler failed');
        return res.status(500).json({ error: 'Upstream request failed' });
    }
};
