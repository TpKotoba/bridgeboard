'use client';
import { useState } from 'react';
import type { Result, ResultInput, Vulnerability } from '@/lib/model';
import { resultSchema } from '@/lib/model';
import { contractScore } from '@/lib/scoring';
import { MiniContractFields } from './mini-contract-fields';

export function SplitContractEditor({
  result,
  vulnerability,
  miniBridge,
  disabled,
  names,
  save,
}: {
  result: Result;
  vulnerability: Vulnerability;
  miniBridge: boolean;
  disabled: boolean;
  names: { ns: string; ew: string };
  save: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const clean = (r: ResultInput): ResultInput => ({
    assignmentId: r.assignmentId,
    board: r.board,
    level: r.level,
    strain: r.strain,
    doubled: r.doubled,
    declarer: r.declarer,
    tricks: r.tricks,
    lead: r.lead,
    miniBridge,
  });
  const [contracts, setContracts] = useState({
    ns: clean(result.split?.ns ?? result),
    ew: clean(result.split?.ew ?? result),
  });
  const [reason, setReason] = useState('');
  const valid = Object.values(contracts).every((r) => resultSchema.safeParse(r).success);
  return (
    <details className="split-contract-editor">
      <summary>{result.split ? '不平衡合約（已套用）' : '裁判判罰：不平衡合約'}</summary>
      <p className="footnote">
        分別指定 NS、EW 獲判的完整合約及實得墩數。雙方各自與另一室比較，VP 總和不一定為
        20；原始紀錄仍保留。
      </p>
      {(['ns', 'ew'] as const).map((side) => {
        const r = contracts[side];
        const update = (patch: Partial<ResultInput>) =>
          setContracts({ ...contracts, [side]: { ...r, ...patch } });
        return (
          <fieldset key={side}>
            <legend>
              {side.toUpperCase()} · {names[side]}
            </legend>
            <div className="form-grid">
              {miniBridge ? (
                <MiniContractFields value={r} onChange={(value) => update(value)} />
              ) : (
                <>
                  <label className="field">
                    線位
                    <select
                      value={r.level}
                      onChange={(e) => {
                        const level = Number(e.target.value);
                        update({ level, tricks: level ? level + 6 : 0, doubled: 1 });
                      }}
                    >
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                        <option key={n} value={n}>
                          {n || 'Pass'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    花色
                    <select
                      value={r.strain}
                      onChange={(e) => update({ strain: e.target.value as ResultInput['strain'] })}
                    >
                      {(['C', 'D', 'H', 'S', 'NT'] as const).map((s) => (
                        <option key={s} value={s}>
                          {{ C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' }[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    加倍
                    <select
                      disabled={!r.level}
                      value={r.doubled}
                      onChange={(e) => update({ doubled: Number(e.target.value) as 1 | 2 | 4 })}
                    >
                      <option value={1}>未加倍</option>
                      <option value={2}>X</option>
                      <option value={4}>XX</option>
                    </select>
                  </label>
                </>
              )}
              <label className="field">
                莊家
                <select
                  value={r.declarer}
                  onChange={(e) => update({ declarer: e.target.value as ResultInput['declarer'] })}
                >
                  {(['N', 'E', 'S', 'W'] as const).map((s) => (
                    <option key={s} value={s}>
                      {{ N: '北 N', E: '東 E', S: '南 S', W: '西 W' }[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                實得墩數
                <input
                  type="number"
                  min={0}
                  max={13}
                  disabled={!r.level}
                  value={r.tricks}
                  onChange={(e) => update({ tricks: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="mono">
              {side.toUpperCase()} 獲判原始分：
              {valid ? contractScore(r, vulnerability, miniBridge) * (side === 'ns' ? 1 : -1) : '—'}
            </p>
          </fieldset>
        );
      })}
      <label className="field">
        判罰／撤銷原因
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="button-row">
        <button
          type="button"
          className="button subtle"
          disabled={disabled || !valid || reason.trim().length < 2}
          onClick={() =>
            void save({
              action: 'split-contract',
              assignmentId: result.assignmentId,
              board: result.board,
              contracts,
              reason,
            })
          }
        >
          套用不平衡合約並重算
        </button>
        {result.split && (
          <button
            type="button"
            className="button subtle"
            disabled={disabled || reason.trim().length < 2}
            onClick={() =>
              void save({
                action: 'split-contract',
                assignmentId: result.assignmentId,
                board: result.board,
                contracts: null,
                reason,
              })
            }
          >
            撤銷不平衡合約
          </button>
        )}
      </div>
    </details>
  );
}
