// The provider answer shape, as common/providers/answer.js defines it — reduced
// to what this deployment's one key-free provider actually fills in.
//
// The distinction that survives, and the reason the file exists: a provider can
// answer with a field it did not send, and writing `false` there would hand the
// caller a clean bill of health nobody issued. Absent stays `null`. `errored` is
// the third state — it was asked and did not answer — which the `internetdb`
// route reports as a 500 rather than as "no record".

export const PROVIDER_TIMEOUT_MS = 5000;

export const STATUS = { ok: 'ok', unavailable: 'unavailable', error: 'error' };

// A factory, not a frozen object literal: the list defaults would otherwise be
// one array shared by every answer built from it.
const EMPTY = () => ({
    isProxy: null, isTor: null,
    ports: [], hostnames: [], cpes: [], tags: [], vulns: [],
    observedIp: null,
});

export const answered = (source, fields = {}) => ({
    source,
    status: STATUS.ok,
    authority: null,
    ...EMPTY(),
    ...fields,
});

export const errored = (source, reason) => ({
    source, status: STATUS.error, reason, ...EMPTY(),
});

// A non-empty string, trimmed; `''`, `'-'` and `'N/A'` are not values.
export const toText = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text !== '-' && text !== 'N/A' ? text : null;
};
