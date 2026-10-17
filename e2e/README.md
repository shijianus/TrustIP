# E2E 煙霧測試與安全探針

兩組在 CI 與本機都能離線、免金鑰執行的檢查：

| 指令 | 內容 | CI job |
|---|---|---|
| `pnpm run test:e2e` | Playwright（Chromium）跑建置後的前端：首頁本機 IP 卡、工具索引、WebRTC（本機 STUN）、DNS 洩漏測試紀錄、IP 檔案頁、404 行為 | `E2E (Playwright)` |
| `pnpm run test:security` | `scripts/security-probes.mjs`：對真正啟動的 backend / frontend / edge harness 發請求，驗證限流 429、Referer 規則、安全標頭、TRACE、地圖正規化、whois 404 + no-store 等 | `Security probes` |

## 本機執行

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium     # 第一次需要（CI 使用 --with-deps --only-shell）
pnpm run build                            # dist/
pnpm run build:stun                       # dist-stun/（vite --mode e2e，讀 .env.e2e 的 VITE_TEST_EXTRA_STUN）
pnpm run test:e2e
pnpm run test:security                    # 不需要建置也能跑；有 dist/ 時多驗證靜態頁的 CSP
```

在有 `HTTP(S)_PROXY` 的環境請加上 `NO_PROXY=127.0.0.1,localhost`，否則 Playwright 的 webServer 就緒檢查會走代理而逾時。

## 離線堆疊（`e2e/support/`）

- `offline-fetch.mjs`：以 `node --import` 預載進 backend 與 edge harness。非 loopback 的 `fetch()` 一律不出網：
  Google Static Maps、GitHub、IANA RDAP bootstrap、假的 RDAP 伺服器（一律 404）、假的 IPCheck.ing 端點回固定內容，其餘以 `TypeError: fetch failed` 模擬斷網。
  port 43 的 WHOIS 連線被導向行程內的假註冊局（一律回 `No match`）。每次對外請求寫入 `E2E_FETCH_LOG`（JSONL，查詢字串中的金鑰已遮蔽），探針據此計算「有多少訪客請求打到上游」與「帶了哪些標頭」。
- `stun-server.mjs`：RFC 5389 Binding 伺服器（node `dgram`），回覆請求實際來源位址。
- `stack.mjs` / `serve-stack.mjs`：以乾淨環境變數（無任何金鑰）啟動 backend，並用 `common/frontend-app.js` 的同一個 factory 提供 `dist/` 與 `dist-stun/`。

瀏覽器端：每個測試用 `context.route` 中止所有非 loopback 請求；首頁測試只把訪客 IP 端點（`/cdn-cgi/trace`、ipify、ipcheck.ing）回成固定的 `8.8.8.8`。
WebRTC 無法被 route 攔截，因此 WebRTC 測試以 init script 把頁面建立的 `RTCPeerConnection` 中的公開 STUN 伺服器移除，只留下 `127.0.0.1:43478`，判定不受 runner 是否能對外送 UDP 影響（預期 `no-leak`：唯一的反射位址是私有位址）。

## 連接埠（可用環境變數覆寫）

| 變數 | 預設 |
|---|---|
| `E2E_BACKEND_PORT` | 41966 |
| `E2E_FRONTEND_PORT` | 42966 |
| `E2E_FRONTEND_STUN_PORT` | 42967 |
| `E2E_EDGE_PORT` | 42787 |
| `E2E_STUN_PORT` | 43478（須與 `.env.e2e` 一致） |

## 產物

全部寫在 `e2e/.out/`（已 gitignore）：`test-results/`（每個測試的截圖與 trace.zip）、`report/`（HTML 報告）、`results.json`、`logs/`（backend 日誌、對外請求紀錄、STUN 請求紀錄）、`security-probes/`（探針結果 JSON 與日誌）。CI 以 artifact 上傳，取代手動打包的大型 zip。
