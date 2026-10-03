# 🧰 TrustMy.IP — a better IP toolbox that runs with zero configuration

<div align="center">

![GitHub Repo stars](https://img.shields.io/github/stars/shijianus/TrustIP)
![GitHub forks](https://img.shields.io/github/forks/shijianus/TrustIP)
![CI](https://github.com/shijianus/TrustIP/actions/workflows/ci.yml/badge.svg?branch=dev)
![License](https://img.shields.io/badge/License-MIT-blue)
![PWA](https://img.shields.io/badge/PWA-Supported-blue)

[English](README.md) | [简体中文](README_ZH.md) | [繁體中文](README_ZH-TW.md) | [Русский](README_RU.md) | [Français](README_FR.md) | [Português (BR)](README_PT-BR.md)

An open-source, all-in-one IP toolbox: IP lookup from multiple sources, connectivity
tests, WebRTC & DNS-leak detection, speed test, MTR, censorship checks, Whois, and
more. Clone it, `pnpm start`, and it works — **no `.env`, no API keys, no account.**

</div>

## What this is, and where it comes from

**TrustMy.IP** is a fork by **EpoCanvas** of **[MyIP](https://github.com/jason5ng32/MyIP)**
(demo site: [IPCheck.ing](https://ipcheck.ing)), the open-source IP toolbox written by
**Jason Ng**. It is licensed MIT — see [LICENSE](LICENSE), which is
`MIT © Jason Ng` and stays that way: attribution for the original work is a license
condition, not a courtesy.

What this fork changes:

- **Zero-configuration is the default deployment.** Every optional credential is
  optional in practice: an unconfigured install boots, serves every keyless data
  source, and hides or politely refuses the features whose upstream services need a
  key. Nothing throws because a variable is missing.
- **Our own runtime identity.** The package is `trustip`, outbound API calls
  identify as `TrustIP/v<version>/<site>`, and pm2 / Docker / repository badges are
  EpoCanvas's, never the upstream's. No image is published under the upstream's
  Docker Hub name and none is pulled from it.
- **No credentials borrowed from upstream.** Features that run on IPCheck.ing's private
  credentials stay switched off here rather than silently failing — listed in
  [What stays dark](#what-stays-dark). One public dependency is still the upstream's: the
  homepage IP cards resolve *your own* address through trace endpoints, and
  `4.ipcheck.ing` / `6.ipcheck.ing` / `64.ipcheck.ing` are hosts EpoCanvas does not run. The
  IPv4 and IPv6 cards fall back to `ipify.org`, and the Cloudflare and ipip.net cards never
  touch the upstream at all; only the combined IPv4+IPv6 card has no fallback, so it can
  report an error if the upstream's host is unavailable. Re-pointing those hops at your own
  deployment is a good first contribution.

## 👀 Features

### 🪪 Your IP & Identity

* 🛜 **IP Cards**: Detects your IPv4 and IPv6 from multiple independent sources side by side — country, region, city, ASN, organization, and the IP's local time zone.
* 🔍 **Query IP**: Looks up the same detailed information for any IP address you're curious about.
* 🧾 **IP History**: Keeps a local record of the IPs you've been seen with, filterable by type and country — stored in your browser only.
* 🖥️ **Browser Fingerprint**: Calculates your browser fingerprint in multiple ways and shows what makes you identifiable.

### 🕵️ Leaks & Privacy

* 🚥 **WebRTC Detection**: Reveals the IP address exposed during WebRTC connections — including whether your browser's privacy hardening is on.
* 🛑 **DNS Leak Test**: Shows which DNS endpoints resolve your queries, to evaluate the risk of DNS leaks when using VPNs or proxies.
* 📋 **Security Checklist**: A 258-item personal cybersecurity checklist across 12 areas, with progress saved in your browser.

### 📡 Network Tests

* 🚦 **Connectivity Check**: Tests the reachability of up to 60 sites of your choice, with multi-round minimum-latency results — plus curated import lists, from country packs to AI, social, streaming, gaming, developer, and more. Based on the results, it signals whether global internet access is currently feasible for you.
* 🚀 **Speed Test**: Measures your download, upload, and latency against edge networks.
* ⏱️ **Global Latency Test**: Pings your target from probes all over the world — pick countries from all available Globalping probes, grouped by continent.
* 🚉 **MTR Test**: Runs MTR from globally distributed probes to see the route packets actually take.
* 🚧 **Censorship Check**: Shows where a website is blocked worldwide — and by what means.
* 🚏 **Proxy Rule Test**: Verifies that your proxy software's rule configuration works the way you intended.

### 🔦 Lookup & Infrastructure

* 📟 **DNS Resolver**: Resolves a domain through multiple resolvers at once, grouped by country — an easy way to spot hijacking or contamination.
* 📓 **Whois Search**: Performs Whois lookups for domain names and IP addresses.
* 🗄️ **MAC Lookup**: Identifies the vendor and details behind a physical address.
* 🧮 **IP Calculator**: Subnet math, notation conversions and IPv6 interface details for any IP, prefix, range or list, computed locally.
* 🛰️ **ASN Info & Upstream Topology**: Shows AS details, historical announcements for an IP prefix, and the upstream paths from an ASN to the Tier 1 backbone.
* 📶 **Service Status**: Live availability of well-known services — Claude, OpenAI, GitHub, Cloudflare, and more — from their official status pages, with recent incidents.

### ✨ Platform

* ⌨️ **Curl API**: Get your IP from the terminal with a single `curl` command — needs the domains you serve it on.
* 🌗 **Dark Mode**: Follows your system automatically, with a manual toggle.
* 📲 **PWA**: Installable as an app on your phone and as a Chrome app on your desktop.
* ⚡ **Keyboard Shortcuts**: Every function has one — press `?` to see the list.
* 🔤 **Multiple Languages**: The UI ships in 6 languages, and adding yours takes one locale pack.

## 🚀 Quick start

### With Docker

The image is not published anywhere — build it from this repository:

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
docker compose build
docker compose up -d
```

Then open [http://localhost:18966](http://localhost:18966). No `-e` flags and no
`--env-file` are needed; compose builds `epocanvas/trustip:local`.

### With Node

Node.js 24 or newer, then:

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
npm install -g pnpm   # the project is pnpm-only; npm ships with Node
pnpm install && pnpm run build
pnpm start
```

`pnpm start` serves the built frontend on **18966** and the API on **11966**
(localhost-only by design — put a reverse proxy in front of 18966).

## ⚙️ Configuration

**Nothing is required.** [.env.example](.env.example) documents every variable the
code reads, what each one switches on, and what keeps working without it. Copy it to
`.env` and fill in only what you want; a blank `.env` behaves exactly like no `.env`.

Three settings are worth knowing about, none of them mandatory:

| Variable | If you leave it empty |
|---|---|
| `ALLOWED_DOMAINS` | `localhost` still works. On a real hostname, every visitor's `/api/*` call gets **403** — the global `requireReferer` guard allows localhost plus this list. Set it as soon as you have a domain. |
| `MAXMIND_ACCOUNT_ID` + `MAXMIND_LICENSE_KEY` | `/api/maxmind` answers **503** `MaxMind database is not ready`. The other IP sources keep working; the boot log says so and the server starts anyway. Free credentials at maxmind.com, or drop the two `.mmdb` files into `common/maxmind-db/` yourself. |
| `VITE_SITE_URL` | The build drops the canonical / `og:url` / `og:image` block from `index.html` rather than emitting `undefined`, and the outbound User-Agent becomes `TrustIP/v<version>`. Set it to your public origin once you have one. |

Datasets the backend fetches for you, with no credentials to obtain:

* **CAIDA** `as2org` + `as-rel2` — downloaded at first boot into `common/as-org-db/`
  and `common/as-rel-db/` (about **25 MB unpacked**, roughly **20 seconds** on a
  normal connection), which is what powers ASN organization names and the upstream
  topology graph. The daily re-check is opt-in via `CAIDA_AUTO_UPDATE`.
* **MaxMind GeoLite2** — the exception: MaxMind requires a (free) license key, so
  without one the API degrades to 503 instead of guessing.

### What stays dark

These ride on services the fork does not have credentials for, so they are hidden —
not half-working — on a default install. Each comes back by setting the variable
named in [.env.example](.env.example):

| Feature | Needs |
|---|---|
| IPCheck.ing IP source | `IPCHECKING_API_KEY` + `IPCHECKING_API_ENDPOINT` (the upstream project's private API) |
| Invisibility Test, Enhanced DNS Leak Test, Persona Check, user accounts & achievements | the same private API, plus Firebase Auth and the proxy-detection script key |
| Shareable report links | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_KV_NAMESPACE_ID` (your own Workers KV namespace works fine) |
| Cloudflare Radar panels, ASN "live in Radar" links, outage feed | `CLOUDFLARE_API_KEY` |
| Static map on the IP card | `GOOGLE_MAP_API_KEY` |
| api.ipapi.is and ip2location.io source cards | their respective keys (both are key-only services) |
| Earth Online (status feed, visitor map, visit beacon) | `VITE_PULSE_BEACON_URL` (a backend this fork does not run) |
| In-app docs assistant and Help Center links | `VITE_DOCS_URL` (the upstream's GitBook site) |
| Curl API card | `VITE_CURL_IPV4_DOMAIN` / `IPV6` / `IPV64` — hostnames you serve yourself |
| Google Analytics, Sentry error monitoring | opt-in by design; unset means the SDK is not even in the bundle |

## 📖 Documentation

This fork keeps no documentation site. What is authoritative, in this repository:

* [.env.example](.env.example) — the full environment reference, including what
  breaks when each variable is empty
* [`AGENTS.md`](AGENTS.md), [`frontend/AGENTS.md`](frontend/AGENTS.md),
  [`api/AGENTS.md`](api/AGENTS.md) — architecture and conventions, written for humans
  and AI agents alike
* [CONTRIBUTING.md](CONTRIBUTING.md) · [TRANSLATING.md](TRANSLATING.md) ·
  [SUPPORT.md](SUPPORT.md) · [SECURITY.md](SECURITY.md)

The upstream project's docs live at
**[docs.ipcheck.ing](https://docs.ipcheck.ing)** — written for MyIP / IPCheck.ing, so
their deployment steps assume credentials this fork does not have. Useful for
architecture and per-tool background, not for reproducing a hosted setup.

## 🤝 Contributing

Contributions are welcome, especially ones that make the default deployment better.

* 🏷️ [Good first issues](https://github.com/shijianus/TrustIP/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — add a DNS resolver from your country, curate site lists, translate the README, polish translations
* 🌐 [TRANSLATING.md](TRANSLATING.md) — bring the UI to your language: a locale pack plus one registry line, and a **partial translation is a welcome first PR**
* 📄 [CONTRIBUTING.md](CONTRIBUTING.md) — setup, conventions, and how PRs flow (target the `dev` branch)

Upstream fixes keep flowing in: [`.github/workflows/sync.yml`](.github/workflows/sync.yml)
merges `jason5ng32/MyIP` into our `dev` daily, which is why the fork never publishes
artifacts under the upstream's name — it consumes upstream, it does not impersonate it.

## 🙏 Credit

TrustMy.IP exists because MyIP does. The original project, its demo site and its
sponsor program belong to Jason Ng and the MyIP contributors; this fork carries no
sponsor button and directs support to the upstream repository instead
([github.com/jason5ng32/MyIP](https://github.com/jason5ng32/MyIP)).

## 📄 License

[MIT](LICENSE) © Jason Ng — TrustMy.IP is a derivative work of
[MyIP](https://github.com/jason5ng32/MyIP) by Jason Ng, distributed under the same
MIT license.
