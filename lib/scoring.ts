import {
  BridgeEvent,
  Projection,
  ResultInput,
  Result,
  Standing,
  Vulnerability,
  Trim,
  resultKey,
} from './model';
// Assigned scores remain in NS coordinates; the side selects the awarded contract.
export function awardedResult(result: Result | undefined, side: 'ns' | 'ew'): Result | undefined {
  return result?.split && result.status !== 'cancelled' && result.status !== 'average'
    ? { ...result, ...result.split[side] } : result;
}
export function teamBoardImps(open: Result, closed: Result): [number, number] {
  if (open.status === 'cancelled' || closed.status === 'cancelled' || open.status === 'average' || closed.status === 'average') return [0, 0];
  return [imps(awardedResult(open, 'ns')!.nsScore - awardedResult(closed, 'ew')!.nsScore),
    imps(awardedResult(closed, 'ns')!.nsScore - awardedResult(open, 'ew')!.nsScore)];
}
export function trimScores(values: number[], trim: Trim = 'none') {
  const ordered = [...values].sort((a, b) => a - b);
  const n =
    values.length < 3
      ? 0
      : trim === 'one'
        ? 1
        : trim === 'ten-percent'
          ? Math.floor(values.length / 10)
          : 0;
  return n ? ordered.slice(n, -n) : ordered;
}
export function teamStandingsThroughRound(
  event: Pick<BridgeEvent, 'participants' | 'penalties'> & { projection: Projection },
  round: number,
) {
  const rows = event.participants.map(p => ({ ...p, score: -(event.penalties?.[p.id] ?? 0), rank: 0 }));
  for (const match of event.projection.matches.filter(m => m.round <= round)) {
    if (match.vpA === null || match.vpB === null) continue;
    rows.find(p => p.id === match.a)!.score += match.vpA;
    rows.find(p => p.id === match.b)!.score += match.vpB;
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-Hant'));
  rows.forEach((row, i) => {
    row.rank = i > 0 && Math.abs(row.score - rows[i - 1].score) < 1e-8 ? rows[i - 1].rank : i + 1;
  });
  return rows;
}
export function impPairScore(
  score: number,
  all: number[],
  index: number,
  method: 'crossimp' | 'butler',
  trim: Trim,
) {
  if (all.length < 2) return { value: null, datum: undefined };
  const sample = trimScores(method === 'butler' ? all : all.filter((_, i) => i !== index), trim);
  if (method === 'crossimp')
    return {
      value: sample.reduce((n, x) => n + imps(score - x), 0) / sample.length,
      datum: undefined,
    };
  const mean = sample.reduce((n, x) => n + x, 0) / sample.length;
  const datum = Math.sign(mean) * Math.round(Math.abs(mean) / 10) * 10;
  return { value: imps(score - datum), datum };
}
const thresholds = [
  20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000,
  2250, 2500, 3000, 3500, 4000,
];
export function imps(difference: number) {
  return Math.sign(difference) * thresholds.filter((t) => Math.abs(difference) >= t).length;
}
export function miniGameLevel(strain: ResultInput['strain']) {
  return strain === 'NT' ? 3 : strain === 'H' || strain === 'S' ? 4 : 5;
}
export function contractScore(r: ResultInput, vulnerability: Vulnerability, miniBridge = r.miniBridge ?? false): number {
  if (miniBridge && (r.doubled !== 1 || (r.level !== 1 && r.level !== miniGameLevel(r.strain)))) {
    throw new Error('MiniBridge 僅接受一線或成局合約，不可 Pass、加倍或再加倍');
  }
  if (r.level === 0) return 0;
  const ns = r.declarer === 'N' || r.declarer === 'S';
  const vul = !miniBridge && (vulnerability === 'All' || vulnerability === (ns ? 'NS' : 'EW'));
  const over = r.tricks - r.level - 6;
  let score: number;
  if (over < 0) {
    const down = -over;
    let penalty = down * (vul ? 100 : 50);
    if (r.doubled > 1)
      penalty =
        (vul
          ? 200 + Math.max(0, down - 1) * 300
          : 100 + Math.min(2, down - 1) * 200 + Math.max(0, down - 3) * 300) *
        (r.doubled / 2);
    score = -penalty;
  } else {
    const minor = r.strain === 'C' || r.strain === 'D';
    const trickPoints = (r.level * (minor ? 20 : 30) + (r.strain === 'NT' ? 10 : 0)) * r.doubled;
    score = trickPoints + (trickPoints >= 100 ? (vul ? 500 : 300) : 50);
    score +=
      r.doubled === 1 ? over * (minor ? 20 : 30) : over * (vul ? 200 : 100) * (r.doubled / 2);
    if (r.doubled > 1) score += 50 * (r.doubled / 2);
    if (r.level === 6) score += vul ? 750 : 500;
    if (r.level === 7) score += vul ? 1500 : 1000;
  }
  return score * (ns ? 1 : -1);
}
const vpTables = new Map<number, number[]>();
// WBF continuous 20–0 scale, including the official 0.01 concavity correction.
// https://www.worldbridge.org/wp-content/uploads/2019/06/VP-Scale-Functiondetails.pdf
export function vp(margin: number, boards: number): number {
  if (boards < 1) throw new Error('牌數必須大於零');
  if (!vpTables.has(boards)) {
    const tau = (Math.sqrt(5) - 1) / 2,
      blitz = 15 * Math.sqrt(boards);
    const table = Array.from({ length: Math.ceil(blitz) + 2 }, (_, i) =>
      Math.round(Math.min(20, 10 + (10 * (1 - tau ** ((3 * i) / blitz))) / (1 - tau ** 3)) * 100),
    );
    for (let pass = 0; pass < 100; pass++) {
      let changed = false;
      for (let i = 1; i < table.length - 1; i++)
        if (table[i + 1] - table[i] > table[i] - table[i - 1]) {
          table[i]++;
          changed = true;
        }
      if (!changed) break;
    }
    vpTables.set(boards, table);
  }
  const table = vpTables.get(boards)!;
  const win = table[Math.min(Math.abs(margin), table.length - 1)] / 100;
  return margin >= 0 ? win : Math.round((20 - win) * 100) / 100;
}
type ProjectionInput = Pick<BridgeEvent, 'kind' | 'participants' | 'assignments' | 'results' | 'pairMethod' | 'trim' | 'penalties'> & { boards: { number: number }[] };

export function pairStandingsBeforeRound(event: ProjectionInput, round: number): Standing[] {
  const assignments = event.assignments.filter(a => a.round < round);
  const ids = new Set(assignments.map(a => a.id));
  const results = Object.fromEntries(Object.entries(event.results).filter(([, r]) => ids.has(r.assignmentId)));
  return project({ ...event, assignments, results }).standings;
}

export function project(e: ProjectionInput): Projection {
  const standing: Standing[] = e.participants.map((p) => ({
    ...p,
    rank: 0,
    score: e.kind === 'teams' ? 0 : null,
    secondary: 0,
    played: 0,
    total: 0,
  }));
  const byId = Object.fromEntries(standing.map((s) => [s.id, s]));
  const projection: Projection = {
    standings: standing,
    matches: [],
    pairScores: {},
    received: Object.keys(e.results).length,
    expected: e.assignments.reduce((n, a) => n + a.boards.length, 0),
  };
  for (const a of e.assignments) for (const id of [a.ns, a.ew]) byId[id].total += a.boards.length;
  if (e.kind === 'teams') {
    for (const open of e.assignments.filter((a) => a.room === 'open')) {
      const closed = e.assignments.find((a) => a.matchId === open.matchId && a.room === 'closed');
      if (!closed) continue;
      const match = {
        id: open.matchId,
        round: open.round,
        a: open.ns,
        b: open.ew,
        impsA: 0,
        impsB: 0,
        marginA: 0,
        marginB: 0,
        split: false,
        completed: 0,
        total: open.boards.length,
        vpA: null as number | null,
        vpB: null as number | null,
      };
      let cancelled = 0;
      for (const board of open.boards) {
        const x = e.results[resultKey(open.id, board)],
          y = e.results[resultKey(closed.id, board)];
        if (x?.status === 'cancelled' || y?.status === 'cancelled') {
          cancelled++;
          match.completed++;
          continue;
        }
        if (!x || !y) continue;
        // An imported artificial average is 0 IMP; it still counts toward VP board count.
        if (x.status === 'average' || y.status === 'average') {
          match.completed++;
          continue;
        }
        const [imp, otherImp] = teamBoardImps(x, y);
        match.marginA += imp;
        match.marginB += otherImp;
        match.split ||= !!(x.split || y.split);
        match.impsA += Math.max(0, imp);
        match.impsB += Math.max(0, otherImp);
        match.completed++;
      }
      for (const id of [match.a, match.b]) byId[id].played += match.completed;
      if (match.completed === match.total && cancelled < match.total) {
        match.vpA = vp(match.marginA, match.total);
        match.vpB = vp(match.marginB, match.total);
        byId[match.a].score! += match.vpA;
        byId[match.b].score! += match.vpB;
        byId[match.a].secondary += match.marginA;
        byId[match.b].secondary += match.marginB;
      }
      projection.matches.push(match);
    }
    for (const row of standing) row.total /= 2;
  } else {
    const totals: Record<string, { mp: number; top: number }> = Object.fromEntries(
      standing.map((s) => [s.id, { mp: 0, top: 0 }]),
    );
    for (const board of e.boards) {
      const assignments = e.assignments.filter((a) => a.boards.includes(board.number));
      const entries = assignments
        .map((a) => ({ a, r: e.results[resultKey(a.id, board.number)] }))
        .filter((x) => x.r && x.r.status !== 'cancelled');
      for (const a of assignments)
        if (e.results[resultKey(a.id, board.number)]?.status === 'cancelled') {
          byId[a.ns].played++;
          byId[a.ew].played++;
          projection.pairScores[resultKey(a.id, board.number)] = {
            ns: null,
            ew: null,
            top: 0,
            provisional: false,
            cancelled: true,
          };
        }
      const top = 2 * (entries.length - 1);
      for (const [index, { a, r }] of entries.entries()) {
        byId[a.ns].played++;
        byId[a.ew].played++;
        let ns =
          top <= 0
            ? null
            : entries.reduce(
                (mp, x) => mp + (r.nsScore > x.r.nsScore ? 2 : r.nsScore === x.r.nsScore ? 1 : 0),
                -1,
              );
        const method = e.pairMethod ?? 'mp';
        const imp =
          method === 'mp'
            ? undefined
            : impPairScore(
                r.nsScore,
                entries.map((x) => x.r.nsScore),
                index,
                method,
                e.trim ?? 'none',
              );
        if (imp) ns = imp.value;
        const ew = ns === null ? null : method === 'mp' ? top - ns : -ns;
        projection.pairScores[resultKey(a.id, board.number)] = {
          ns,
          ew,
          top: Math.max(0, top),
          provisional: assignments.some((a) => !e.results[resultKey(a.id, board.number)]),
          datum: imp?.datum,
        };
        if (ns !== null && ew !== null) {
          totals[a.ns].mp += ns;
          totals[a.ns].top += method === 'mp' ? top : 1;
          totals[a.ew].mp += ew;
          totals[a.ew].top += method === 'mp' ? top : 1;
        }
      }
    }
    for (const row of standing) {
      const t = totals[row.id];
      row.score = t.top
        ? e.pairMethod && e.pairMethod !== 'mp'
          ? t.mp
          : (100 * t.mp) / t.top
        : null;
      row.secondary = t.mp;
    }
  }
  for (const row of standing) {
    row.penalty = e.penalties?.[row.id] ?? 0;
    if (row.score !== null) row.score -= row.penalty;
  }
  // Tied scores share ranks; names only provide stable display order.
  standing.sort(
    (a, b) =>
      (a.score === null ? (b.score === null ? 0 : 1) : b.score === null ? -1 : b.score - a.score) ||
      a.name.localeCompare(b.name, 'zh-Hant'),
  );
  let rank = 0;
  for (let i = 0; i < standing.length; i++) {
    const s = standing[i];
    if (
      i === 0 ||
      (s.score === null) !== (standing[i - 1].score === null) ||
      Math.abs((s.score ?? 0) - (standing[i - 1].score ?? 0)) > 1e-8
    )
      rank = i + 1;
    s.rank = rank;
  }
  return projection;
}
