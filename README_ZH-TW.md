# 🧰 TrustMy.IP —— 免設定、開箱即用的 IP 工具箱

<div align="center">

![GitHub 星星數](https://img.shields.io/github/stars/shijianus/TrustIP)
![GitHub 分支數](https://img.shields.io/github/forks/shijianus/TrustIP)
![CI](https://github.com/shijianus/TrustIP/actions/workflows/ci.yml/badge.svg?branch=dev)
![授權](https://img.shields.io/badge/License-MIT-blue)
![PWA](https://img.shields.io/badge/PWA-Supported-blue)

[English](README.md) | [简体中文](README_ZH.md) | [繁體中文](README_ZH-TW.md) | [Русский](README_RU.md) | [Français](README_FR.md) | [Português (BR)](README_PT-BR.md)

一個開源的一站式 IP 工具箱：多來源 IP 查詢、連線測試、WebRTC 與 DNS 外洩偵測、頻寬測試、MTR、封鎖檢查、Whois 等等。複製下來直接 `pnpm start` 就能運作 —— **不需要 `.env`、不需要 API 金鑰、不需要帳號。**

</div>

## 這是什麼，以及它的來源

**TrustMy.IP** 是 **EpoCanvas** 針對 **[MyIP](https://github.com/jason5ng32/MyIP)**
（線上展示站：[IPCheck.ing](https://ipcheck.ing)）所做的分支，原作者為 **Jason Ng**。
本專案採用 MIT 授權 —— 請見 [LICENSE](LICENSE)，其中仍寫著 `MIT © Jason Ng`，而且必須維持如此：
對原始作品的署名是授權條款規定的義務，不是禮貌性舉止。

這個分支改了什麼：

- **零設定就是預設的部署型態。** 所有憑證確實都是選用性的：完全沒有環境變數時，後端照常啟動，
  所有不需金鑰的資料來源照常可用，而需要第三方金鑰的功能會被隱藏，或禮貌地拒絕服務 ——
  不會因為某個變數沒設定就丟出例外。
- **自己的執行階段身分。** 套件名稱是 `trustip`，向外呼叫 API 時自稱
  `TrustIP/v<版本>/<站台>`，pm2 / Docker / 倉庫徽章都屬於 EpoCanvas，而不是上游。
  我們不會以上游 Docker Hub 的名義發布映像檔，也不會從那裡拉取。
- **不借用上游的憑證。** 需要 IPCheck.ing 私有憑證的功能在這裡是明確關閉，而不是半調子運作，
  清單見[哪些功能是關閉的](#哪些功能是關閉的)。仍有一處公開依賴屬於上游：首頁的 IP 卡片是靠
  trace 端點來解析*你自己的*位址，而 `4.ipcheck.ing` / `6.ipcheck.ing` / `64.ipcheck.ing`
  這些主機並非由 EpoCanvas 維運。IPv4 與 IPv6 卡片會退回 `ipify.org`，Cloudflare 與 ipip.net
  卡片則完全不取用上游；只有 IPv4+IPv6 合併卡片沒有備援，上游主機不可用時它會回報錯誤。把這些
  請求改指向你自己的部署，是一個很好的入門貢獻。

## 👀 功能

### 🪪 你的 IP 與身分

* 🛜 **IP 卡片**：並排使用多個獨立來源偵測你的 IPv4 與 IPv6 —— 國家、地區、城市、ASN、組織，以及該 IP 所在地的時區。
* 🔍 **查詢 IP**：為你好奇的任何 IP 位址查詢同樣的詳細資訊。
* 🧾 **IP 紀錄**：在本機記錄你曾被觀察到的 IP，可依類型與國家篩選 —— 只存放在你的瀏覽器裡。
* 🖥️ **瀏覽器指紋**：以多種方式計算你的瀏覽器指紋，並說明是什麼讓你可被辨識。

### 🕵️ 外洩與隱私

* 🚥 **WebRTC 偵測**：揭露 WebRTC 連線過程中暴露的 IP 位址 —— 同時判斷你的瀏覽器是否啟用了隱私強化。
* 🛑 **DNS 外洩測試**：顯示是哪些 DNS 伺服器在解析你的查詢，用以評估使用 VPN 或代理伺服器時的 DNS 外洩風險。
* 📋 **安全檢查清單**：涵蓋 12 個領域、共 258 項的個人網路安全清單，進度保存在瀏覽器中。

### 📡 網路測試

* 🚦 **連線檢查**：測試最多 60 個站點的可達性，提供多輪最低延遲結果 —— 另有精選匯入清單，從國家套裝到 AI、社群、串流、遊戲、開發者等。依據結果判斷你目前能否存取全球網路。
* 🚀 **頻寬測試**：針對邊緣網路量測你的下載、上傳與延遲。
* ⏱️ **全球延遲測試**：由散布世界各地的探測節點 ping 你的目標 —— 可從所有上線的 Globalping 節點中，按大洲分組選取國家。
* 🚉 **MTR 測試**：從全球分布的探測節點執行 MTR，看清資料封包實際走的路徑。
* 🚧 **封鎖檢查**：顯示某個網站在世界各地是否被封鎖，以及用什麼手段。
* 🚏 **代理規則測試**：驗證你的代理軟體規則設定是否如你所願生效。

### 🔦 查詢與基礎設施

* 📟 **DNS 解析器**：同時透過多個解析器解析一個網域名稱，依國家分組 —— 很容易發現劫持或污染。
* 📓 **Whois 查詢**：對網域名稱與 IP 位址執行 Whois 查詢。
* 🗄️ **MAC 查詢**：辨識實體位址背後的廠商與詳細資料。
* 🧮 **IP 計算機**：對任何 IP、前綴、位址範圍或清單做子網路計算、記法轉換與 IPv6 介面明細，全部在本機完成。
* 🛰️ **ASN 資訊與上游拓撲**：顯示 AS 詳細資料、某個 IP 前綴的歷史宣告，以及從某個 ASN 到 Tier 1 骨幹的上游路徑。
* 📶 **服務狀態**：來自官方狀態頁的知名服務可用性 —— Claude、OpenAI、GitHub、Cloudflare 等 —— 並附近期事件。

### ✨ 平台能力

* ⌨️ **Curl API**：在終端機用一行 `curl` 取得你的 IP —— 需要提供你自己對外服務的網域名稱。
* 🌗 **深色模式**：自動跟隨系統，也可手動切換。
* 📲 **PWA**：可以像應用程式一樣安裝到手機，也能作為 Chrome 應用程式安裝到桌面。
* ⚡ **鍵盤快速鍵**：每個功能都有一個 —— 按 `?` 檢視清單。
* 🔤 **多語言**：介面內建 6 種語言，要加上你的語言只需要一個語系檔。

## 🚀 快速開始

### 使用 Docker

映像檔沒有發布在任何倉庫 —— 請從本倉庫自行建置：

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
docker compose build
docker compose up -d
```

然後開啟 [http://localhost:18966](http://localhost:18966)。不需要任何 `-e` 參數，也不需要
`--env-file`；compose 會建置出 `epocanvas/trustip:local`。

### 使用 Node

需要 Node.js 24 或更新版本，然後：

```bash
git clone https://github.com/shijianus/TrustIP.git
cd TrustIP
npm install -g pnpm   # 本專案只用 pnpm；npm 隨 Node 一起提供
pnpm install && pnpm run build
pnpm start
```

`pnpm start` 會在 **18966** 連接埠提供建置好的前端，在 **11966** 連接埠提供 API
（設計上只監聽本機 —— 請在 18966 前面放一個反向代理）。

## ⚙️ 設定

**沒有任何必要項目。** [.env.example](.env.example) 記錄了程式碼實際讀取的每一個環境變數、
它能開啟什麼功能，以及留空時哪些東西照常運作。把它複製成 `.env`，只填你要的部分；一份全空的
`.env` 和完全沒有 `.env` 表現一致。

有三個設定值得知道，但都不是必要的：

| 變數 | 留空會怎樣 |
|---|---|
| `ALLOWED_DOMAINS` | `localhost` 照常可用。但一旦綁定真實網域名稱，所有訪客的 `/api/*` 請求都會收到 **403** —— 全域的 `requireReferer` 守衛只放行 localhost 與這份白名單。有了網域名稱就請設定它。 |
| `MAXMIND_ACCOUNT_ID` + `MAXMIND_LICENSE_KEY` | `/api/maxmind` 回覆 **503** `MaxMind database is not ready`。其他 IP 來源不受影響；啟動紀錄會明確說明，伺服器照常啟動。MaxMind 的免費憑證可在其官網申請，或者你自己把兩個 `.mmdb` 檔案放進 `common/maxmind-db/`。 |
| `VITE_SITE_URL` | 建置時會整段移除 `index.html` 裡的 canonical / `og:url` / `og:image`，而不會寫入 `undefined`；向外發出的 User-Agent 變成 `TrustIP/v<版本>`。有了公開網域名稱就填上。 |

後端會自動幫你抓取、不必申請任何憑證的資料集：

* **CAIDA** 的 `as2org` + `as-rel2` —— 首次啟動時下載到 `common/as-org-db/` 與
  `common/as-rel-db/`（解壓縮後約 **25 MB**，一般網路約 **20 秒**），ASN 組織名稱與上游
  拓撲圖就來自它們。每日重新檢查需用 `CAIDA_AUTO_UPDATE` 明確開啟。
* **MaxMind GeoLite2** —— 唯一的例外：MaxMind 要求一組（免費的）授權金鑰，所以沒有金鑰時
  該 API 退化為 503，而不是憑猜測回應。

### 哪些功能是關閉的

下列功能依賴本分支沒有憑證的服務，因此在預設安裝下是隱藏的 —— 而不是半調子運作。只要在
[.env.example](.env.example) 填上對應變數，它們就會回來：

| 功能 | 需要 |
|---|---|
| IPCheck.ing IP 來源 | `IPCHECKING_API_KEY` + `IPCHECKING_API_ENDPOINT`（上游專案的私有 API） |
| 隱身測試、進階 DNS 外洩測試、人格畫像、使用者帳號與成就系統 | 同一個私有 API，外加 Firebase Auth 與代理偵測腳本金鑰 |
| 可分享的診斷報告連結 | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_KV_NAMESPACE_ID`（使用你自己的 Workers KV 命名空間完全沒問題） |
| Cloudflare Radar 面板、ASN 的「在 Radar 中檢視」連結、中斷動態 | `CLOUDFLARE_API_KEY` |
| IP 卡片上的靜態地圖 | `GOOGLE_MAP_API_KEY` |
| api.ipapi.is 與 ip2location.io 來源卡片 | 各自的關鍵（兩者都必須帶著金鑰） |
| Earth Online（狀態動態、訪客地圖、到訪 beacon） | `VITE_PULSE_BEACON_URL`（本分支並未執行這個後端） |
| 應用程式內的文件助理與說明中心入口 | `VITE_DOCS_URL`（上游的 GitBook 站台） |
| Curl API 卡片 | `VITE_CURL_IPV4_DOMAIN` / `IPV6` / `IPV64` —— 由你自己對外服務的網域名稱 |
| Google Analytics、Sentry 錯誤監控 | 刻意設計為選用項目；未設定時 SDK 根本不會進入建置產物 |

## 📖 文件

本分支沒有獨立的文件站。以下內容就是權威來源，全部在本倉庫裡：

* [.env.example](.env.example) —— 完整的環境變數參考，包含每個變數留空時的影響
* [`AGENTS.md`](AGENTS.md)、[`frontend/AGENTS.md`](frontend/AGENTS.md)、
  [`api/AGENTS.md`](api/AGENTS.md) —— 架構與開發約定，同時寫給人與 AI 編碼助理看
* [CONTRIBUTING.md](CONTRIBUTING.md) · [TRANSLATING.md](TRANSLATING.md) ·
  [SUPPORT.md](SUPPORT.md) · [SECURITY.md](SECURITY.md)

上游專案的文件在 **[docs.ipcheck.ing](https://docs.ipcheck.ing)** —— 它是為
MyIP / IPCheck.ing 寫的，裡面的部署步驟假設了你擁有本分支不具備的憑證。它適合用來了解架構
與各工具的背景知識，而不是照搬其線上部署方式。

## 🤝 參與貢獻

歡迎參與貢獻，尤其是能讓「預設部署」更好的那些。

* 🏷️ [Good first issues](https://github.com/shijianus/TrustIP/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) —— 加上你所在國家的 DNS 解析服務、新增精選站點清單、把 README 翻譯成你的語言、潤飾翻譯等
* 🌐 [TRANSLATING.md](TRANSLATING.md) —— 把介面帶到你的語言：一個語系檔加上一行註冊表，而且**部分翻譯也是歡迎的首次 PR**
* 📄 [CONTRIBUTING.md](CONTRIBUTING.md) —— 環境安裝、開發約定與 PR 流程（請將 PR 提給 `dev` 分支）

上游的修正會持續流進來：[`.github/workflows/sync.yml`](.github/workflows/sync.yml)
每天把 `jason5ng32/MyIP` 合併進我們的 `dev` 分支。也正因如此，本分支絕不會以上游的名義發布
任何產物 —— 我們取用上游，而不是冒充上游。

## 🙏 致謝

因為先有 MyIP，才會有 TrustMy.IP。原始專案、它的線上展示站以及它的贊助計畫都屬於 Jason Ng
與 MyIP 的貢獻者；本分支不提供贊助按鈕，若你想支持這類工具，請前往上游倉庫
（[github.com/jason5ng32/MyIP](https://github.com/jason5ng32/MyIP)）。

## 📄 授權

[MIT](LICENSE) © Jason Ng —— TrustMy.IP 是 Jason Ng 的
[MyIP](https://github.com/jason5ng32/MyIP) 之衍生作品，依同樣的 MIT 授權條款分發。
