# AGENTS.md

Single source of truth for anyone — human or AI — contributing to TrustMy.IP.
Area rules: @frontend/AGENTS.md (Vue SPA) · @api/AGENTS.md (Express API).

## Local skill discovery

Before choosing a workflow, scan the gitignored `.skills/` directory at the repo
root (`rg --files --hidden --no-ignore .skills -g SKILL.md`) and follow any
`SKILL.md` whose description applies — before picking a fallback tool or calling
a project capability unavailable.

## Overview

**TrustMy.IP** (engineering name **TrustIP**, published by **EpoCanvas**): an
open-source IP toolbox — IP lookup, connectivity, WebRTC / DNS-leak detection,
speed test, MTR, Whois, ASN profile, MAC
lookup, security checklist, browser fingerprint, anonymity
checks, persona check, IP calculator. Vue 3 SPA + Express 5 API, one repo.

MIT derivative of **MyIP / IPCheck.ing** by Jason Ng: the license requires the
attribution, so the upstream name stays in comments wherever it names the
*upstream* service. Runtime identifiers — package name, outbound User-Agent, pm2
/ container names, repo badge — are TrustIP's.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vue 3 `<script setup>` · Pinia · vue-router (HTML5 history) · vue-i18n (`common/locale-registry.js`) |
| Build | Vite · Tailwind CSS v4 + `tw-animate-css` |
| UI | shadcn-vue copy-in primitives (reka-ui) · lucide · circle-flags · vaul drawer · vue-sonner |
| Backend | Express 5 · pino (`common/logger.js`, `pino-http` opt-in) |
| Optional, env-gated | Firebase Auth · Sentry on both halves |
| Delivery | PWA `manifest.webmanifest` only, no service worker · tests on `node --test` · optional Qoder Sites target: `functions/` (one edge `app` function, key-free routes only) with `dev/function-local.mjs` as its local harness |

Already in the bundle — reuse before adding a dependency: chart.js ·
chartjs-chart-geo · @cloudflare/speedtest · maxmind · whoiser · thumbmarkjs ·
ua-parser-js · detect-gpu · @vueuse/core.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite + backend (nodemon) together |
| `pnpm build` / `pnpm preview` | Front-end production build / Vite preview of it |
| `pnpm start` | Built front-end + backend |
| `pnpm test` / `pnpm check` | `tests/*.test.js` / `test` + `build` — the pre-commit self-check |
| `SITE_FUNCTIONS=1 pnpm build` | Same build, addressed to a Qoder Sites edge function instead of `/api` (see frontend/AGENTS.md) |

**pnpm only** (`packageManager` pin, committed lockfile, `pnpm-workspace.yaml`
`allowBuilds` approvals and `overrides` that pin patched versions of vulnerable
transitive dependencies); npm / yarn would produce a competing lockfile.

## Project layout

```
frontend/ · api/      ← SPA and Express handlers (own AGENTS.md each)
common/               ← shared back-end code; the SPA imports parts of it
tests/                ← Node test runner specs
backend-server.js     ← Express app, every route wired here (default 127.0.0.1:11966)
frontend-server.js    ← static server for `pnpm start` (app in common/frontend-app.js: proxy, SPA fallback, CSP, no-store misses)
sentry-instrument.js  ← backend Sentry bootstrap via `node --import`
ecosystem.config.cjs  ← pm2 definitions (carries the `--import` flag)
index.html · vite.config.js · jsconfig.json (alias @ → frontend/)
```

## Conventions

