# 場地租借費用試算網頁（venue-quote-calculator）

> **注意（2026-11-26）**：本檔先在本機交接包撰寫，之後才發現 GitHub main 在 2026-11-26 上午已被更新（加了「僅供參考、不具報價效力」等免責文字，README.md 也已改過）。本分支以最新的 main 為底，只加入「匿名使用計數」與 /api/metrics。因此下文提到「已刪除 index_17.html、README_1.md、重寫 README」的地方，**只發生在本機整理版，GitHub 上這兩個檔案仍在**，本分支沒有刪除它們。index_17.html 與 index.html 內容不同步時請以 index.html 為準（Worker 與本分支的修改只在 index.html）。

來源 repo：`TaipeiNewHorizon-tw/venue-quote-calculator`（公開）。本資料夾是 2026-09-10 commit `9a77607` 的完整原始碼。`_prototype-artifact/` 是 8 月底的早期原型，只供對照，可刪。

## 這是什麼
業務與客戶用的場地報價試算：多廳別、多時段，含加購項目、報價總計獨立檢核、管理者可調全站折扣。

## 架構
- 純前端單檔 `index.html`（79 KB，標題 V1.2；README 寫 V1.3，版號不一致）加 Cloudflare Worker `worker.js`（7 KB）。
- 靜態檔交給 Cloudflare Assets（binding `ASSETS`，目錄為 repo 根目錄）；Worker 只處理 `/api/*`。
- Worker API（另有 `POST /api/track`、`GET /api/metrics`，見下方「匿名使用計數」）：`GET /api/config`（任何人，取得目前折扣）、`POST /api/login`（密碼正確核發 2 小時 Cookie `admin_session`）、`POST /api/config`（需登入，更新折扣寫進 KV）、`POST /api/logout`。折扣預設 0.8、標籤「8折」。
- 價目（前端內寫死）：2026 場租優惠價（未稅），依官網收費表；加購其他費用依「其他費用」報價單 2026/01/01 版；國定假日陣列 `NATIONAL_HOLIDAYS` 涵蓋到 2027 年底。
- 檢核：`verifyQuoteTotal` 用另一套獨立寫成的算法重算總價（不呼叫 `sessionRate`／`rowPrice`），一致時顯示「已檢核」，不一致顯示「請人工試算」。
- 保證金與超時費只顯示「另計」文字，不計入金額。
- 頁面沒有任何「送出報價」功能，也不收集客戶姓名、聯絡方式或需求（2026-11-25 檢查 index.html 確認：沒有複製按鈕、沒有客戶欄位）。報價區下方只有「前往使用辦法與申請表格」連結（官網 `/venues/apply`），正式申請在官網完成。先前文件寫的「複製報價文字」與現況不符。

## 檔案
`index.html`、`worker.js`、`wrangler.jsonc`、`README.md`、`README_1.md`（舊版 V1.2 的 Pages 部署說明，與現況不符）、`index_17.html`（與 `index.html` 完全相同的重複檔，可刪）。

## 部署（Cloudflare Workers）
- `wrangler.jsonc`：名稱 `venue-quote-calculator`、主程式 `worker.js`、KV 綁定 `CONFIG_KV`。GitHub 推送後由 Cloudflare 的 Git 整合自動部署。
- 手動部署：`npx wrangler deploy`。
- 密鑰：`ADMIN_PASSWORD`（Worker Secret）。設定：`npx wrangler secret put ADMIN_PASSWORD`，或 Cloudflare 後台 → Worker → Settings → Variables and Secrets。專案被刪除重建後 Secret 會消失，必須重設。
- 綁定名稱：`CONFIG_KV`（KV）、`ASSETS`（靜態檔）。KV namespace ID 已寫在 `wrangler.jsonc`，換帳號時要重建並改 ID。
- 已知問題：Cloudflare 的 Git 整合曾反覆斷線。

