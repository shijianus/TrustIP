# 🧰 TrustMy.IP — uma caixa de ferramentas de IP que funciona sem nenhuma configuração

<div align="center">

![Estrelas no GitHub](https://img.shields.io/github/stars/shijianus/TrustIP)
![Forks no GitHub](https://img.shields.io/github/forks/shijianus/TrustIP)
![CI](https://github.com/shijianus/TrustIP/actions/workflows/ci.yml/badge.svg?branch=dev)
![Licença](https://img.shields.io/badge/Licen%C3%A7a-MIT-blue)
![PWA](https://img.shields.io/badge/PWA-com%20suporte-blue)

[English](README.md) | [简体中文](README_ZH.md) | [繁體中文](README_ZH-TW.md) | [Русский](README_RU.md) | [Français](README_FR.md) | [Português (BR)](README_PT-BR.md)

Uma caixa de ferramentas de IP, livre e completa: consulta de IP por várias fontes, testes de conectividade, detecção de WebRTC e de vazamento de DNS, teste de velocidade, MTR, verificação de censura, Whois e muito mais. Clone, rode `pnpm start` e tudo funciona — **sem `.env`, sem chaves de API, sem conta.**

</div>

## O que é isto, e de onde vem

**TrustMy.IP** é um fork do **[MyIP](https://github.com/jason5ng32/MyIP)**
(site de demonstração: [IPCheck.ing](https://ipcheck.ing), criado por **Jason Ng**),
mantido pela **EpoCanvas**. O projeto é licenciado sob a MIT — veja o
[LICENSE](LICENSE), que continua sendo `MIT © Jason Ng` e precisa continuar assim:
atribuir o trabalho original é uma obrigação da licença, não uma cortesia.

O que este fork muda:

- **Rodar sem configuração é o padrão.** Todas as credenciais são realmente opcionais: sem
  nenhuma variável de ambiente o backend sobe, todas as fontes que não exigem chave
  funcionam, e os recursos que dependem de serviços de terceiros ou privados ficam ocultos
  ou respondem com uma recusa educada — nunca com uma exceção causada por uma variável
  ausente.
- **Identidade própria em tempo de execução.** O pacote se chama `trustip`, as chamadas de
  saída se apresentam como `TrustIP/v<versão>/<site>`, e os nomes no pm2 / Docker e os
  escudos do repositório são da EpoCanvas, nunca do projeto original. Nenhuma imagem é
  publicada em nome do upstream no Docker Hub, e nenhuma é puxada de lá.
- **Nenhuma credencial emprestada do upstream.** Os recursos que exigem as credenciais
  privadas do IPCheck.ing ficam deliberadamente desligados aqui, e não pela metade: veja a
  lista em [O que fica desligado](#o-que-fica-desligado). Uma dependência pública ainda é do
  upstream: os cartões de IP da página inicial descobrem *o seu próprio* endereço por endpoints
  `trace`, e `4.ipcheck.ing` / `6.ipcheck.ing` / `64.ipcheck.ing` são hosts que a
  EpoCanvas não mantém. Os cartões IPv4 e IPv6 caem para o `ipify.org`, e os cartões da
  Cloudflare e do ipip.net nunca tocam no upstream; só o cartão combinado IPv4+IPv6 não tem
  reserva, então pode mostrar um erro se o host do upstream estiver fora do ar. Redirecionar
  essas requisições para a sua própria implantação é uma boa primeira contribuição.

## 👀 Recursos

### 🪪 Seu IP e identidade

* 🛜 **Cartões de IP**: Detecta seus IPv4 e IPv6 a partir de várias fontes independentes, lado a lado — país, região, cidade, ASN, organização e o fuso horário local do IP.
* 🔍 **Verificação de IP**: Consulta as mesmas informações detalhadas de qualquer endereço IP que despertar sua curiosidade.
* 🧾 **Histórico de IP**: Mantém um registro local dos IPs com os quais você já foi visto, filtrável por tipo e país — armazenado apenas no seu navegador.
* 🖥️ **Impressão digital do navegador**: Calcula a impressão digital do seu navegador de várias formas e mostra o que torna você identificável.

### 🕵️ Vazamentos e privacidade

* 🚥 **Detecção de WebRTC**: Revela o endereço IP exposto durante conexões WebRTC — inclusive se as proteções de privacidade do seu navegador estão ativas.
* 🛑 **Teste de vazamento de DNS**: Mostra quais endpoints DNS resolvem suas consultas, para avaliar o risco de vazamentos de DNS ao usar VPNs ou proxies.
* 📋 **Checklist de segurança**: Um checklist pessoal de cibersegurança com 258 itens em 12 áreas, com progresso salvo no seu navegador.

### 📡 Testes de rede

* 🚦 **Conectividade de rede**: Testa a acessibilidade de até 60 sites da sua escolha, com resultados de latência mínima em múltiplas rodadas — além de listas de importação selecionadas, de pacotes por país a IA, redes sociais, streaming, jogos, desenvolvimento e mais. Com base nos resultados, indica se o acesso global à Internet está viável para você no momento.
* 🚀 **Teste de velocidade**: Mede seu download, upload e latência em redes de borda.
* ⏱️ **Teste de latência global**: Faz ping no seu alvo a partir de sondas espalhadas pelo mundo — escolha países entre todas as sondas Globalping disponíveis, agrupadas por continente.
* 🚉 **Teste MTR**: Executa MTR a partir de sondas distribuídas globalmente para ver a rota que os pacotes realmente percorrem.
* 🚧 **Verificação de censura**: Mostra onde um site está bloqueado no mundo — e por quais meios.
* 🚏 **Teste de regras de proxy**: Verifica se a configuração de regras do seu software de proxy funciona do jeito que você pretendia.

### 🔦 Consultas e infraestrutura

* 📟 **Resolução DNS**: Resolve um domínio por vários resolvedores de uma só vez, agrupados por país — um jeito fácil de detectar sequestro ou contaminação.
* 📓 **Pesquisa Whois**: Realiza consultas Whois para nomes de domínio e endereços IP.
* 🗄️ **Consulta de MAC**: Identifica o fabricante e os detalhes por trás de um endereço físico.
* 🧮 **Calculadora de IP**: Cálculo de sub-rede, conversões de notação e detalhes de interface IPv6 para qualquer IP, prefixo, intervalo ou lista, tudo localmente.
* 🛰️ **Informações de ASN e topologia de upstream**: Mostra detalhes do AS, anúncios históricos de um prefixo IP e os caminhos de upstream de um ASN até o backbone Tier 1.
* 📶 **Status dos serviços**: Disponibilidade em tempo real de serviços conhecidos — Claude, OpenAI, GitHub, Cloudflare e outros — a partir de suas páginas oficiais de status, com incidentes recentes.

### ✨ Plataforma

* ⌨️ **API de linha de comando**: Obtenha seu IP no terminal com um único comando `curl` — para isso você precisa dos domínios que você mesmo serve.
* 🌗 **Modo escuro**: Acompanha automaticamente o sistema, com alternância manual.
* 📲 **PWA**: Instalável como aplicativo no celular e como app do Chrome no computador.
* ⚡ **Atalhos de teclado**: Toda função tem o seu — pressione `?` para ver a lista.
* 🔤 **Vários idiomas**: A interface é distribuída em 6 idiomas, e adicionar o seu exige apenas um pacote de locale.

## 🚀 Começo rápido

### Com Docker

Nenhuma imagem está publicada — construa a sua a partir deste repositório:

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
docker compose build
docker compose up -d
```

Depois abra [http://localhost:18966](http://localhost:18966). Não é preciso nenhum `-e` nem
`--env-file`; o compose constrói `epocanvas/trustip:local`.

### Com Node

Node.js 24 ou mais novo, e então:

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
npm install -g pnpm   # o projeto usa exclusivamente pnpm; o npm vem junto com o Node
pnpm install && pnpm run build
pnpm start
```

O `pnpm start` serve o front-end compilado na porta **18966** e a API na porta **11966**
(deliberadamente local — coloque um proxy reverso na frente da 18966).

## ⚙️ Configuração

**Nada é obrigatório.** O [.env.example](.env.example) documenta cada variável que o código
realmente lê, o que ela liga e o que continua funcionando sem ela. Copie-o para `.env` e
preencha só o que você quiser; um `.env` totalmente vazio se comporta exatamente como a
ausência de `.env`.

Vale conhecer três ajustes, nenhum deles obrigatório:

| Variável | O que acontece se ficar vazia |
|---|---|
| `ALLOWED_DOMAINS` | `localhost` continua funcionando. Mas, ao servir num domínio real, toda chamada `/api/*` de visitante recebe **403** — a verificação global `requireReferer` só aceita localhost mais esta lista. Assim que tiver um domínio, configure-a. |
| `MAXMIND_ACCOUNT_ID` + `MAXMIND_LICENSE_KEY` | `/api/maxmind` responde **503** `MaxMind database is not ready`. As outras fontes de IP seguem funcionando; o log de partida diz isso com todas as letras e o servidor sobe mesmo assim. As credenciais gratuitas são emitidas pelo maxmind.com, ou coloque você mesmo os dois arquivos `.mmdb` em `common/maxmind-db/`. |
| `VITE_SITE_URL` | A build remove por completo o bloco canonical / `og:url` / `og:image` do `index.html`, em vez de escrever `undefined` ali, e o User-Agent de saída passa a ser `TrustIP/v<versão>`. Nada quebra — você apenas deixa de ter as URLs absolutas nessas tags. |

Conjuntos de dados que o backend baixa sozinho, sem pedir credencial a ninguém:

* **CAIDA** `as2org` + `as-rel2` — baixados na primeira partida para `common/as-org-db/` e
  `common/as-rel-db/` (cerca de **25 MB descompactados**, em torno de **20 segundos** numa
  conexão normal). São eles que alimentam os nomes de organização dos ASN e a topologia de
  upstream. A reverificação diária é opt-in, via `CAIDA_AUTO_UPDATE`.
* **MaxMind GeoLite2** — a exceção: o MaxMind exige uma chave de licença (gratuita), então,
  sem ela, a API degrada para 503 em vez de chutar uma resposta.

### O que fica desligado

Estes recursos dependem de serviços para os quais este fork não tem credenciais, então numa
instalação padrão eles ficam ocultos — não meio funcionando. Cada um volta assim que você
preencher a variável indicada no [.env.example](.env.example):

| Recurso | Exige |
|---|---|
| Fonte de IP “IPCheck.ing” | `IPCHECKING_API_KEY` + `IPCHECKING_API_ENDPOINT` (a API privada do projeto original) |
| Teste de invisibilidade, teste avançado de vazamento de DNS, análise Persona, contas de usuário e conquistas | a mesma API privada, mais Firebase Auth e a chave do script de detecção de proxy |
| Links compartilháveis de relatório diagnóstico | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_KV_NAMESPACE_ID` (um namespace Workers KV seu funciona perfeitamente) |
| Painéis do Cloudflare Radar, links de ASN “ver no Radar”, feed de quedas | `CLOUDFLARE_API_KEY` |
| Mapa estático do cartão de IP | `GOOGLE_MAP_API_KEY` |
| Cartões das fontes api.ipapi.is e ip2location.io | suas respectivas chaves (os dois serviços exigem chave) |
| Earth Online (feed de status, mapa de visitantes, farol de visitas) | `VITE_PULSE_BEACON_URL` (um backend que este fork não executa) |
| Assistente de documentação embutido e entradas da Central de Ajuda | `VITE_DOCS_URL` (o site GitBook do projeto original) |
| Cartão da API de linha de comando | `VITE_CURL_IPV4_DOMAIN` / `IPV6` / `IPV64` — nomes de domínio que você mesmo serve |
| Google Analytics e monitoramento de erros Sentry | opt-in por decisão de projeto; sem eles o SDK nem entra no bundle |

## 📖 Documentação

Este fork não mantém um site de documentação. O que faz fé está aqui, no repositório:

* [.env.example](.env.example) — a referência completa de variáveis de ambiente, incluindo o
  que deixa de funcionar quando cada uma fica vazia
* [`AGENTS.md`](AGENTS.md), [`frontend/AGENTS.md`](frontend/AGENTS.md) e
  [`api/AGENTS.md`](api/AGENTS.md) — arquitetura e convenções, escritas para pessoas e para
  agentes de IA
* [CONTRIBUTING.md](CONTRIBUTING.md) · [TRANSLATING.md](TRANSLATING.md) ·
  [SUPPORT.md](SUPPORT.md) · [SECURITY.md](SECURITY.md)

A documentação do projeto original está em
**[docs.ipcheck.ing](https://docs.ipcheck.ing)** — foi escrita para o MyIP / IPCheck.ing, e
os passos de implantação dela pressupõem credenciais que este fork não tem. Útil para entender
a arquitetura e cada ferramenta, não para reproduzir uma instalação hospedada.

## 🤝 Contribuindo

Contribuições são bem-vindas, principalmente as que melhoram o cenário “implantar sem
configurar nada”.

* 🏷️ [Primeiras issues](https://github.com/shijianus/TrustIP/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — adicionar um resolvedor DNS do seu país, ampliar as listas de sites, traduzir o README para o seu idioma, revisar traduções
* 🌐 [TRANSLATING.md](TRANSLATING.md) — levar a interface ao seu idioma: um pacote de locale e uma linha no registro, e **uma tradução parcial já é um bom primeiro PR**
* 📄 [CONTRIBUTING.md](CONTRIBUTING.md) — preparação do ambiente, convenções e o fluxo dos PRs (aponte para a branch `dev`)

As correções do upstream continuam chegando: [`.github/workflows/sync.yml`](.github/workflows/sync.yml)
mescla `jason5ng32/MyIP` na nossa `dev` todos os dias. É exatamente por isso que o fork nunca
publica artefatos em nome do upstream — ele consome o upstream, não finge ser ele.

## 🙏 Créditos

TrustMy.IP existe porque o MyIP existe. O projeto original, seu site de demonstração e seu
programa de patrocínio pertencem a Jason Ng e às pessoas que contribuem com o MyIP; este fork
não exibe botão de patrocínio e encaminha o apoio para o repositório original
([github.com/jason5ng32/MyIP](https://github.com/jason5ng32/MyIP)).

## 📄 Licença

[MIT](LICENSE) © Jason Ng — TrustMy.IP é trabalho derivado do
[MyIP](https://github.com/jason5ng32/MyIP) de Jason Ng, distribuído sob a mesma licença MIT.
