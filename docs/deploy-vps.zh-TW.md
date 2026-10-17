# TrustIP VPS 直接部署指南（不經 Cloudflare）

本文說明如何把 TrustIP 部署在一台自己的 Linux VPS 上，由 **Caddy（自動 TLS）** 或 **Nginx + certbot** 直接面對網際網路，不需要 Cloudflare。文末另有「之後再加 Cloudflare」的選用章節。

範例檔都在 `deploy/`：

| 檔案 | 用途 |
|---|---|
| `deploy/Caddyfile` | Caddy v2 反向代理（自動向 Let's Encrypt 取得憑證） |
| `deploy/nginx.conf` | Nginx 替代方案（憑證由 certbot 取得） |
| `deploy/trustip.service` | systemd 單元（裸機 / `npm start`） |
| `deploy/docker-compose.vps.yml` | Docker Compose 版本（`network_mode: host`） |

> 範例中的網域一律寫成 `trustip.example.com`，請全部換成你的實際網域。

---

## 1. 架構

```
訪客 ──HTTPS──▶ Caddy / Nginx (:443, :80)
                   ├─ /api/*  ──▶ backend-server.js   127.0.0.1:11966
                   └─ 其他    ──▶ frontend-server.js  127.0.0.1:18966（dist/ + CSP）
```

重點：**`/api/*` 由反向代理直接送到 backend**，不再經過 frontend-server.js 轉一手。原因：

- frontend-server.js 的 `/api` 代理會把 `X-Forwarded-For` **改寫成它自己看到的連線對端**。若 Caddy 先把請求交給 frontend-server，對端永遠是 `127.0.0.1`，所有訪客會落在同一個限流 bucket。
- Caddy（未設定 `trusted_proxies` 時）與範例 Nginx（`proxy_set_header X-Forwarded-For $remote_addr`）都會把該標頭**設定為訪客的真實位址**、忽略訪客自帶的值；backend 預設 `TRUST_PROXY=loopback` 只相信本機這一跳，因此能正確解析出訪客 IP。
- 頁面（`/`、`/ip/...` 等）仍由 frontend-server.js 提供，Content-Security-Policy 照常送出。

backend 與 frontend 只監聽本機（backend 預設 `127.0.0.1`；frontend-server.js 監聽所有介面，**必須靠防火牆擋掉 18966**，見第 5 節）。

---

## 2. 前置需求

- Linux VPS（Debian 12+/Ubuntu 22.04+ 為例），有 sudo 權限
- 網域的 A / AAAA 記錄已指向 VPS 的公網 IP（Caddy / certbot 簽發憑證前必須生效）
- 裸機部署：Node.js `^24.15.0`（或 ≥ 26）、`corepack enable` 後的 pnpm
- Docker 部署：Docker Engine + Compose v2

---

## 3. 取得程式並建置（裸機）

```bash
sudo corepack enable                    # 系統層級啟用 corepack，pnpm 版本依 package.json 的 packageManager
sudo useradd --system --create-home --home-dir /opt/trustip --shell /usr/sbin/nologin trustip
sudo -u trustip git clone https://github.com/shijianus/TrustIP.git /opt/trustip
cd /opt/trustip
sudo -u trustip pnpm install --frozen-lockfile
sudo -u trustip cp .env.example .env    # 依第 6 節修改
sudo -u trustip pnpm run build          # VITE_* 變數在建置時寫入，改了要重建
```

> 只想要正式環境依賴時，可在建置後執行 `pnpm install --frozen-lockfile --prod` 移除 devDependencies。

---

## 4. 啟動方式（三選一）

### 4a. systemd（建議）

```bash
sudo cp deploy/trustip.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now trustip
journalctl -u trustip -f
```

單元以 `trustip` 使用者執行 `npm start`（同時啟動 frontend 與帶 `--import ./sentry-instrument.js` 的 backend），並以 `ProtectSystem=strict` 等選項加固，只允許寫入 `/opt/trustip/common`（離線資料集下載目錄）與私有 `/tmp`。若 `npm` 不在 `/usr/bin/npm`，請修改 `ExecStart`。

### 4b. pm2

```bash
sudo -u trustip pnpm dlx pm2 start ecosystem.config.cjs
sudo -u trustip pnpm dlx pm2 save
```