- **JavaScript only** — new files are `.js` / `.vue`, no `lang="ts"`. The one exception is the Qoder Sites entry pair `functions/index.ts` / `functions/handler.ts`, which the edge runtime loads as TypeScript; everything under `functions/shared/` stays `.js`. The one exception is `functions/`: its entry files (`index.ts`, `handler.ts`) are TypeScript because the Qoder Sites runtime runs them as-is; its `shared/` modules stay `.js`, and the ones that are verbatim copies of `common/` are pinned by `tests/site-functions.test.js`, so edit both sides together. **English** for code comments, commit messages and this file; locale packs carry their own language.
- **New functions are `const` arrow** (`const fn = async () => {}`), not `function` declarations; object methods keep shorthand. Not hoisted — declare before use. New / rewritten code only; don't mass-convert.
- **Every new file opens with a header comment** stating its purpose (except `frontend/components/ui/`, shadcn-vue CLI output kept verbatim so it can be re-synced); large templates / functions carry a block comment per region. **Comments describe the code as it is now** — no changelog narration (`previously…`), git owns the past, and a comment never outgrows the code it explains.
- **A deployment with zero environment variables is a supported configuration** — how this fork ships. Every `process.env` read falls back or takes an early "not configured" branch, and an unset value never reaches `.split()` / `new URL()`. Key-free sources keep working; key-mandatory ones answer `500 { error: 'API key is missing' }` before any request leaves the process; `/api/configs` booleanizes the same variables so the UI hides the feature instead of failing (handler detail in @api/AGENTS.md).
- **`.env.example` is the contract** — every variable the code reads is documented there with what breaks when it is empty. A new env read lands with its entry in the same change.
- **`VITE_SITE_URL` is the single source of the canonical origin** — the `index.html` canonical / og / twitter URLs (via `siteUrlHtmlPlugin`) and the third segment of the outbound User-Agent. Empty is a valid build.
- **i18n**: copy-surfacing features land in **every `full` locale** in the same change, `frontend/data/changelog.json` included (`tests/changelog.test.js` and `tests/locale-packs.test.js` enforce it against `en`). `beta` locales may lag — their gaps resolve down the fallback chain in `common/locale-registry.js`, which is also where a new language is registered. Walkthrough: [TRANSLATING.md](TRANSLATING.md).
- **Backend logging**: shared logger only, `logger.error({ err, ip }, 'short message')`; bare `console.*` is banned there (the frontend still uses it). Handlers never log "received request" lines — `LOG_HTTP=true` mounts `pino-http`. Knobs: `LOG_LEVEL`, `LOG_FORMAT=json`, `LOG_HTTP`; no `NODE_ENV` anywhere. Startup-only lines lead with an emoji (🚀 listening · 📦 ready · 📥 downloading · 🐢 throttling · 🗓️ schedule · ⚠️ recoverable · ❌ failure); per-request logs stay plain.

## Testing

Anything non-visual that needs no network — pure functions, composables with
mockable inputs, transforms, validators — ships with a spec in `tests/` in the
same change, and behavior shifts update the affected specs. UI rendering, real
network behavior and browser APIs are out of scope. **`pnpm check` must be green
before handing off.**

Two things that spec does cover, because they are easy to assume otherwise:

- **The upstream sync's merge logic is tested.** `tests/upstream-sync-workflow.test.js`
  extracts the `Merge upstream into dev, or file the conflicts` step's script out of
  `.github/workflows/sync.yml` and runs it as the runner does (`bash --noprofile
  --norc -eo pipefail`) against throwaway git repos, with git config isolated
  (`GIT_CONFIG_GLOBAL=/dev/null`) and a `gh` stub whose `gh api` answers come from
  JSON fixtures run through the script's own `--jq` filter (needs `git` ≥ 2.38 and
  `jq`). Rename or reformat that step and the extraction fails by name — a silent
  no-op there would leave the schedule untested. What it pins: the sync never pushes
  `dev` or `main` — a clean merge goes to the bot branch `sync/upstream-<sha12>` plus
  one PR into `dev` (opened with `GITHUB_TOKEN`, so CI does not run on it until
  someone closes and reopens it or pushes to it; merge it with a merge commit);
  a conflict, or a clean merge that changes `.github/workflows`, is one tracking
  issue found by its marker and bot author, never its title; a failed merge-tree,
  push or API call is red; path names never reach the log or escape the issue's
  code block. Its static checks fail on new permissions, a new trigger, `${{` inside
  a `run:`, or an action not pinned by SHA.
- **A runtime missing an ICU surface skips, with the reason, and never passes.**
  `Intl.Locale#getTimeZones` / `#timeZones` (region-info data) and `Intl.DurationFormat` are not in
  every Node the suite runs on; the guarded specs report `skipped` rather than failing
  or asserting against the fallback as if it were the real thing. So `pnpm check` on
  such a runtime ends `0 fail, 5 skipped` — that is green, not a hole in the run.

## Security & Boundaries

Access control and timeouts live in shared middleware, never in handlers (details
in @api/AGENTS.md): `requireReferer` is global on `/api/*`, `requirePublicIP()` is
per-route, and every upstream call goes through `fetchUpstream`
(`common/fetch-with-timeout.js`, 8s) — never a bare `fetch()` in `api/`.

## Workflow

- **Branch discipline — `dev` in, `dev` out.** `main` only moves via dev → main PRs. From a worktree, fast-forward dev with `git push . HEAD:dev` (the repo sets `receive.denyCurrentBranch=updateInstead`), not `git update-ref`.
- **No commits without explicit user approval** — AI edits → user reviews → user tests → user says "commit". Green tests do not substitute for the user's eyes on a visual change; if it's headless-unverifiable, say so.
- **One concern per commit**, message style per `git log` (`Feat(xxx):` / `Fix(ui):` / `Refactor(xxx):` / `Style:` / `Chore:`), AI adds itself as co-author.
- **On every commit, scan AGENTS.md (root + the sub-file you touched) for staleness** — conventions, renames, flipped rules, dead examples get fixed in the same commit. Doc drift is this file's main failure mode.

---

If [local-context.md](./local-context.md) exists in the workspace root, read it
too — it lists machine-local Knowledge Hub paths (not in git).
