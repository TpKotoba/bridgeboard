# Movement 與隨機發牌

裁判後台的「匯入／匯出」提供編排預覽、套用與隨機 PBN 產生。

## Movement

選項依現有參賽對數、圈數與每圈牌數篩選。不更改賽段圈數。
全場同牌輪轉可用於目前支援的所有規模；奇數桌使用 Mitchell，偶數桌使用 Skip Mitchell 或共牌／中繼桌 Mitchell。
Howell 使用內建編排表：完整 Howell 為 3–8 桌，Reduced（3/4）Howell 為 4–10 桌的表列圈數，最多 15 圈。
奇數對數以缺席的最高編號作為輪空對。預覽顯示實際桌次並提示輪空、共用牌組及牌數變更。
套用會替換整個未收分賽段的編排，保留相同牌號牌型，新增空白牌型，移除超出範圍的牌號；不得在已有任何成績（含取消）時套用。

數字編排資料來源（2026-10-16 擷取）：

- https://bridgecentral.com/4Tables.htm 至 https://bridgecentral.com/10Tables.htm ，各 Howell / Reduced Howell 表。資料保存 source 與 sourceName。
- https://web.mit.edu/mitdlbc/www/bridgemats/Wide/H0305.PDF ，三桌五圈。
- 選擇背景：https://en.wikipedia.org/wiki/Duplicate_bridge_movements#Choice_of_movements

所有內建選項皆以測試驗證：每圈每對只上場一次、桌次完整、同對不重打牌、Howell 不重遇對手。

## Deal Source

語法依 https://www.bridgebase.com/tools/dealer/Manual/input.html 的常用發牌條件實作，非完整 Dealer 執行檔。
支援條件、變數、註解、predeal、generate、produce、dealer、vulnerable、pointcount；支援 hcp、花色長度、shape、hascard、controls、losers、大牌張數與一般數值／邏輯運算。
尚未支援 tricks、cccc、quality、altcount、ptN、score、imps 及統計 action；不支援內容會報錯，不會忽略。
輸出固定 PBN，接受 printpbn、printall、printoneline 作為輸出指令。
採 Web Crypto 均勻洗牌，predeal 先固定指定牌，再洗剩餘牌；條件以拒絕抽樣篩選。未達指定副數時不回傳部分結果。
最多 128 副、100 萬次嘗試、30 秒；可取消。Source 不作 JavaScript 執行，也不傳至外部網站。
produce 預設本賽段牌數，可減少以供下載；套用需要全部牌號，沿用既有 PBN 匯入的裁判權限、版本與未收分檢查。
