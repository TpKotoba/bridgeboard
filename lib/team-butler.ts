import type { BridgeEvent } from './model';
import { resultKey } from './model';
import { awardedResult, imps } from './scoring';

type Source = Pick<BridgeEvent, 'kind' | 'rounds' | 'assignments' | 'results' | 'participants'>;
export type ButlerRow = {
  key: string;
  teamId: string;
  names: string[];
  boards: number;
  positive: number;
  negative: number;
  positiveBoards: number;
  negativeBoards: number;
  total: number;
  average: number;
  positiveAverage: number;
  negativeAverage: number;
  ratio: number | null;
  mp: number;
  mpTop: number;
  mpPercent: number;
  totalRank: number;
  averageRank: number;
  ratioRank: number | null;
  mpRank: number;
};

function rank(
  rows: ButlerRow[],
  value: (r: ButlerRow) => number | null,
  field: 'totalRank' | 'averageRank' | 'ratioRank' | 'mpRank',
) {
  const sorted = rows
    .filter((r) => value(r) !== null)
    .sort((a, b) => (value(a) === value(b) ? 0 : value(a)! > value(b)! ? -1 : 1));
  sorted.forEach((r, i) => {
    r[field] =
      i && (value(r) === value(sorted[i - 1]) || Math.abs(value(r)! - value(sorted[i - 1])!) < 1e-9)
        ? sorted[i - 1][field]!
        : i + 1;
  });
}

export function teamButlerStats(event: Source) {
  const rounds: number[] = [];
  const individual = new Map<string, ButlerRow>(),
    pairs = new Map<string, ButlerRow>();
  let missingNames = 0;
  if (event.kind !== 'teams') return { rounds, individual: [], pairs: [], missingNames };
  for (let round = 1; round <= event.rounds; round++) {
    const tables = event.assignments.filter((a) => a.round === round);
    if (
      tables.length &&
      tables.every(
        (a) => a.boards.length && a.boards.every((b) => !!event.results[resultKey(a.id, b)]),
      )
    )
      rounds.push(round);
  }
  const add = (
    map: Map<string, ButlerRow>,
    teamId: string,
    names: string[],
    imp: number,
    mp: number,
    top: number,
  ) => {
    const key = JSON.stringify([teamId, ...names]);
    const row = map.get(key) ?? {
      key,
      teamId,
      names,
      boards: 0,
      positive: 0,
      negative: 0,
      positiveBoards: 0,
      negativeBoards: 0,
      total: 0,
      average: 0,
      positiveAverage: 0,
      negativeAverage: 0,
      ratio: null,
      mp: 0,
      mpTop: 0,
      mpPercent: 0,
      totalRank: 0,
      averageRank: 0,
      ratioRank: null,
      mpRank: 0,
    };
    row.boards++;
    row.total += imp;
    row.mp += mp;
    row.mpTop += top;
    if (imp > 0) {
      row.positive += imp;
      row.positiveBoards++;
    }
    if (imp < 0) {
      row.negative += imp;
      row.negativeBoards++;
    }
    map.set(key, row);
  };
  for (const round of rounds) {
    const tables = event.assignments.filter((a) => a.round === round);
    const boards = new Set(tables.flatMap((a) => a.boards));
    for (const board of boards) {
      const entries = tables
        .filter((a) => a.boards.includes(board))
        .map((a) => ({ a, r: event.results[resultKey(a.id, board)] }))
        .filter(({ r }) => r && r.status !== 'cancelled' && r.status !== 'average');
      if (entries.length < 2) continue;
      // Keep the same untrimmed, nearest-ten datum as the team board results.
      const mean = entries.reduce((sum, { r }) => sum + r.nsScore, 0) / entries.length;
      const datum = Math.sign(mean) * Math.round(Math.abs(mean) / 10) * 10;
      for (const { a, r } of entries)
        for (const side of ['ns', 'ew'] as const) {
          const direction = side === 'ns' ? 1 : -1;
          const score = awardedResult(r, side)!.nsScore * direction;
          const imp = imps(score - datum * direction);
          // Compare each side's award to the other tables in that direction; exclude its own table.
          const mp = entries
            .filter((entry) => entry.a.id !== a.id)
            .reduce((sum, { r: other }) => {
              const reference = awardedResult(other, side)!.nsScore * direction;
              return sum + (score > reference ? 2 : score === reference ? 1 : 0);
            }, 0);
          const top = 2 * (entries.length - 1);
          const seats = side === 'ns' ? (['N', 'S'] as const) : (['E', 'W'] as const);
          const names = seats.map((seat) => a.playerNames?.[seat]?.trim() ?? '');
          for (const name of new Set(names.filter(Boolean)))
            add(individual, a[side], [name], imp, mp, top);
          if (names.every(Boolean) && names[0] !== names[1])
            add(
              pairs,
              a[side],
              names.sort((a, b) => a.localeCompare(b, 'zh-Hant')),
              imp,
              mp,
              top,
            );
          else missingNames++;
        }
    }
  }
  const finish = (map: Map<string, ButlerRow>) => {
    const rows = [...map.values()];
    for (const r of rows) {
      r.average = r.total / r.boards;
      r.positiveAverage = r.positiveBoards ? r.positive / r.positiveBoards : 0;
      r.negativeAverage = r.negativeBoards ? r.negative / r.negativeBoards : 0;
      r.ratio = r.negative ? r.positive / -r.negative : r.positive ? Infinity : null;
      r.mpPercent = (100 * r.mp) / r.mpTop;
    }
    rank(rows, (r) => r.total, 'totalRank');
    rank(rows, (r) => r.average, 'averageRank');
    rank(rows, (r) => r.ratio, 'ratioRank');
    rank(rows, (r) => r.mpPercent, 'mpRank');
    return rows.sort((a, b) => a.averageRank - b.averageRank || a.key.localeCompare(b.key));
  };
  return { rounds, individual: finish(individual), pairs: finish(pairs), missingNames };
}
