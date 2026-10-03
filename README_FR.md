# 🧰 TrustMy.IP — une boîte à outils IP complète, utilisable sans aucune configuration

<div align="center">

![Étoiles GitHub](https://img.shields.io/github/stars/shijianus/TrustIP)
![Forks GitHub](https://img.shields.io/github/forks/shijianus/TrustIP)
![CI](https://github.com/shijianus/TrustIP/actions/workflows/ci.yml/badge.svg?branch=dev)
![Licence](https://img.shields.io/badge/Licence-MIT-blue)
![PWA](https://img.shields.io/badge/PWA-Pris%20en%20charge-blue)

[English](README.md) | [简体中文](README_ZH.md) | [繁體中文](README_ZH-TW.md) | [Русский](README_RU.md) | [Français](README_FR.md) | [Português (BR)](README_PT-BR.md)

Une boîte à outils IP libre et complète : consultation de votre IP par plusieurs sources indépendantes, tests de connectivité, détection WebRTC et de fuite DNS, test de débit, MTR, détection de censure, Whois et bien plus. Clonez, lancez `pnpm start`, et tout fonctionne — **sans `.env`, sans clé d'API, sans compte.**

</div>

## Ce que c'est, et d'où ça vient

**TrustMy.IP** est un dérivé de **[MyIP](https://github.com/jason5ng32/MyIP)**
(site de démonstration : [IPCheck.ing](https://ipcheck.ing), créé par **Jason Ng**),
maintenu par **EpoCanvas**. Le projet est sous licence MIT — voir
[LICENSE](LICENSE), qui reste `MIT © Jason Ng` et doit le rester : attribuer le
travail d'origine est une obligation de la licence, pas une courtoisie.

Ce que ce dérivé change :

- **Le déploiement sans configuration est le comportement par défaut.** Tous les
  identifiants sont réellement optionnels : sans aucune variable d'environnement, le
  backend démarre, toutes les sources qui ne demandent pas de clé fonctionnent, et les
  fonctionnalités dépendant d'un service tiers payant ou privé sont masquées, ou
  répondent poliment par une erreur — jamais par une exception due à une variable absente.
- **Notre propre identité d'exécution.** Le paquet s'appelle `trustip`, les appels
  sortants s'annoncent `TrustIP/v<version>/<site>`, et les badges pm2 / Docker / dépôt
  appartiennent à EpoCanvas, jamais à l'amont. Aucune image n'est publiée sous le nom
  Docker Hub du projet amont, et aucune n'en est téléchargée.
- **Aucun identifiant emprunté à l'amont.** Les fonctionnalités qui exigent des identifiants
  privés d'IPCheck.ing restent éteintes ici au lieu de tourner à moitié — voir la liste
  [Ce qui reste éteint](#ce-qui-reste-éteint). Une dépendance publique appartient encore à
  l'amont : les cartes IP de la page d'accueil déterminent *votre propre* adresse via des
  endpoints `trace`, et `4.ipcheck.ing` / `6.ipcheck.ing` / `64.ipcheck.ing` sont des
  hôtes qu'EpoCanvas n'héberge pas. Les cartes IPv4 et IPv6 se rabattent sur `ipify.org`,
  et les cartes Cloudflare et ipip.net ne touchent jamais l'amont ; seule la carte combinée
  IPv4+IPv6 n'a pas de repli et peut afficher une erreur si l'hôte amont est indisponible.
  Rediriger ces requêtes vers votre propre déploiement est une bonne première contribution.

## 👀 Fonctionnalités

### 🪪 Votre IP et votre identité

* 🛜 **Cartes IP** : détecte vos adresses IPv4 et IPv6 auprès de plusieurs sources indépendantes, côte à côte — pays, région, ville, ASN, organisation et le fuseau horaire local de l'IP.
* 🔍 **Consultation d'IP** : affiche les mêmes informations détaillées pour n'importe quelle adresse qui vous intrigue.
* 🧾 **Historique d'IP** : conserve un historique local des IP sous lesquelles vous avez été vu, filtrable par type et par pays — uniquement dans votre navigateur.
* 🖥️ **Empreinte du navigateur** : calcule votre empreinte de navigateur de plusieurs façons et montre ce qui vous rend identifiable.

### 🕵️ Fuites et vie privée

* 🚥 **Détection WebRTC** : révèle l'adresse IP exposée lors des connexions WebRTC — y compris si le durcissement vie privée de votre navigateur est actif.
* 🛑 **Test de fuite DNS** : indique quels serveurs DNS résolvent vos requêtes, pour évaluer le risque de fuite DNS derrière un VPN ou un proxy.
* 📋 **Liste de contrôle sécurité** : 258 points de cybersécurité personnelle répartis en 12 domaines, progression sauvegardée dans le navigateur.

### 📡 Tests réseau

* 🚦 **Test de connectivité** : mesure l'accessibilité de jusqu'à 60 sites au choix, avec la latence minimale sur plusieurs séries — plus des listes prêtes à importer, du pack national jusqu'aux IA, réseaux sociaux, streaming, jeux et développeurs. À partir des résultats, il indique si l'accès mondial à Internet vous est actuellement possible.
* 🚀 **Test de débit** : mesure vos débits descendant et montant ainsi que la latence vis-à-vis des réseaux en périphérie.
* ⏱️ **Test de latence mondial** : ping votre cible depuis des sondes réparties sur la planète — choisissez les pays parmi toutes les sondes Globalping disponibles, groupés par continent.
* 🚉 **Test MTR** : exécute MTR depuis des sondes mondialement réparties pour voir le chemin réellement emprunté par les paquets.
* 🚧 **Détection de censure** : montre où un site est bloqué dans le monde — et par quel moyen.
* 🚏 **Test de règles proxy** : vérifie que la configuration des règles de votre logiciel proxy fonctionne comme vous l'entendiez.

### 🔦 Consultation et infrastructure

* 📟 **Résolveur DNS** : résout un domaine via plusieurs résolveurs à la fois, groupés par pays — le moyen le plus simple de repérer un détournement (hijacking) ou une contamination.
* 📓 **Recherche Whois** : effectue des recherches Whois sur les noms de domaine et les adresses IP.
* 🗄️ **Consultation MAC** : identifie le fabricant et les détails derrière une adresse physique.
* 🧮 **Calculateur IP** : calcul de sous-réseaux, conversions de notation et détails d'interface IPv6 pour toute IP, préfixe, plage ou liste, entièrement en local.
* 🛰️ **Informations ASN et topologie amont** : affiche les détails d'un AS, l'historique des annonces d'un préfixe IP et les chemins amont reliant un AS au backbone Tier 1.
* 📶 **État des services** : disponibilité en direct de services connus — Claude, OpenAI, GitHub, Cloudflare et d'autres — depuis leurs pages d'état officielles, avec les incidents récents.

### ✨ Plateforme

* ⌨️ **API curl** : récupérez votre IP depuis un terminal en une seule commande `curl` — nécessite les noms d'hôte que vous servez vous-même.
* 🌗 **Mode sombre** : suit automatiquement le système, avec bascule manuelle.
* 📲 **PWA** : installable comme application sur mobile et comme application Chrome sur ordinateur.
* ⚡ **Raccourcis clavier** : chaque action a le sien — appuyez sur `?` pour afficher la liste.
* 🔤 **Multilingue** : l'interface est livrée en 6 langues, et ajouter la vôtre ne demande qu'un paquet de traductions.

## 🚀 Démarrage rapide

### Avec Docker

Aucune image n'est publiée : construisez-la depuis ce dépôt.

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
docker compose build
docker compose up -d
```

Puis ouvrez [http://localhost:18966](http://localhost:18966). Aucun `-e` et aucun
`--env-file` n'est nécessaire ; compose construit `epocanvas/trustip:local`.

### Avec Node

Node.js 24 ou plus récent, puis :

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
npm install -g pnpm   # le projet est exclusivement pnpm ; npm est fourni avec Node
pnpm install && pnpm run build
pnpm start
```

`pnpm start` sert le frontend compilé sur le port **18966** et l'API sur le port
**11966** (volontairement local uniquement — placez un proxy inverse devant 18966).

## ⚙️ Configuration

**Rien n'est obligatoire.** [.env.example](.env.example) documente chaque variable réellement
lue par le code, ce qu'elle active, et ce qui continue de fonctionner sans elle. Copiez-le en
`.env` et ne remplissez que ce dont vous avez besoin : un `.env` entièrement vide se comporte
exactement comme l'absence de `.env`.

Trois variables méritent d'être connues, sans jamais être obligatoires :

| Variable | Ce qui se passe si elle est vide |
|---|---|
| `ALLOWED_DOMAINS` | `localhost` continue de fonctionner. Dès que vous serviez un vrai nom d'hôte, chaque requête `/api/*` d'un visiteur reçoit **403** — la garde globale `requireReferer` n'accepte que localhost et cette liste. Dès que vous avez un domaine, configurez-la. |
| `MAXMIND_ACCOUNT_ID` + `MAXMIND_LICENSE_KEY` | `/api/maxmind` répond **503** `MaxMind database is not ready`. Les autres sources IP fonctionnent ; le journal de démarrage l'indique explicitement et le serveur part quand même. Les identifiants gratuits s'obtiennent chez maxmind.com, ou déposez vous-même les deux fichiers `.mmdb` dans `common/maxmind-db/`. |
| `VITE_SITE_URL` | La compilation supprime entièrement le bloc canonical / `og:url` / `og:image` de `index.html` plutôt que d'y écrire `undefined`, et l'User-Agent sortant devient `TrustIP/v<version>`. Rien ne casse — vous perdez seulement les URL absolues de ces balises. |

Jeux de données téléchargés pour vous par le backend, sans aucun identifiant à demander :

* **CAIDA** `as2org` + `as-rel2` — téléchargés au premier démarrage dans
  `common/as-org-db/` et `common/as-rel-db/` (environ **25 Mo décompressés**, une
  **vingtaine de secondes** sur une connexion correcte). C'est ce qui alimente les noms
  d'organisations des ASN et la topologie amont. La revérification quotidienne est opt-in
  via `CAIDA_AUTO_UPDATE`.
* **MaxMind GeoLite2** — l'exception : MaxMind exige une clé de licence (gratuite), donc
  sans clé l'API se dégrade en 503 plutôt que d'inventer une réponse.

### Ce qui reste éteint

Ces fonctionnalités reposent sur des services pour lesquels ce dérivé n'a pas
d'identifiants : elles sont donc masquées — et non cassées à moitié — dans une
installation par défaut. Chacune revient dès que vous renseignez la variable indiquée dans
[.env.example](.env.example) :

| Fonctionnalité | Nécessite |
|---|---|
| Source IP « IPCheck.ing » | `IPCHECKING_API_KEY` + `IPCHECKING_API_ENDPOINT` (l'API privée du projet amont) |
| Test d'invisibilité, test de fuite DNS avancé, analyse Persona, comptes utilisateur et succès | la même API privée, plus Firebase Auth et la clé du script de détection de proxy |
| Liens de rapport de diagnostic partageables | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_KV_NAMESPACE_ID` (votre propre espace Workers KV convient parfaitement) |
| Panneaux Cloudflare Radar, liens ASN « voir dans Radar », flux de pannes | `CLOUDFLARE_API_KEY` |
| Carte statique de la carte IP | `GOOGLE_MAP_API_KEY` |
| Sources api.ipapi.is et ip2location.io | leur clé respective (ces deux services l'exigent) |
| Earth Online (flux d'état, carte des visiteurs, balise de visite) | `VITE_PULSE_BEACON_URL` (un backend que ce dérivé ne fait pas tourner) |
| Assistant de documentation intégré et entrées du Centre d'aide | `VITE_DOCS_URL` (le site GitBook du projet amont) |
| Carte API curl | `VITE_CURL_IPV4_DOMAIN` / `IPV6` / `IPV64` — des noms d'hôte que vous servez vous-même |
| Google Analytics, supervision d'erreurs Sentry | volontairement opt-in ; absents, le SDK n'entre même pas dans le bundle |

## 📖 Documentation

Ce dérivé n'a pas de site de documentation propre. Ce qui fait autorité, dans ce dépôt :

* [.env.example](.env.example) — la référence d'environnement complète, incluant l'effet de
  chaque variable laissée vide
* [`AGENTS.md`](AGENTS.md), [`frontend/AGENTS.md`](frontend/AGENTS.md),
  [`api/AGENTS.md`](api/AGENTS.md) — architecture et conventions, écrites pour les humains
  comme pour les agents IA
* [CONTRIBUTING.md](CONTRIBUTING.md) · [TRANSLATING.md](TRANSLATING.md) ·
  [SUPPORT.md](SUPPORT.md) · [SECURITY.md](SECURITY.md)

La documentation du projet amont se trouve sur
**[docs.ipcheck.ing](https://docs.ipcheck.ing)** — elle est écrite pour MyIP / IPCheck.ing
et ses étapes de déploiement supposent des identifiants que ce dérivé ne possède pas. Utile pour l'architecture et le fonctionnement de chaque outil, pas pour reproduire une mise en
ligne hébergée.

## 🤝 Contribuer

Les contributions sont bienvenues, surtout celles qui améliorent le déploiement par défaut.

* 🏷️ [Premiers problèmes](https://github.com/shijianus/TrustIP/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — ajouter un résolveur DNS de votre pays, enrichir les listes de sites, traduire le README dans votre langue, peaufiner des traductions
* 🌐 [TRANSLATING.md](TRANSLATING.md) — amener l'interface dans votre langue : un paquet de traductions et une ligne dans le registre, et **une traduction partielle est déjà une première PR bienvenue**
* 📄 [CONTRIBUTING.md](CONTRIBUTING.md) — installation, conventions et circuit des PR (visez la branche `dev`)

Les correctifs amont continuent d'arriver : [`.github/workflows/sync.yml`](.github/workflows/sync.yml)
fusionne quotidiennement `jason5ng32/MyIP` dans notre branche `dev`. C'est précisément pour
cela que ce dérivé ne publie jamais rien au nom du projet amont — il le consomme, il ne
l'imite pas.

## 🙏 Crédits

TrustMy.IP existe parce que MyIP existe. Le projet d'origine, son site de démonstration et
son programme de parrainage appartiennent à Jason Ng et aux contributeurs de MyIP ; ce
dérivé n'affiche aucun bouton de parrainage et renvoie le soutien vers le dépôt amont
([github.com/jason5ng32/MyIP](https://github.com/jason5ng32/MyIP)).

## 📄 Licence

[MIT](LICENSE) © Jason Ng — TrustMy.IP est une œuvre dérivée de
[MyIP](https://github.com/jason5ng32/MyIP) par Jason Ng, distribuée sous la même licence MIT.