## 匿名使用計數與 `/api/metrics`（2026-11-25 新增，尚未部署）
給彙總儀表板 `tnh-hub` 顯示「今日試算次數」。**不收集任何個資**：只記次數，不記 IP、不設 Cookie、不記試算內容。
- 前端 `index.html` 的 `track()`：（1）這次造訪**第一次算出大於 0 的總金額**送 `estimate`；（2）按「前往使用辦法與申請表格」送 `apply_click`。每種事件每次造訪最多送一次，失敗一律忽略。**這不是「正式報價單張數」**，只是「有算出金額的造訪次數」。
- Worker `POST /api/track`（公開）：只接受 `estimate`／`apply_click`；有 `Origin` 標頭時必須同源（否則 403）；累加到 KV 的 `stats:YYYY-MM-DD`（臺北日期，保留 14 天）。**每天最多接受 500 次事件，超過即忽略、不再寫 KV**——因為 KV 免費方案每天只有 1000 次寫入，要留給管理者調折扣；代價是被刻意灌水時當天數字會停在 500。
- Worker `GET /api/metrics`：需 `Authorization: Bearer <METRICS_TOKEN>`，回傳 `estimates_today`、`apply_clicks_today`。**沒設 `METRICS_TOKEN`（Worker Secret）時一律拒絕（503）**。
- 部署前要做：`npx wrangler secret put METRICS_TOKEN`（長隨機字串），並把同一個值設到 `tnh-hub` 的 `QUOTE_METRICS_TOKEN`、網址設到 `QUOTE_URL`。
- 已知限制：KV 讀後寫不是原子操作，同一瞬間多人送出可能少算幾次（一般用量可忽略）；計數頁面的人可以自己呼叫 `/api/track` 灌水（有同源檢查與每日上限，但擋不住刻意的人），所以這個數字只當趨勢參考。
- 本機用 `wrangler dev`（模擬 KV）驗證過：無金鑰／錯誤金鑰被拒、事件累加、非法事件 400、跨來源 403、每日上限、既有 `/api/config` 不受影響；在瀏覽器實際操作確認「總金額為 0 時不送、第一次大於 0 才送一次、之後改選項不再送、按申請連結只送一次」，並確認 tnh-hub 卡片讀得到。**沒驗證**：實際部署後在 Cloudflare 上的行為與 Secret 設定。

## 上線狀態查核（2026-11-25，我做的）
- 正式網址 `https://venue-quote-calculator.tnhmichael.workers.dev/`：頁面可載入，標題 V1.2，有「管理者登入」。
- `GET /api/config` 回傳 `{"discount":0.8,"discountLabel":"8折"}`，所以 **Worker 後端確實在線**。
- 我**無法確認**前端是否為 repo 目前這一版：我的環境不能直接下載 HTML 比對。請你在瀏覽器確認三件事：加購項目有出現、報價結果有「已檢核」徽章、管理者登入後能改折扣。
- 回傳的 8 折是預設值，不代表已有人用管理者功能改過。

## 待辦清單
1. 在瀏覽器完成上述三項驗證；若有缺，`npx wrangler deploy` 後再驗。
2. ~~刪除 `index_17.html`、重寫 `README.md`~~（2026-11-25 已完成，並刪除 `README_1.md`、`_prototype-artifact/`）。版號仍待你決定：頁面與 README 目前都是 V1.2。已驗證線上 `index.html` 與本地雜湊值相同。
3. ~~報價名單自動留存~~：**已決定（2026-11-25）維持現狀，不做。** 本頁只做試算，正式申請與客戶資料一律在官網 `/venues/apply` 完成，本系統不收集、不留存任何客戶個資。若日後想看使用情況，可考慮匿名記錄試算內容（不含個資）做熱門廳別／時段統計，但目前不需要。
4. 牌價與加購價格後台化（沿用現有管理者登入加 KV）。
5. 設備庫存目前只在單次試算內擋，不跨客戶；要嘛標示限制，要嘛串實際庫存。
   - 現況：數量欄旁已顯示「最多 N 座」（`maxUnits`，上限在 `ADDON_DEFS` 內寫死）。尚未說明「以實際申請當日庫存為準」。要加這句說明需由你確認措辭（屬於對客戶的承諾說法）。
6. 國定假日補 2028 年以後。
   - 目前不會出錯：日期選擇器上限 `MAX_DATE = "2027-12-31"`（`index.html`），客戶選不到 2028 年。政府通常在前一年底公布次年辦公日曆，**2028 年的假日要等官方公布後才能補**，不要憑印象填。屆時同步把 `NATIONAL_HOLIDAYS` 與 `MAX_DATE` 一起延伸。
7. 場地清單與場地協助系統、3D 網站共用一份主資料。
8. repo 與 Cloudflare 收回公司組織／團隊帳號。目前網址的子網域是個人的 `tnhmichael`；數位名片已改到公司子網域 `cards.taipeinewhorizon.com.tw`，本系統可比照申請公司子網域（舊的 `README_1.md` 曾舉例 `quote.taipeinewhorizon.com.tw`），改網域後要同步更新 3D 場地網站內指向它的連結與已印出的 QR code。
