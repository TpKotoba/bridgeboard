import type { ResultInput } from '@/lib/model';
import { miniGameLevel } from '@/lib/scoring';

export function MiniContractFields({ value, onChange }: { value: ResultInput; onChange: (value: ResultInput) => void }) {
  return <label className="field">MiniBridge 合約
    <select value={`${value.strain}-${value.level === 1 ? 'part' : 'game'}`} onChange={e => {
      const [strain, target] = e.target.value.split('-') as [ResultInput['strain'], string];
      const level = target === 'part' ? 1 : miniGameLevel(strain);
      onChange({ ...value, strain, level, doubled: 1, miniBridge: true, tricks: level + 6 });
    }}>
      {(['C', 'D', 'H', 'S', 'NT'] as const).flatMap((strain, i) => ['part', 'game'].map(target =>
        <option key={`${strain}-${target}`} value={`${strain}-${target}`}>{['♣', '♦', '♥', '♠', 'NT'][i]} · {target === 'part' ? '一線（7 墩）' : `成局（${miniGameLevel(strain) + 6} 墩）`}</option>
      ))}
    </select>
  </label>;
}
