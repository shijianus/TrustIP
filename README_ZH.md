# 🧰 TrustMy.IP —— 开箱即用、无需任何配置的 IP 工具箱

<div align="center">

![GitHub 星标](https://img.shields.io/github/stars/shijianus/TrustIP)
![GitHub 分支](https://img.shields.io/github/forks/shijianus/TrustIP)
![CI](https://github.com/shijianus/TrustIP/actions/workflows/ci.yml/badge.svg?branch=dev)
![许可证](https://img.shields.io/badge/License-MIT-blue)
![PWA](https://img.shields.io/badge/PWA-Supported-blue)

[English](README.md) | [简体中文](README_ZH.md) | [繁體中文](README_ZH-TW.md) | [Русский](README_RU.md) | [Français](README_FR.md) | [Português (BR)](README_PT-BR.md)

一个开源的一站式 IP 工具箱：多来源 IP 查询、连通性测试、WebRTC 与 DNS 泄露检测、网速测试、MTR、封锁检测、Whois 等等。克隆下来直接 `pnpm start` 就能用 —— **不需要 `.env`，不需要 API Key，不需要账号。**

</div>

## 这是什么，以及它从哪儿来

**TrustMy.IP** 是 **EpoCanvas** 对 **[MyIP](https://github.com/jason5ng32/MyIP)**
（在线演示：[IPCheck.ing](https://ipcheck.ing)）的分支版本，原作者是 **Jason Ng**。
项目采用 MIT 许可证 —— 见 [LICENSE](LICENSE)，其中仍是 `MIT © Jason Ng`，也必须
保持如此：对原始作品的署名是许可证规定的义务，不是客套。

这个分支改了什么：

- **零配置就是默认部署形态。** 所有凭据真的都是可选的：未配置任何环境变量时，后端照常
  启动，所有无需密钥的数据源照常工作，而那些依赖第三方密钥的功能会被隐藏或礼貌地拒绝服务，
  不会因为某个变量没设置就抛异常。
- **自己的运行时身份。** 包名是 `trustip`，对外调用 API 时标识为
  `TrustIP/v<版本>/<站点>`，pm2 / Docker / 仓库徽章都属于 EpoCanvas，而不是上游。
  我们不会以上游 Docker Hub 的名字发布镜像，也从那里拉取镜像。
- **不借用上游的凭据。** 依赖 IPCheck.ing 私有凭据的功能在这里是明确关闭，而不是半残运行，
  清单见[哪些功能是关闭的](#哪些功能是关闭的)。仍有一处公开的依赖属于上游：首页 IP 卡片是用
  trace 端点来解析*你自己的*地址的，而 `4.ipcheck.ing` / `6.ipcheck.ing` / `64.ipcheck.ing`
  这些主机不由 EpoCanvas 运行。IPv4 与 IPv6 卡片会退回到 `ipify.org`，Cloudflare 与 ipip.net
  卡片则完全不碰上游；只有 IPv4+IPv6 合并卡片没有备选，上游主机不可用时它会报错。把这些请求
  改指向你自己的部署，是一个很好的入门贡献。

## 👀 功能

### 🪪 你的 IP 与身份

* 🛜 **IP 卡片**：并排使用多个独立来源检测你的 IPv4 与 IPv6 —— 国家、行政区、城市、ASN、组织，以及该 IP 所在地的时区。
* 🔍 **查询 IP**：为你感兴趣的任意 IP 地址查询同样的详细信息。
* 🧾 **IP 历史**：在本地记录你被观察到的 IP，可按类型和国家筛选 —— 只保存在你的浏览器里。
* 🖥️ **浏览器指纹**：用多种方式计算你的浏览器指纹，并说明是什么让你可被识别。

### 🕵️ 泄露与隐私

* 🚥 **WebRTC 检测**：揭示 WebRTC 连接过程中暴露的 IP 地址 —— 同时判断你的浏览器是否开启了隐私强化。
* 🛑 **DNS 泄露检测**：显示是哪些 DNS 服务器在解析你的查询，用于评估使用 VPN 或代理时的 DNS 泄露风险。
* 📋 **安全检查清单**：覆盖 12 个领域、共 258 项的个人网络安全清单，进度保存在浏览器中。

### 📡 网络测试

* 🚦 **连通性检测**：测试最多 60 个站点的可达性，给出多轮最低延迟结果 —— 并提供精选导入列表，从国家包到 AI、社交、流媒体、游戏、开发者等。依据结果判断你当前能否访问全球互联网。
* 🚀 **网速测试**：对着边缘网络测量你的下载、上传与延迟。
* ⏱️ **全球延迟测试**：由分布在世界各地的探测节点 Ping 你的目标 —— 可从全部在线的 Globalping 节点中按大洲分组选择国家。
* 🚉 **MTR 测试**：从全球分布的探测节点运行 MTR，看清数据包实际走过的路径。
* 🚧 **封锁检测**：显示某个网站在世界各地是否被封锁，以及用什么手段。
* 🚏 **代理规则测试**：验证你的代理软件的规则配置是否按你的预期生效。

### 🔦 查询与基础设施

* 📟 **DNS 解析器**：同时通过多个解析器解析一个域名，并按国家分组 —— 很容易发现劫持或污染。
* 📓 **Whois 查询**：对域名和 IP 地址执行 Whois 查询。
* 🗄️ **MAC 查询**：识别物理地址背后的厂商与信息。
* 🧮 **IP 计算器**：对任意 IP、前缀、地址段或列表做子网计算、记法转换和 IPv6 接口细节，全部在本地完成。
* 🛰️ **ASN 信息与上游拓扑**：显示 AS 详情、某个 IP 前缀的历史宣告，以及从某个 ASN 到 Tier 1 骨干的上游路径。
* 📶 **服务状态**：来自官方状态页的知名服务可用性 —— Claude、OpenAI、GitHub、Cloudflare 等 —— 并附带最近的事件。

### ✨ 平台能力

* ⌨️ **Curl API**：用一条 `curl` 命令在终端里获取你的 IP —— 需要你提供对外服务的域名。
* 🌗 **深色模式**：自动跟随系统，也可手动切换。
* 📲 **PWA**：可以像应用一样安装到手机，也能作为 Chrome 应用安装到桌面。
* ⚡ **键盘快捷键**：每个功能都有 —— 按 `?` 查看清单。
* 🔤 **多语言**：界面内置 6 种语言，加上你的语言只需要一个语言包。

## 🚀 快速开始

### 使用 Docker

镜像没有发布在任何仓库 —— 请从本仓库自行构建：

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
docker compose build
docker compose up -d
```

然后访问 [http://localhost:18966](http://localhost:18966)。不需要任何 `-e` 参数，也不需要
`--env-file`；compose 会构建出 `epocanvas/trustip:local`。

### 使用 Node

需要 Node.js 24 或更新版本，然后：

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
npm install -g pnpm   # 本项目只用 pnpm；npm 随 Node 一起提供
pnpm install && pnpm run build
pnpm start
```

`pnpm start` 会在 **18966** 端口提供构建好的前端，在 **11966** 端口提供 API
（按设计只监听本机 —— 请在 18966 前面放一个反向代理）。

## ⚙️ 配置

**没有任何必填项。** [.env.example](.env.example) 记录了代码实际读取的每一个变量、它能打开
什么功能，以及留空时哪些东西照常工作。把它复制成 `.env`，只填写你需要的部分；一份全空的
`.env` 和没有 `.env` 表现完全一致。

有三个设置值得了解，但都不是必需的：

| 变量 | 留空时会怎样 |
|---|---|
| `ALLOWED_DOMAINS` | `localhost` 照常可用。但一旦绑定真实域名，所有访客的 `/api/*` 请求都会收到 **403** —— 全局的 `requireReferer` 守卫只放行 localhost 和这个白名单。有了域名就请设置它。 |
| `MAXMIND_ACCOUNT_ID` + `MAXMIND_LICENSE_KEY` | `/api/maxmind` 返回 **503** `MaxMind database is not ready`。其他 IP 来源不受影响；启动日志会明确说明，服务照常启动。MaxMind 的免费凭据在其官网申请，或者你自己把两个 `.mmdb` 文件放进 `common/maxmind-db/`。 |
| `VITE_SITE_URL` | 构建时会整段丢弃 `index.html` 中的 canonical / `og:url` / `og:image`，而不会写入 `undefined`；对外 User-Agent 变成 `TrustIP/v<版本>`。有了公开域名就填上。 |

后端会替你自动获取的数据集，无需申请任何凭据：

* **CAIDA** 的 `as2org` + `as-rel2` —— 首次启动时下载到 `common/as-org-db/` 与
  `common/as-rel-db/`（解压后约 **25 MB**，普通网络大约 **20 秒**），ASN 组织名称和上游
  拓扑图就来自它们。每日重新检查通过 `CAIDA_AUTO_UPDATE` 显式开启。
* **MaxMind GeoLite2** —— 唯一的例外：MaxMind 要求一个（免费的）许可密钥，因此没有密钥时
  该 API 退化为 503，而不是靠猜测作答。

### 哪些功能是关闭的

下面这些依赖本分支没有凭据的服务，因此在默认安装下是隐藏的 —— 而不是半残运行。只要在
[.env.example](.env.example) 里填上对应变量，它们就会回来：

| 功能 | 需要 |
|---|---|
| IPCheck.ing IP 来源 | `IPCHECKING_API_KEY` + `IPCHECKING_API_ENDPOINT`（上游项目的私有 API） |
| 隐身测试、增强版 DNS 泄露检测、人格画像、账号与成就系统 | 同一个私有 API，外加 Firebase Auth 和代理检测脚本密钥 |
| 可分享的诊断报告链接 | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_KV_NAMESPACE_ID`（用你自己的 Workers KV 命名空间完全没问题） |
| Cloudflare Radar 面板、ASN 的「在 Radar 中查看」链接、故障流 | `CLOUDFLARE_API_KEY` |
| IP 卡片上的静态地图 | `GOOGLE_MAP_API_KEY` |
| api.ipapi.is 与 ip2location.io 来源卡片 | 各自的密钥（两者都必须带密钥） |
| Earth Online（状态流、访客地图、访问信标） | `VITE_PULSE_BEACON_URL`（本分支不运行这个后端） |
| 应用内文档助手与帮助中心入口 | `VITE_DOCS_URL`（上游的 GitBook 站点） |
| Curl API 卡片 | `VITE_CURL_IPV4_DOMAIN` / `IPV6` / `IPV64` —— 由你自己对外提供服务的域名 |
| Google Analytics、Sentry 错误监控 | 有意设计为可选项；未设置时 SDK 根本不会进入构建产物 |

## 📖 文档

本分支没有独立的文档站。以下内容就是权威来源，都在本仓库里：

* [.env.example](.env.example) —— 完整的环境变量参考，包含每个变量留空时的影响
* [`AGENTS.md`](AGENTS.md)、[`frontend/AGENTS.md`](frontend/AGENTS.md)、
  [`api/AGENTS.md`](api/AGENTS.md) —— 架构与开发约定，同时面向人类和 AI 编码助手
* [CONTRIBUTING.md](CONTRIBUTING.md) · [TRANSLATING.md](TRANSLATING.md) ·
  [SUPPORT.md](SUPPORT.md) · [SECURITY.md](SECURITY.md)

上游项目的文档在 **[docs.ipcheck.ing](https://docs.ipcheck.ing)** —— 它是为
MyIP / IPCheck.ing 写的，其中的部署步骤假设了你拥有本分支并不具备的凭据。它适合用来了解架构
和各工具的背景知识，而不是照搬其线上部署方式。

## 🤝 参与贡献

欢迎参与贡献，尤其是能让「默认部署」更好的那些。

* 🏷️ [Good first issues](https://github.com/shijianus/TrustIP/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) —— 添加你所在国家的 DNS 解析服务、添加精选网站列表、把 README 翻译成你的语言、润色翻译等
* 🌐 [TRANSLATING.md](TRANSLATING.md) —— 把 UI 带到你的语言：一个语言包加上一行注册表，而且**部分翻译也是欢迎的首次 PR**
* 📄 [CONTRIBUTING.md](CONTRIBUTING.md) —— 环境搭建、开发约定与 PR 流程（请将 PR 提交到 `dev` 分支）

上游的修复会持续流进来：[`.github/workflows/sync.yml`](.github/workflows/sync.yml)
每天把 `jason5ng32/MyIP` 合并进我们的 `dev` 分支。也正是因此，本分支绝不会以上游的名义发布
任何产物 —— 我们消费上游，而不是冒充上游。

## 🙏 致谢

因为先有 MyIP，才会有 TrustMy.IP。原始项目、它的在线演示以及它的赞助计划都属于 Jason Ng
与 MyIP 的贡献者们；本分支不提供赞助按钮，如果你愿意支持这类工具，请前往上游仓库
（[github.com/jason5ng32/MyIP](https://github.com/jason5ng32/MyIP)）。

## 📄 开源协议

[MIT](LICENSE) © Jason Ng —— TrustMy.IP 是 Jason Ng 的
[MyIP](https://github.com/jason5ng32/MyIP) 的衍生作品，依据同样的 MIT 许可证分发。
