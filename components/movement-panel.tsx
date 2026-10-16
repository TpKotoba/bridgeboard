'use client';
import { useState } from 'react';
import type { BridgeEvent } from '@/lib/model';
import { buildMovement, movementOptions } from '@/lib/movement-plans';

export function MovementPanel({ event, busy, save }: {
  event: Pick<BridgeEvent, 'kind' | 'participants' | 'rounds' | 'boardsPerRound' | 'boards' | 'results' | 'status'>;
  busy: boolean; save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [choice, setChoice] = useState('');
  const [preview, setPreview] = useState(false);
  const options = movementOptions(event);
  const plan = choice ? buildMovement(event, choice) : null;
  const locked = event.status === 'finished' || Object.keys(event.results).length > 0;
  const name = (id: string) => event.participants.find(p => p.id === id)?.name ?? id;
  return <section className="import-export-section">
    <h4>指定賽程編排</h4>
    <p>{event.participants.length} 對（{event.participants.length / 2} 桌），{event.rounds} 圈，每圈 {event.boardsPerRound} 牌。</p>
    <label className="field">適用的編排方式<select value={choice} onChange={e => { setChoice(e.target.value); setPreview(false); }}>
      <option value="">請選擇賽程編排</option>
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
    <p className="footnote">依本賽段桌數、圈數列出適用選項。3/4 Howell 的圈數依編排表而定，並非固定為完整 Howell 的四分之三。</p>
    {plan && <>
      <p>{plan.option.note}</p>
      <p>共 {plan.option.groups} 組牌、{plan.boardCount} 副。{event.participants.length % 2 ? '每圈有一對輪空。' : ''}不共牌需準備 {plan.copies} 套完整牌，每套 {plan.boardCount} 副，共 {plan.copies * plan.boardCount} 副實體牌。{plan.shared ? '各套相同牌號的牌型須一致；也可安排共牌。' : ''}</p>
      {plan.boardCount !== event.boards.length && <p className="footnote">套用後牌數將由 {event.boards.length} 改為 {plan.boardCount}；保留相同牌號的牌型，移除範圍外的牌號。</p>}
      <button className="button subtle" onClick={() => setPreview(!preview)}>{preview ? '收起預覽' : '預覽完整賽程'}</button>
      {preview && <>
        <div className="table-scroll"><table><thead><tr><th>圈次</th><th>桌號</th><th>南北</th><th>東西</th><th>牌號</th></tr></thead><tbody>
          {plan.assignments.map(a => <tr key={a.id}><td>{a.round}</td><td>{a.table}</td><td>{name(a.ns)}</td><td>{name(a.ew)}</td><td>{a.boards.join(', ')}</td></tr>)}
        </tbody></table></div>
        <p className="footnote">確認後將替換本賽段賽程，並重設圈次為尚未開始。已有成績時不能套用。</p>
        <button className="button subtle" disabled={busy || locked} onClick={async () => {
          if (await save({ action: 'movement-plan', plan: choice, reason: `指定 ${plan.option.label}` })) setPreview(false);
        }}>確認套用賽程編排</button>
      </>}
      {plan.option.source && <p className="footnote"><a href={plan.option.source} target="_blank" rel="noreferrer">查看編排表來源</a></p>}
    </>}
  </section>;
}
