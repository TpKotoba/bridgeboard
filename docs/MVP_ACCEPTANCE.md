# MVP 交付與驗收

驗收日期：2026-10-13。部署目標：Vercel + Neon PostgreSQL。

## 已驗證

- `npm test`：12 組通過，涵蓋合約分、IMP、VP、兩房方向、MP、輪空、更正、版本衝突、去重、CSV/PBN、錯誤匯入原子性與日期驗證。
- `npm run typecheck`：通過。
- `npm run build`：Next.js 16.4.0 production build 通過。
- `node scripts/smoke.mjs`：本機雙人賽及隊制賽的登入、建立、收分、重新讀取、去重、409 衝突、400 驗證、結束賽事、未授權及跨來源拒絕均通過。
- 瀏覽器人工驗收：公開排名、逐副牌型、個別成績、主辦收分、更正及稽核；390px 手機版與桌面版。
- 現有老少盃資料未作測試修改，畫面確認仍為 30／72 筆成績。

API 驗收建立的獨立「驗收測試」賽事保留於本機，便於追查。測試腳本只允許 local 儲存模式，不會自動刪除賽事。

## 尚待雲端環境驗收

未提供 Vercel／Neon 環境，因此尚未公開部署，也尚未對真實 Neon 執行 migration、並行寫入或備份還原測試。本機建置成功不能替代這些驗證。

依 [README](../README.md) 設定獨立的 Preview DB 與環境變數、執行 migration 後，驗證：

1. 建立測試賽事並收分；跨瀏覽器重新讀取結果。
2. 兩個主辦分頁更正同一版本，後提交者取得衝突提示，重新載入可繼續。
3. 公開 API 快取時間、未公開牌型遮蔽、登入限流與正式 HTTPS cookie。
4. 模擬預期觀眾量與集中收分，確認 Vercel request／DB 使用量。
5. 在獨立資料庫試行備份還原並核對 revision、結果及稽核。

GitHub Actions 已加入安裝、測試、建置及型別檢查；尚未在遠端 GitHub 執行。

## 使用邊界

目前適用固定賽程、隊制 IMP／連續 20–0 VP、雙人 MP 合併排名。裁判調整分、罰分、Neuberg、Swiss、自動 Mitchell／Howell、多人角色權限及選手自行收分尚未提供。完整限制見 README。
