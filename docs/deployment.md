# 部署與備份

## Vercel 部署

1. 將此專案推送到自己的 Git repository，在 Vercel Import Project，選 Next.js；Node.js 版本選 22 或相容的受支援版本。
2. 建立 Neon PostgreSQL，取得連線字串。正式與 Preview 使用不同資料庫或 branch。
3. 設定環境變數：

   - `STORAGE_MODE=neon`
   - `DATABASE_URL`：Neon 連線字串（不得使用 NEXT_PUBLIC 前綴）
   - `ADMIN_PASSWORD`：至少 16 字元的獨立隨機密碼
   - `DIRECTOR_PASSWORD`：至少 16 字元、與賽務不同的裁判密碼，供裁判後台操作
   - `SESSION_SECRET`：至少 32 字元隨機字串，可用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 產生

4. 在本機 `.env.local` 設定目標 DB 連線，執行 `npm run db:migrate`，建立 schema。這個步驟不會建立假成績；正式環境登入後自行建立新賽事。
5. 部署。Build command 為 `npm run build`，其餘採 Vercel Next.js 預設。函式區域請與 Neon 接近。
6. 開啟 `/api/health` 確認程式服務；再開首頁確認 DB 可讀，登入建立測試賽事，收分後重新開啟網頁確認持久化。

不需要 Docker 或常駐 Node server。

正式賽事前，請在部署環境驗證資料保存、成績更新與集中收分流程。

## 測試與備份

```sh
npm test
npm run typecheck
npm run build
```

測試涵蓋合約分、IMP 邊界、VP、開閉兩室方向、MP 同分／缺分／更正、輪空、CSV/PBN、重送與版本衝突。

- 正式 DB 備份以 PostgreSQL `pg_dump --format=custom --file=Valet.dump` 執行，連線資訊透過 PG 環境變數提供，將檔案存至部署之外的儲存空間。
- 還原先建立獨立測試 DB，使用 `pg_restore --no-owner --dbname=<測試資料庫名稱> Valet.dump`（主機／帳密由 PG 環境變數設定），核對場次、revision、成績及稽核筆數後才考慮正式切換。不要對正式資料庫直接試還原。
- 後台 JSON 匯出方便攜出及檢查，目前沒有網頁 JSON 還原按鈕，不能取代 DB 備份。
- Vercel 程式回退不會回退 DB；新增 schema 應向後相容。

WBF VP 來源：https://www.worldbridge.org/wp-content/uploads/2019/06/VP-Scale-Functiondetails.pdf
