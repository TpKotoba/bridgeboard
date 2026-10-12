# 計分與裁判操作（2026-10-13）

## 雙人賽

建立時選擇 MP、CrossIMP 或 ButlerIMP，賽後不可直接切換政策。舊賽事未有新欄位時，仍依 MP／不去尾處理，不改動既有資料。

- MP：各副同桌南北分比較，勝 2、同 1；總分是有效 top 加權百分比。
- CrossIMP：各桌與其餘有效桌逐一換算 IMP，再取平均，EW 為負值。
- ButlerIMP：同副有效 NS 分取算術平均，datum 四捨五入至最近 10 分（恰為 5 時遠離零），每桌 NS 分與 datum 差額換算 IMP，EW 為负值。
- IMP 模式排名採每副 IMP 的累計總和；取消及轮空不補平均分，也不按牌數補分。比賽主辦應在開始前確認安排牌數是否公平。
- 少於兩筆有效結果的牌沒有比較分；一筆有效結果時不能結束賽事，需裁判處理。

CrossIMP 與 ButlerIMP 都可選「不去尾」、「最高最低各去一筆」、「最高最低各去 10%（向下取整）」。Butler 對全部有效分的 datum 樣本去尾；CrossIMP 對當前桌以外的比較樣本去尾後再平均 IMP。樣本少於三筆不去尾。去尾只改比較樣本，不刪除任何桌次成績；最高最低同分時依筆數去除即可，不會改變數值結果。

這是雙人賽的賽事計分政策；隊制賽的選手 Butler 個別統計尚未新增。

算法參照：[Bridge NSW scoring](https://bridgensw.com.au/scoring/)、[WBU 計分方法](https://directors.welshbridgeunion.org/wp-content/uploads/2020/06/BRIDGE-SCORING-METHODS-FOR-PAIRS-and-TEAMS.pdf)。去尾筆數及樣本不足規則是此系統明示的賽事設定，並非所有賽事的統一規則。

## 裁判與權限

`ADMIN_PASSWORD` 是一般主辦／收分帳號。`DIRECTOR_PASSWORD` 是裁判帳號，至少 16 字元，且必須不同於主辦密碼。使用同一登入畫面，伺服器依密碼簽發不同角色；前端無法自己提升角色。未設定裁判密碼時，裁判功能不可操作。

本機 `npm run dev:local` 的裁判測試密碼：`local-bridge-director-2026`。正式部署請使用獨立強密碼。

- 在收分頁選擇桌次與牌號、填寫原因，再按「裁判：設為 Cancelled」。取消後保留原合約供稽核，公開畫面顯示 Cancelled，不顯示為 Pass 或 0 分。
- Cancelled 計入收件進度，但不進入 MP／IMP 比較或已計牌數。若一副全部取消，不產生比較分。一般收分或 CSV 不能覆寫；裁判需在相同頁面填入完整合約，再按恢復。
- 隊制任一房取消，該對戰該副不再比較，VP 以剩餘有效牌數計算；整場對戰取消則不給 VP。賽事結束仍要求每個安排的桌次結果都有收件或取消紀錄。
- 在「裁判 Penalty」選擇參賽者、填入扣分與原因。數值是累計扣分的絕對值，會取代既有值；0 撤銷。MP 扣總百分點、雙人 IMP 扣總 IMP、隊制扣總 VP。原始合約分與每副比較不變，排名扣分後重排，不限制總分最低為零。
- 已結束賽事須先重新開放才能改成績或罰分。所有裁定有 revision、時間、理由及前後差異。一般主辦 API 呼叫裁判 action 回傳 403。

## 逐副公開、排序與首攻

發布設定改為每副獨立開關。舊賽事沿用原有公開狀態；操作一副不改其他副。隱藏副的 deal 不會出現在公開 API，PBN 下載及 DDS 也隨之停用。已下載資料不能遠端收回。

為避免關閉後 CDN 繼續交付完整牌型，賽事詳情 API 改成 `no-store`；賽事清單仍有 15 秒 CDN 快取。輪詢間隔保持 30 秒，但詳情請求每次均會到伺服器與資料庫，成本估算不可再假設該路由有 CDN 命中。

逐副表可按 NS 原始分或 MP%／IMP 升降序排列，缺分與 Cancelled 置底。隊制排序依開室 NS 原始分。選桌（隊制可選開／閉室）後，公開手牌中對應的首攻會亮金色；需為莊家左手方持有的牌。未輸入不標示，與牌型不符則提示核對，不猜牌。

## 互動 Double Dummy

使用 [bridge-dds](https://github.com/bookchris/bridge-dds-js)（Apache-2.0），WebAssembly 在瀏覽器 Worker 計算四方向、五定約的最佳墩數。點表格可選莊家／王牌並开始試打，點合法牌繼續、上一步回退。每張牌的數字是雙方最佳攻防下莊家最終可得墩數，不是實戰預測。

不呼叫外部 DDS 服務，也不提交試打至比賽成績。首次需下載約 0.5 MB 引擎 JS（含 WASM）；切副重建 Worker。完整表分析超過 60 秒會停止並提示重開。

建置及 dev 啟動會從已鎖版 npm 套件複製 DDS 靜態檔至 `public/vendor/dds`（含授權文件）；無須 Vercel 原生 C++ addon、長駐伺服器或外部分析 API。

## 驗收

`npm test`、`npm run typecheck`、`npm run build`。另以啟動中的本機模式執行 `node node_modules/tsx/dist/cli.mjs scripts/advanced-smoke.ts`，驗證兩種 IMP、逐副公開、角色 403、取消恢復、Penalty 和稽核。腳本只新增獨立測試賽事，不刪除或更改既有賽事。