`ecosystem.config.cjs` 已帶好 backend 需要的 `--import` 旗標。開機自動啟動請依 `pm2 startup` 的提示設定。

### 4c. Docker Compose

```bash
cp .env.example .env    # 依第 6 節修改；此檔必須存在
docker compose -f deploy/docker-compose.vps.yml up -d --build
docker inspect --format '{{.State.Health.Status}}' trustip   # healthy 為正常
```

- 映像以非 root 的 `node` 使用者執行，只含正式環境依賴；`HEALTHCHECK` 以 Node 腳本（`docker/healthcheck.js`）同時探測 `/` 與 `/api/configs`，不依賴 curl。
- 使用 `network_mode: host`：容器內的 127.0.0.1 就是主機的 127.0.0.1，主機上的 Caddy / Nginx 可直接連到 11966 / 18966，`TRUST_PROXY`、`BACKEND_HOST` 保持空白即可。沒有發佈任何埠，**防火牆照樣要擋 18966 / 11966**。
- 資料集放在 named volume，重建映像不必重新下載。

> 注意：若改用預設 bridge 網路並以 `ports:` 發佈埠，Docker 會繞過 ufw 規則，而且 backend 只看得到 Docker 閘道位址。除非你清楚要怎麼調整 `BACKEND_HOST` / `TRUST_PROXY`，請維持 host 網路模式。

---

## 5. 反向代理與 TLS

### 5a. Caddy（自動 TLS，建議）

```bash
sudo apt install -y caddy          # 或依 caddyserver.com 的官方套件庫安裝
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/trustip.example.com/你的網域/g' /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

範例已包含：HSTS（`max-age=1 年`，不含 `preload`）、移除 `Server` 標頭、請求主體上限 2 MB（高於應用本身的 500 KB JSON 與 1 MB Sentry tunnel 上限）、zstd/gzip 壓縮、www → 主網域轉址、存取記錄輪替。

### 5b. Nginx + certbot

```bash
sudo apt install -y nginx certbot
sudo mkdir -p /var/www/certbot
# 先只啟用 80 埠的 server 區塊（或暫時註解 443 區塊）以通過 http-01 驗證：
sudo certbot certonly --webroot -w /var/www/certbot -d 你的網域
sudo cp deploy/nginx.conf /etc/nginx/conf.d/trustip.conf
sudo sed -i 's/trustip.example.com/你的網域/g' /etc/nginx/conf.d/trustip.conf
sudo nginx -t && sudo systemctl reload nginx
```

`/api/` 使用 `proxy_set_header X-Forwarded-For $remote_addr;`（**覆寫**，不要改成 `$proxy_add_x_forwarded_for`，否則訪客可以自己指定位址）。certbot 套件會自動安裝續期 timer，可用 `sudo certbot renew --dry-run` 確認。

### 5c. 防火牆：只開 80 / 443 / SSH

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH          # 若 SSH 不是 22 埠，改成 sudo ufw allow <埠>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

18966（frontend）、11966（backend）**不得**對外開放。可在另一台機器用 `curl -m 5 http://<VPS IP>:18966/` 確認連不上。

---

## 6. 環境變數建議值（`.env`）

| 變數 | 建議值 | 說明 |
|---|---|---|
| `ALLOWED_DOMAINS` | `你的網域`（有 www 就 `example.com,www.example.com`） | `/api/*` 的 Referer 白名單；不設的話正式網域上所有 API 都會 403 |
| `TRUST_PROXY` | 空白（= `loopback`） | 反向代理在本機，只相信本機那一跳寫的 `X-Forwarded-For` |
| `TRUST_CF_CONNECTING_IP` | 空白 | 沒有 Cloudflare 時**一定**保持空白，否則訪客可自行偽造 `CF-Connecting-IP` |
| `BACKEND_HOST` | 空白（= `127.0.0.1`） | backend 只聽本機 |
| `BACKEND_PORT` / `FRONTEND_PORT` | 空白（11966 / 18966） | 改了的話，Caddyfile / nginx.conf 要一起改 |
| `CSP_ENFORCE` | **第一週空白**，之後設 `1` | 空白 = `Content-Security-Policy-Report-Only`，只回報不阻擋；觀察瀏覽器 console（或 `CSP_REPORT_URI`）一週沒有誤擋後，設 `CSP_ENFORCE=1` 並重啟 |
| `CSP_REPORT_URI` | 選填 | 違規報告收集端點 |
| `SECURITY_RATE_LIMIT` | 例如 `300` | 每 IP 每 20 分鐘請求上限（0/空白 = 關閉）；對外服務建議開啟 |
| `SECURITY_DELAY_AFTER` | 例如 `600` | 每小時超過此數後逐步延遲回應 |
| `DATASET_MAX_DOWNLOAD_MB` | 空白（= 500） | 單一資料集下載上限，超過即中止並刪除暫存檔 |
| `VITE_SITE_URL` | `https://你的網域` | 建置時使用（canonical / og 網址、對外 User-Agent），改了要重建 |

