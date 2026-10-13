# Bridgeboard — 橋牌記分 MVP

繁體中文的隊制賽與雙人賽記分系統，使用 Next.js / TypeScript，支援 Vercel + Neon PostgreSQL。

## 本機試用

需要 Node.js 22 或較新的相容版本。

```sh
npm ci
npm run dev:local
```

開啟 http://127.0.0.1:3000 。包含兩場清楚標示的模擬賽事。

- 主辦測試密碼：`local-bridge-admin-2026`。這只適用綁定 loopback 的 `dev:local`；正式部署必須自行設定強密碼。
- 本機成績與修訂紀錄保存在 `.data/events.json`，重新啟動仍保留。啟動時產生的 session secret 每次不同，重啟需重新登入。
- `npm run dev` 未設定環境時為唯讀展示，不會假裝已保存資料。
- `local` 使用單一程序寫入鎖與暫存檔更名，僅供本機開發。Vercel 環境明確拒絕此模式。

## 已實作

- 隊制賽：兩房比較、合約分、IMP、WBF 連續 20–0 VP；對戰全部收齊才計入 VP。
- 雙人賽：同副跨桌 MP、CrossIMP 或 ButlerIMP，可為兩種 IMP 模式設定去頭去尾；支援 NS/EW 合併排名、輪空及缺分。
- 賽事建立、固定循環賽程（可截取輪數）、桌次表、總排名、隊伍／搭檔個別成績、逐副 traveler、四家牌型。
- 主辦密碼登入、手動收分／更正、版本衝突檢查、原始結果前後差異與稽核。
- CSV 成績匯入預覽與匯出；雙人賽 movement 匯入／匯出；PBN 匯入／下載；JSON 資料匯出。
- 牌型逐副公開；未公開牌型不會出現在公開 API。裁判可設 Cancelled 與 Penalty，並保留稽核。
- 30 秒輪詢、背景分頁停止請求、完賽停止刷新、錯誤退避；賽事清單可快取 15 秒，賽事詳情不快取以立即反映逐副公開狀態。
- 手機牌局提供圈數／圈內牌序跳轉、Par／LoTT／HCP／Double Dummy 與輔助鍵盤試打；逐副成績可按桌次或 NS 原始分排序。
- 寫入時計算排名快照，資料庫以 revision 條件更新，原始資料／快照／稽核一次提交。

## Vercel 部署

1. 將此專案推送到自己的 Git repository，在 Vercel Import Project，選 Next.js；Node.js 版本選 22 或相容的受支援版本。
2. 建立 Neon PostgreSQL，取得連線字串。正式與 Preview 使用不同資料庫或 branch。
3. 設定環境變數：

   - `STORAGE_MODE=neon`
   - `DATABASE_URL`：Neon 連線字串（不得使用 NEXT_PUBLIC 前綴）
   - `ADMIN_PASSWORD`：至少 16 字元的獨立隨機密碼
   - `DIRECTOR_PASSWORD`：至少 16 字元、與主辦不同的裁判密碼，啟用 Cancelled 與 Penalty
   - `SESSION_SECRET`：至少 32 字元隨機字串，可用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 產生

4. 在本機 `.env.local` 設定目標 DB 連線，執行 `npm run db:migrate`，建立 schema。這個步驟不會建立假成績；正式環境登入後自行建立新賽事。
5. 部署。Build command 為 `npm run build`，其餘採 Vercel Next.js 預設。函式區域請與 Neon 接近。
6. 開啟 `/api/health` 確認程式服務；再開首頁確認 DB 可讀，登入建立測試賽事，收分後重新開啟網頁確認持久化。

不需要 Docker 或常駐 Node server。這份專案尚未代為建立任何雲端帳號或公開部署。

Hobby 是否符合使用情境需依個人非商業條件確認；超過免費額度時需升級或移轉。正式賽事前在 Vercel 驗證 cache headers、用量及集中收分。

## 操作順序

建立賽事 → 核對名單與賽程 → 匯入 PBN／自訂 movement → 手動或 CSV 收分 → 核對排名 → 決定牌型公開時間 → 收齊後結束賽事。

