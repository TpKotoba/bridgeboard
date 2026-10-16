'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, X } from 'lucide-react';
import type { BridgeEvent } from '@/lib/model';
import { teamButlerStats } from '@/lib/team-butler';

type Props = {
  event: Pick<BridgeEvent, 'kind' | 'rounds' | 'assignments' | 'results' | 'participants'>;
  teamId: string;
};
const decimal = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');
const signed = (n: number) => `${n > 0 ? '+' : ''}${decimal(n)}`;
export function TeamButlerPopover({ event, teamId }: Props) {
  const id = useId();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<'individual' | 'pairs'>('individual');
  const [team, setTeam] = useState(teamId);
  useEffect(() => setMounted(true), []);
  const stats = useMemo(() => teamButlerStats(event), [event]);
  const rows = stats[mode].filter((r) => !team || r.teamId === team);
  const pairs = mode === 'pairs';
  return (
    <>
      <button
        type="button"
        className="button subtle team-butler-trigger"
        popoverTarget={id}
        onClick={() => setTeam(teamId)}
      >
        <BarChart3 size={16} />
        Butler 統計
      </button>
      {mounted &&
        createPortal(
          <div
            id={id}
            popover="auto"
            role="dialog"
            aria-labelledby={`${id}-title`}
            className="team-butler-popover"
          >
            <header className="team-butler-heading">
              <div>
                <h3 id={`${id}-title`}>個人／搭檔 Butler 統計</h3>
                <p>Individual / Pair Butler Score</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="關閉 Butler 統計"
                popoverTarget={id}
                popoverTargetAction="hide"
              >
                <X size={20} />
              </button>
            </header>
            <div className="team-butler-controls">
              <div className="team-butler-tabs" role="group" aria-label="統計類型">
                <button type="button" aria-pressed={!pairs} onClick={() => setMode('individual')}>
                  個人 Individual
                </button>
                <button type="button" aria-pressed={pairs} onClick={() => setMode('pairs')}>
                  搭檔 Pair
                </button>
              </div>
              <label className="field">
                查看隊伍
                <select value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">全場隊伍</option>
                  {event.participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="team-butler-scope">
              {stats.rounds.length
                ? `已納入第 ${stats.rounds.join('、')} 圈 · 共 ${stats.rounds.length} 圈`
                : '尚無已完成圈次'}
              <span>排名以全場計算，同分並列；預設依每牌 IMP 排序。</span>
            </p>
            {rows.length ? (
              <div
                className="team-butler-scroll"
                tabIndex={0}
                role="region"
                aria-label="Butler 統計表，可左右捲動"
              >
                <table>
                  <thead>
                    <tr>
                      <th>隊伍</th>
                      <th>{pairs ? '賽員 1' : '賽員'}</th>
                      {pairs && <th>賽員 2</th>}
                      <th>有效牌數</th>
                      {pairs && (
                        <>
                          <th>正平均 IMP</th>
                          <th>負平均 IMP</th>
                          <th>總平均 IMP</th>
                          <th>總 IMP</th>
                          <th>總 IMP 排名</th>
                        </>
                      )}
                      <th>每牌 IMP</th>
                      <th>每牌 IMP 排名</th>
                      <th>正負 IMP 商數</th>
                      <th>IMP 商數排名</th>
                      <th>總序分 MP</th>
                      <th>序分 MP %</th>
                      <th>MP 排名</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td>
                          {event.participants.find((p) => p.id === r.teamId)?.name ?? r.teamId}
                        </td>
                        <th scope="row">{r.names[0]}</th>
                        {pairs && <td>{r.names[1]}</td>}
                        <td>{r.boards}</td>
                        {pairs && (
                          <>
                            <td>{signed(r.positiveAverage)}</td>
                            <td>{signed(r.negativeAverage)}</td>
                            <td>{signed(r.average)}</td>
                            <td>{signed(r.total)}</td>
                            <td>{r.totalRank}</td>
                          </>
                        )}
                        <td className={r.average < 0 ? 'butler-negative' : 'butler-positive'}>
                          {signed(r.average)}
                        </td>
                        <td>{r.averageRank}</td>
                        <td>{r.ratio === null ? '—' : decimal(r.ratio)}</td>
                        <td>{r.ratioRank ?? '—'}</td>
                        <td>{r.mp}</td>
                        <td>{decimal(r.mpPercent)}%</td>
                        <td>{r.mpRank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="team-butler-empty">
                {stats.rounds.length
                  ? '此範圍尚無可統計的有效成績與上場姓名。'
                  : '待整圈各桌收齊成績後，才會納入統計。'}
              </p>
            )}
            <footer className="team-butler-notes">
              <p>
                只統計整圈各桌已收齊的成績，Cancelled、平均分與無其他桌可比較的牌不納入有效牌數。姓名依各桌實際上場名單；同隊相同姓名合併，搭檔交換座位仍視為同一組。
              </p>
              {stats.missingNames > 0 && (
                <p>
                  全場有 {stats.missingNames}{' '}
                  筆方向／牌次缺少完整或可區分的上場姓名，未納入搭檔統計；已知姓名仍計入個人統計。
                </p>
              )}
              <p>
                Butler：以同圈同牌有效原始分平均，四捨五入至十位作為
                Datum，不去頭去尾。正／負平均各除以正／負分牌數；總平均與每牌 IMP 均為總 IMP ÷
                有效牌數。商數＝正 IMP 總和 ÷ 負 IMP 總和絕對值（無負分且有正分為 ∞，全零為 —）。
              </p>
              <p>
                MP：逐桌比較，勝 2 分、和 1 分、負 0 分；百分比＝總序分 ÷
                可得最高序分。取消與平均分不參與比較；不平衡合約依各方獲判分計算，不直接採隊伍對戰
                IMP。
              </p>
            </footer>
          </div>,
          document.body,
        )}
    </>
  );
}
