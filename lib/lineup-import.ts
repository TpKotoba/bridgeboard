import type { BridgeEvent, Seat } from './model';
import { seats } from './model';
import { parseCsv } from './imports';

type Source = Pick<BridgeEvent, 'kind' | 'assignments' | 'participants'>;
export function exportLineups(event: Source) {
  return (
    'assignmentId,N,E,S,W\n' +
    event.assignments
      .map((a) =>
        [a.id, ...seats.map((s) => a.playerNames?.[s] ?? '')]
          .map((v) => `"${v.replaceAll('"', '""')}"`)
          .join(','),
      )
      .join('\n')
  );
}
export function parseLineups(csv: string, event: Source) {
  if (event.kind !== 'teams') throw new Error('入座名單僅適用隊制賽');
  const seen = new Set<string>();
  const updates = parseCsv(csv).map((r, i) => {
    if (!['assignmentId', ...seats].every((key) => Object.hasOwn(r, key)))
      throw new Error('欄位須包含 assignmentId,N,E,S,W');
    if (!event.assignments.some((a) => a.id === r.assignmentId))
      throw new Error(`第 ${i + 2} 列桌次不存在`);
    if (seen.has(r.assignmentId)) throw new Error('同一批資料桌次不可重複');
    seen.add(r.assignmentId);
    const playerNames = Object.fromEntries(seats.map((s) => [s, r[s].trim()])) as Record<
      Seat,
      string
    >;
    if (Object.values(playerNames).some((n) => n.length > 80)) throw new Error('姓名最多 80 字元');
    return { assignmentId: r.assignmentId, playerNames };
  });
  // Validate the final state, allowing atomic swaps between rooms in the same batch.
  const combined = event.assignments.map((a) => ({
    ...a,
    playerNames: updates.find((u) => u.assignmentId === a.id)?.playerNames ?? a.playerNames,
  }));
  const occupied = new Set<string>();
  for (const a of combined)
    for (const seat of seats) {
      const name = a.playerNames?.[seat]?.trim();
      if (!name) continue;
      const team = event.participants.find(
        (p) => p.id === (seat === 'N' || seat === 'S' ? a.ns : a.ew),
      );
      if (!team?.players.split('、').includes(name))
        throw new Error(`${a.id} ${seat} 姓名不在該隊名單`);
      const key = JSON.stringify([a.round, team.id, name]);
      if (occupied.has(key)) throw new Error(`第 ${a.round} 圈 ${name} 重複入座`);
      occupied.add(key);
    }
  return updates;
}