預設循環賽程每輪所有桌次打同一牌組，雙人賽需備妥重複牌組；它不是自動產生的實體 Mitchell/Howell movement。若使用既有 movement，先匯入。十五對十三輪兩副的預設賽程包含輪空，共 182 筆桌次結果，不是假設每人都打滿 26 副。

成績 CSV：

```csv
assignmentId,board,level,strain,doubled,declarer,tricks,lead
r1m1o,1,3,NT,1,N,9,SA
r1m1c,1,4,S,1,E,10,HA
```

- `assignmentId` 以後台桌次顯示為準；匯入 movement 後 ID 可能改變。
- `doubled` 為 1 / 2 / 4；`tricks` 是實際取得的總墩數。
- Pass out：level=0、tricks=0、doubled=1；strain/declarer 仍需合法值但不參與計分。
- 同一桌次／牌號既有結果會被更正，需說明原因，整批驗證通過才保存。

Movement CSV：`round,table,ns,ew,boards`，搭檔 ID 如 p1，牌組用分號分隔，例如 `1;2`。會檢查每輪桌數、同輪搭檔衝突、重複打同牌與牌號範圍。首版僅單一比較組與合併排名。

PBN 支援 Board、Dealer、Vulnerable、Deal 標籤。需一次提供全場完整 52 張牌；尚未收分才可匯入，以避免身價變更造成既有成績錯誤。

## 計分政策與 MVP 邊界

同分並列，未套用賽事專屬破同分規則。雙人賽依已收結果暫時計分，單副只有一筆結果時不產生 MP 百分比；輪空沒有成績。正式發布前需全數收齊。

尚未提供裁判平均分／加權調整、Neuberg 跨組調整、carry-over、Swiss 自動配對、多人主辦權限、選手自行登入收分與硬體整合。這些情況不能以假合約代替；需要擴充計分政策後再用於正式賽事。CrossIMP、ButlerIMP、Cancelled 與 Penalty 的明確規則見 [計分與裁判操作](docs/ADVANCED_SCORING.md)。

每場最多 32 組、15 輪、128 副；每次匯入 200 KB／2,000 筆結果。MVP 使用 PostgreSQL 每場一個 JSONB 文件與 CAS 版本更新，保留所有稽核；大型多年賽事需拆分正規化資料表與歸檔。

請求去重保留最近 500 個 request ID。重試需沿用 request ID 和 revision；較舊請求會因 revision 不符而拒絕，不會覆寫新資料。

主辦採單一共享密碼，cookie 為 HttpOnly / SameSite Strict，正式環境加 Secure，8 小時過期。Neon 模式以 DB 保存每個來源十分鐘最多十次登入嘗試，本機測試以程序記憶體計數；正式部署再搭配 Vercel 防火牆控管異常流量。資料庫只保存來源 IP 的 HMAC，不保存原始 IP；可定期清理已過期的 bridge_login_limits 紀錄。設定更細的主辦身分、二階段驗證與正式賽事操作規範屬下一階段。

## 測試與備份

```sh
npm test
npm run typecheck
npm run build
```

測試涵蓋合約分、IMP 邊界、VP、兩房方向、MP 同分／缺分／更正、輪空、CSV/PBN、重送與版本衝突。

- 正式 DB 備份以 PostgreSQL `pg_dump --format=custom --file=bridgeboard.dump` 執行，連線資訊透過 PG 環境變數提供，將檔案存至部署之外的儲存空間。
- 還原先建立獨立測試 DB，使用 `pg_restore --no-owner --dbname=<測試資料庫名稱> bridgeboard.dump`（主機／帳密由 PG 環境變數設定），核對場次、revision、成績及稽核筆數後才考慮正式切換。不要對正式資料庫直接試還原。
- 後台 JSON 匯出方便攜出及檢查，目前沒有網頁 JSON 還原按鈕，不能取代 DB 備份。
- Vercel 程式回退不會回退 DB；新增 schema 應向後相容。

WBF VP 來源：https://www.worldbridge.org/wp-content/uploads/2019/06/VP-Scale-Functiondetails.pdf
