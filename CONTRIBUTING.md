# Contributing to TrustMy.IP

Thanks for your interest in contributing! **TrustMy.IP** (engineering name **TrustIP**,
published by **EpoCanvas**) is an open-source IP toolbox — IP lookup, connectivity tests,
WebRTC / DNS-leak detection, speed test, and more — built as a Vue 3 SPA with an Express 5
backend.

It is a fork of **[MyIP](https://github.com/jason5ng32/MyIP)** by
**Jason Ng**, distributed under the same [MIT license](LICENSE). The `LICENSE` file stays
`MIT © Jason Ng`: attribution of the original work is a condition of that license, not a
formality, and pull requests that strip it out will be asked to restore it. Upstream
changes keep flowing in through [`.github/workflows/sync.yml`](.github/workflows/sync.yml),
so a PR here competes with upstream edits — the branding, deployment and configuration
files this fork owns are the places where conflicts get resolved by hand.

New here? Look for issues labeled
[`good first issue`](https://github.com/shijianus/TrustIP/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
— they're scoped to be doable without knowing the whole codebase.

## The one rule that makes this fork what it is

**A deployment with no environment variables set must keep working.** Concretely:

- Never make a feature *require* configuration to start. Read the variable with a fallback,
  or take the handler's existing "not configured" branch
  (`res.status(500).json({ error: 'API key is missing' })`, `503` for report sharing).
- An unset value must never reach `.split()` or `new URL()` — that is a `TypeError`, and a
  misconfiguration should be an answer, not a crash.
- Gate the UI the same way the code gates itself: `/api/configs` booleanizes the env vars,
  so a feature with no credential stays hidden instead of erroring on click.
- Every new env read lands in the same change as its
  [`.env.example`](.env.example) entry, with a comment saying what stops working when the
  value is empty.

## Quick start

1. **Fork** the repo and create your branch **from `dev`** (never `main` — `main` only
   receives release merges from `dev`).
2. **Set up:** Node.js 24+ (same as CI) and pnpm, from a clean tree with **no `.env`** —
   that is the configuration every change is expected to work in. The pnpm version is
   pinned via the `packageManager` field, so the easiest path is:

   ```bash
   corepack enable   # or: npm install -g pnpm
   pnpm install
   pnpm dev          # starts Vite + the backend together
   ```

   **pnpm only.** npm or yarn would produce a competing lockfile — PRs that touch
   `package-lock.json` / `yarn.lock` will be asked to redo the install with pnpm.
3. Make your change — **one concern per PR**, don't bundle unrelated changes.
4. **Run `pnpm check`** (tests + production build). It must be green before you open a PR.
5. Open your PR **against `dev`**, rebased onto the latest `dev`, with a clear
   description of what changed and why.

For anything non-trivial, open an issue first to discuss the approach — it saves you
from building something that can't be merged.

## Project map

```
frontend/   Vue 3 SPA (Pinia, vue-router, vue-i18n, Tailwind v4 + shadcn-vue)
api/        Express 5 handlers, one file per route (wired in backend-server.js)
common/     Code shared by both halves (validators, fetch helper, logger, …)
tests/      Node test runner specs (node --test)
```

**The real architecture and convention docs are the AGENTS.md files:**
[`AGENTS.md`](AGENTS.md) (root), [`frontend/AGENTS.md`](frontend/AGENTS.md), and
[`api/AGENTS.md`](api/AGENTS.md). Don't let the filename fool you — they're written
for humans and AI agents alike, and they're the single source of truth for how this
repo works. Read the root one plus whichever half you're touching before writing code.

The upstream project also keeps a longer documentation site,
[docs.ipcheck.ing](https://docs.ipcheck.ing) — written for MyIP / IPCheck.ing, so its
deployment walkthroughs assume credentials and hosted infrastructure this fork does not
have. Good background, not a setup guide for here.

## Key conventions (short version)

Details and rationale live in the AGENTS.md files; the headlines:

- **JavaScript only** — no TypeScript, no `lang="ts"`.
- **New functions use `const` arrow syntax** (`const fn = async () => {}`).
- **Every new file opens with a header comment** stating its purpose.
- **The `full` locales land together** — user-visible copy ships in `en` / `zh` / `zh-TW` /
  `fr` / `ru` / `pt-BR` in the same PR (`frontend/locales/`; tests enforce it). `beta` locales are
  exempt — they fall back to English.
- **Backend logging goes through the shared pino logger** (`common/logger.js`) —
  no `console.*` in `api/` or `common/`.
- **Every outbound HTTP call from `api/` goes through `fetchUpstream`**
  (`common/fetch-with-timeout.js`) — never a bare `fetch()`.

## Good places to start

**DNS resolvers** — the resolver list lives in `api/data/dns-resolvers.js`, a
country-annotated data file written for exactly this kind of PR (the header
comment documents the entry shape and rules, and `tests/dns-resolvers-data.test.js`
checks your entry). Adding a well-known public resolver — especially from a
country not yet represented — is a one-object change; the UI groups results
by country automatically.

**Connectivity test sites & lists** — curated site lists live in
`frontend/data/connectivity-import-lists.js`. Each member needs a committed 64px PNG
icon at `public/favicons/<id>.png`, but you normally don't source it yourself: run
`pnpm test` locally and the data test auto-downloads any missing icons (also
runnable directly as `pnpm fetch-favicons`). Only if auto-fetch can't find a usable
PNG do you hand-source one (on macOS, `sips` handles ICO→PNG). Remember to commit
the PNGs with your change — CI stays offline and only checks they exist.

**README translations** — beyond the six READMEs we maintain (`en` / `zh` / `zh-TW` / `fr` /
`ru` / `pt-BR`), community-maintained translations in any language are welcome. Create
`README_<LANG>.md` from the English [README.md](README.md) (the canonical source),
open it with a one-line "community-maintained translation — English is canonical"
note in your language, and add your language to the switcher row near the top of the
existing READMEs. Keep code blocks, URLs, and badges unchanged. Check open issues
for requested languages before starting.

**UI translations** — improvements to the existing `en` / `zh` / `zh-TW` / `fr` / `ru` /
`pt-BR` packs are welcome, and so is a whole new language. Adding one is two files: a
locale pack under `frontend/locales/` and a line in `common/locale-registry.js`. **A
partial pack is a welcome first PR** — anything you don't translate falls back to English,
and the language ships as `beta` until it's complete. Full walkthrough:
**[TRANSLATING.md](TRANSLATING.md)**.

**Making the zero-config deploy better** — every feature that today hides itself when a
credential is missing is a candidate for a keyless path. Proposals that make another
tool work out of the box are exactly the kind of change this fork exists for.

## Bugs & feature requests

Use the issue templates in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) —
one for bug reports (include terminal / browser console logs) and one for feature
requests. Questions, setup help, and "is this a bug?" go to
[the issue tracker](https://github.com/shijianus/TrustIP/issues) too — see
[SUPPORT.md](SUPPORT.md). Security vulnerabilities go through the
private channel in [SECURITY.md](SECURITY.md), never a public issue.

## Testing

- Specs live in `tests/` and run with `pnpm test` (Node's built-in test runner).
- Non-visual logic — pure functions, composables, transforms, validators — ships with
  a spec in the same PR. Tests never hit real upstreams (the one exception: the
  connectivity data test may download missing favicons on local runs, never in CI).
- New or changed "not configured" branches get a smoke test in
  `tests/api-handlers.test.js` — assert on the branch that returns *before* the first
  `fetchUpstream`, which is what makes the suite offline-safe.
- UI rendering and browser APIs are out of scope for the Node runner; visual changes
  are verified by the maintainer during review, so mention in your PR what to look at.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating,
you agree to uphold it.

---

Thank you for making TrustMy.IP better! Every contribution — a one-line fix, a new
resolver, a better translation — is appreciated.