修改 `.env` 後：裸機 `sudo systemctl restart trustip`；Docker `docker compose -f deploy/docker-compose.vps.yml up -d`。`VITE_*` 開頭的變數需要重新建置。

---

## 7. 上線後檢查

```bash
# 首頁與 API（Referer 必須是 ALLOWED_DOMAINS 內的網域）
curl -sI https://你的網域/ | head -5
curl -s -H 'Referer: https://你的網域/' https://你的網域/api/configs
# 安全標頭
curl -sI https://你的網域/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type'
# 不支援的方法應回 405 + Allow
curl -s -o /dev/null -w '%{http_code}\n' -X TRACE https://你的網域/
```

- 第一次啟動會在背景下載離線資料集（CAIDA、IEEE OUI 等；MaxMind 需要金鑰），下載完成前相關 API 會回 503，屬正常現象。
- 記錄：systemd 用 `journalctl -u trustip`；Docker 用 `docker logs trustip`；反向代理記錄在 `/var/log/caddy/` 或 `/var/log/nginx/`。

---

## 8. 選用：之後再加上 Cloudflare

若日後要把網站放到 Cloudflare 代理（橘色雲朵）後面：

1. **`.env` 設定 `TRUST_CF_CONNECTING_IP=1`** 並重啟。此時 backend 以 Cloudflare 寫入的 `CF-Connecting-IP` 作為訪客位址（限流、記錄、Sentry tunnel 的 `user.ip_address`）。
2. **防火牆只允許 Cloudflare 的 IP 範圍連 80 / 443**，否則任何人都能直連源站並偽造 `CF-Connecting-IP`：

   ```bash
   sudo ufw delete allow 80/tcp
   sudo ufw delete allow 443/tcp
   for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
       sudo ufw allow from "$ip" to any port 80,443 proto tcp
   done
   sudo ufw reload
   ```

   Cloudflare 的範圍偶爾會更新，請定期（例如每月）重新執行。
3. **Cloudflare 安全等級設為「低」（Security Level: Low）**，並避免開啟會攔截 API 的挑戰頁（Under Attack、Bot Fight Mode）：本站的 `/api/*` 由瀏覽器背景呼叫，挑戰頁會讓它們失敗。
4. SSL/TLS 模式選 **Full (strict)**。源站既有的 Let's Encrypt 憑證可繼續使用（Caddy 的 http-01 續期經由 Cloudflare 代理仍可運作；或改用 Cloudflare Origin Certificate）。
5. `TRUST_PROXY` 維持空白：Cloudflare → Caddy/Nginx → backend 的鏈路中，backend 仍只相信本機那一跳，真實訪客位址改由 `CF-Connecting-IP` 提供。

不使用 Cloudflare 時，請確認 `TRUST_CF_CONNECTING_IP` 是空白的。

---

## 9. 已知限制

- 本 repo 的 CI / 本文作者環境中**沒有實際執行過 `docker build`**；Dockerfile 以 hadolint 檢查並在本機模擬執行階段（正式依賴安裝 + 啟動 + healthcheck）。第一次在真實主機建置時請留意輸出。
- `deploy/Caddyfile` 已通過 `caddy validate`；`deploy/nginx.conf` 已通過 `nginx -t`（測試時以自簽憑證與高位埠替換路徑）。實際憑證簽發需要真實網域，無法在本機驗證。
