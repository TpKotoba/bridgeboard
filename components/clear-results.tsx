'use client';
import { useState } from 'react';
import { EditorPopover } from './editor-popover';
export function ClearResults({
  name,
  count,
  busy,
  save,
}: {
  name: string;
  count: number;
  busy: boolean;
  save: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const [confirmation, setConfirmation] = useState('');
  return (
    <section className="import-export-section clear-results-control">
      <EditorPopover title="清除所有成績">
        <p>
          清除「{name}」全部 {count}{' '}
          筆成績（含取消牌及不平衡合約）、判罰扣分、收分確認與結算狀態，並回到尚未開始收分。
        </p>
        <p>
          保留賽程、入座名單、牌型與操作紀錄。建議先下載成績 CSV 或賽事資料
          JSON；此操作無法直接復原。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (confirmation !== name || busy) return;
            if (
              await save({
                action: 'clear-results',
                confirmName: confirmation,
                reason: '裁判清除所有成績',
              })
            )
              setConfirmation('');
          }}
        >
          <label className="field">
            輸入完整名稱「{name}」確認
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="button danger" disabled={busy || confirmation !== name}>
            {busy ? '清除中…' : '確認清除所有成績'}
          </button>
        </form>
      </EditorPopover>
    </section>
  );
}
