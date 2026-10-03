# Getting help

TrustMy.IP keeps no documentation site and no chat channel: everything happens on GitHub,
in the open, so the next person with the same question can find the answer.

## Documentation first

Start with what lives in this repository — it is the authoritative description of **this
fork** (the upstream project's own docs describe IPCheck.ing's hosted setup instead):

- **[README.md](README.md)** — what the toolbox does, quick start, and the honest list of
  what runs with zero configuration versus what stays hidden without a credential.
- **[.env.example](.env.example)** — every variable the backend and the frontend actually
  read, and what stops working when each one is empty.
- **[`AGENTS.md`](AGENTS.md)** plus [`frontend/AGENTS.md`](frontend/AGENTS.md) and
  [`api/AGENTS.md`](api/AGENTS.md) — architecture, conventions, and the reasoning behind
  them. Written for humans and AI agents alike.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[TRANSLATING.md](TRANSLATING.md)** ·
  **[SECURITY.md](SECURITY.md)**

The single setting that accounts for most self-hosting reports: **`ALLOWED_DOMAINS`**.
Without it, every `/api/*` request from a non-localhost origin gets **403** — the referer
guard is global. (MaxMind credentials are worth setting too, but they are optional: the
other IP sources keep working and `/api/maxmind` just answers 503.)

## Where to ask

| You want to… | Go to |
|---|---|
| Ask how to do something, or why a result looks odd | [New issue](https://github.com/shijianus/TrustIP/issues/new/choose) — say how you're running it |
| Report a bug you can reproduce | [New issue → Bug report](https://github.com/shijianus/TrustIP/issues/new?template=bug_report.md) |
| Suggest a feature | [New issue → Feature request](https://github.com/shijianus/TrustIP/issues/new?template=feature_request.md) |
| Report a security vulnerability | [Private advisory](https://github.com/shijianus/TrustIP/security/advisories/new) — see [SECURITY.md](SECURITY.md) |
| Contribute code or a translation | [CONTRIBUTING.md](CONTRIBUTING.md) · [TRANSLATING.md](TRANSLATING.md) |
| Ask about the original MyIP project | [github.com/jason5ng32/MyIP](https://github.com/jason5ng32/MyIP) and its docs at [docs.ipcheck.ing](https://docs.ipcheck.ing) |

## Making your question answerable

Deployment questions need: how you're running it (Docker build from this repo / `pnpm
start` / `pm2`), the commit or version, what you set for `ALLOWED_DOMAINS`, and the backend
terminal output — the startup lines say exactly which datasets and optional sources are
active.

Page questions need: browser, what you saw versus what you expected, and any errors from
the browser console.

A feature you expected to find and don't is usually not a bug: check
[the "What stays dark" table in the README](README.md#what-stays-dark) first — several
tools ride on credentials this fork does not have.

This fork is maintained in spare time. Replies aren't instant, and a question that already
contains the details above gets answered a lot sooner.
