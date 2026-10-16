'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import type { Board } from '@/lib/model';
import { generateDealerBoards } from '@/lib/dealer-source';
import { exportPbn } from '@/lib/imports';

export function RandomDealsPanel({ boards, locked, busy, save }: {
  boards: Omit<Board, 'deal'>[]; locked: boolean; busy: boolean;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [pbn, setPbn] = useState('');
  const [source, setSource] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [count, setCount] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const sourceId = useId();
  const helpId = useId();
  const previewId = useId();
  useEffect(() => () => controller.current?.abort(), []);
  return <section className="import-export-section">
    <h4>產生隨機牌局 PBN</h4>
    <p>預設完全隨機發牌，共 {boards.length} 副；可填入 Deal Source 指定條件。</p>
    <div className="field">
      <div className="scoring-label"><label htmlFor={sourceId}>Deal Source（選填）</label><button type="button" className="scoring-info-button" aria-label="Deal Source 語法與範例" popoverTarget={helpId}><Info size={16} /></button></div>
      <textarea id={sourceId} rows={6} maxLength={16000} disabled={working} value={source}
      placeholder={'condition shape(north, any 4333 + any 4432 + any 5332)\n  and hcp(north) >= 15 and hcp(north) <= 17\naction printpbn'}
      onChange={e => { setSource(e.target.value); setPbn(''); setMessage(''); }} />
    </div>
    <div id={helpId} popover="auto" className="scoring-help" role="dialog" aria-label="Deal Source 語法與範例" style={{ maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto' }}>
      <div className="scoring-help-heading"><strong>語法與範例</strong><button type="button" className="scoring-info-button" aria-label="關閉語法說明" popoverTarget={helpId} popoverTargetAction="hide"><X size={16} /></button></div>
      <p className="footnote">支援 condition、predeal、generate、produce、dealer、vulnerable、pointcount、變數、四則運算、比較、and／or／not、?:、hcp、花色長度、shape（any、x、+／-）、hascard、controls、losers 與大牌張數。</p>
      <p className="footnote">輸出固定為 PBN；可使用 action printpbn、printall 或 printoneline。尚未支援 tricks、cccc、quality、altcount 及統計 action，輸入不支援語法會顯示錯誤。留白沿用本賽段的發牌者與身價；dealer／vulnerable 可覆寫，MiniBridge 套用時維持無身價。</p>
      <button type="button" className="button subtle" disabled={working} popoverTarget={helpId} popoverTargetAction="hide" onClick={() => { setSource('predeal south SAQ542, HKJ87, D32, CAK\nwest1c = hcp(west) > 11 and clubs(west) >= 3\ncondition west1c\naction printpbn'); setPbn(''); setMessage(''); }}>載入指定手牌範例</button>
      <p><a href="https://www.bridgebase.com/tools/dealer/Manual/input.html" target="_blank" rel="noreferrer">Dealer 原始語法手冊</a></p>
    </div>
    <div className="button-row">
      <button className="button subtle" disabled={busy || working} onClick={async () => {
        controller.current = new AbortController(); setWorking(true); setPbn(''); setMessage('產生中…');
        try {
          const generated = await generateDealerBoards(boards, source, controller.current.signal,
            (accepted, attempts) => setMessage(`已找到 ${accepted} 副，已搜尋 ${attempts} 次`));
          setPbn(exportPbn({ boards: generated })); setCount(generated.length); setMessage(`已產生 ${generated.length} 副牌`);
        } catch (error) { setMessage((error as Error).message); }
        finally { setWorking(false); }
      }}>
        {pbn ? '重新產生' : '產生隨機牌局'}
      </button>
      {working && <button className="button subtle" onClick={() => controller.current?.abort()}>取消產生</button>}
      <button className="button subtle" disabled={!pbn} onClick={() => {
        const url = URL.createObjectURL(new Blob([pbn], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'random-deals.pbn'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>下載 PBN</button>
    </div>
    {message && <p role="status">{message}</p>}
    {pbn && <>
      <button type="button" className="button subtle" popoverTarget={previewId}>預覽牌局 PBN</button>
      <div id={previewId} popover="auto" className="scoring-help" role="dialog" aria-label="預覽牌局 PBN" style={{ width: 'min(640px, calc(100vw - 40px))', maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto' }}>
        <div className="scoring-help-heading"><strong>預覽牌局 PBN</strong><button type="button" className="scoring-info-button" aria-label="關閉牌局預覽" popoverTarget={previewId} popoverTargetAction="hide"><X size={16} /></button></div>
        <pre className="import-preview" style={{ overflowWrap: 'anywhere' }}>{pbn}</pre>
      </div>
      <p className="footnote">套用會替換本賽段的全部牌型；僅限尚未收分時操作。</p>
      {count !== boards.length && <p className="footnote">目前只產生 {count} 副，套用本賽段需包含全部 {boards.length} 副。</p>}
      <button className="button subtle" disabled={locked || busy || count !== boards.length} onClick={async () => {
        if (await save({ action: 'pbn', pbn, reason: '套用隨機產生牌局' })) setPbn('');
      }}>確認套用到本賽段</button>
    </>}
  </section>;
}
