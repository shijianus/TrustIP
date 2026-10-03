# Security Policy

## Who maintains what

TrustMy.IP is a fork by **EpoCanvas** of **[MyIP](https://github.com/jason5ng32/MyIP)**
by Jason Ng, and most of this codebase is still upstream's. A finding in shared code
(`api/`, `common/`, `frontend/`) therefore very likely affects the upstream project as
well. Report it to us through the channel below — we will fix it here and, when the
problem is upstream's rather than ours, coordinate with the upstream maintainer.

## Supported versions

Only the latest release of this fork gets security fixes. The fork restarted its own
version line at `0.1.0` (see the `version` field in `package.json`), and upstream tags
are not patched by us — if you self-host, upgrade before reporting.

## Reporting a vulnerability

**Report privately, not through a public issue.** Use GitHub's private reporting form:

**[Report a vulnerability →](https://github.com/shijianus/TrustIP/security/advisories/new)**

It's visible only to the maintainer, and it's the right channel even if you're unsure
whether what you found is a real issue.

Helpful things to include:

- What an attacker can do with it, and what they'd need to start (a session? just a URL?).
- Steps to reproduce — a request, a payload, or a short script.
- Where the problem lives: front-end (`frontend/`), API handler (`api/`), shared
  code (`common/`), or a deployment file (`Dockerfile`, `backend-server.js`,
  `.github/workflows/`).
- Whether you hit it on your own deployment or on a hosted instance we point at, and the
  commit or version if self-hosted.

## What to expect

- An acknowledgement within a few days.
- A fix in the next release once it's confirmed, or an explanation if it turns out to be
  out of scope.
- Credit in the release notes and the advisory, unless you'd rather stay anonymous.

Please hold off on public disclosure until a fix ships.

## Out of scope

- **Findings against infrastructure we do not run.** This fork publishes no container
  image, no documentation site and no hosted API; a problem in
  [ipcheck.ing](https://ipcheck.ing), [docs.ipcheck.ing](https://docs.ipcheck.ing) or the
  upstream's Docker Hub repository belongs to the upstream project. Rate limits, TLS
  configuration, DNS and hosting of *our* deployment are still fair game — report them the
  same way, but they aren't code issues.
- **Third-party data providers.** The toolbox queries external IP-geolocation and network
  APIs (ipinfo.io, ip-api.com, ip.sb, RIPEstat, OONI, Globalping, Cloudflare Radar, …) and
  can proxy the upstream's private IPCheck.ing API; vulnerabilities in those services
  belong to them.
- **Automated scanner output** with no working proof of concept.
- **Missing optional hardening in a self-hosted instance.** Running with no environment
  variables is a supported configuration, so "you left `SECURITY_RATE_LIMIT` empty" is not
  a vulnerability. What *is* in scope: a default-configured deployment that throws,
  leaks a credential, serves a cross-origin `/api/*` response the referer guard should
  have blocked, or trusts client input where `common/guards.js` is supposed to validate
  it. Variables and their intent are documented in
  [.env.example](.env.example) and the guards in [`api/AGENTS.md`](api/AGENTS.md).
