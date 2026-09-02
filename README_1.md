# 場地租借費用試算

臺北文創場地租借費用試算頁面（單一 HTML 檔案，純前端、無需伺服器）。 

## 內容 

- `index.html`：試算頁面本體，Cloudflare Pages 會直接把這個檔案當首頁發佈。

## 部署到 Cloudflare Pages

1. 到 Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**。
2. 選擇這個 GitHub 專案。
3. Build 設定全部留空／預設即可（沒有建置流程，`Build command` 空白，`Build output directory` 填 `/`）。
4. 按 **Save and Deploy**，等它跑完就會拿到一個 `*.pages.dev` 的網址。
5. 之後可以在 Cloudflare Pages 專案的 **Custom domains** 加上自己的網域（例如 `quote.taipeinewhorizon.com.tw`）。

## 之後如何更新內容

修改 `index.html` 後，`git commit` + `git push` 到這個 GitHub 專案，Cloudflare Pages 會自動重新部署，不用手動操作。

## 資料維護提醒

- 國定假日清單寫在 `index.html` 內的 `NATIONAL_HOLIDAYS` 陣列，目前涵蓋到 2027 年底，之後每年需要人工核對政府行政機關辦公日曆表並更新。
- 保證金／超時費目前僅顯示「另計」文字說明，未計入金額。
