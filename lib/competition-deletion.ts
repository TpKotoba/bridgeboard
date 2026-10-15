import { z } from 'zod';
import type { StoredEvent } from './model';
import { DomainError } from './events';

export const deletionSchema = z.object({
  competitions: z.array(z.object({
    id: z.string().min(1).max(100),
    confirmName: z.string().min(1).max(80),
    stages: z.array(z.object({ id: z.string().min(1).max(100), revision: z.number().int().positive() }).strict()).min(1).max(32),
  }).strict()).min(1).max(50),
}).strict();
export type CompetitionDeletion = z.infer<typeof deletionSchema>;

export function deletionTargets(data: StoredEvent[], input: CompetitionDeletion) {
  const ids = input.competitions.map(c => c.id);
  if (new Set(ids).size !== ids.length) throw new DomainError('請勿重複選取賽事');
  return input.competitions.flatMap(c => {
    const root = data.find(s => s.event.id === c.id);
    if (!root || root.event.parentEventId) throw new DomainError('賽事已變更，請重新載入清單', 409);
    if (c.confirmName !== root.event.name) throw new DomainError('請輸入完整比賽名稱以確認刪除');
    const family = data.filter(s => s.event.id === c.id || s.event.parentEventId === c.id);
    if (new Set(c.stages.map(s => s.id)).size !== c.stages.length || family.length !== c.stages.length ||
      family.some(s => !c.stages.some(expected => expected.id === s.event.id && expected.revision === s.event.revision))) {
      throw new DomainError('賽事或賽段已更新，請重新載入清單後再刪除', 409);
    }
    return c.stages;
  });
}
