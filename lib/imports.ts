import {
  Assignment,
  Board,
  BridgeEvent,
  ResultInput,
  resultSchema,
  Seat,
  seats,
  Vulnerability,
} from './model';
export function parseCsv(text: string): Record<string, string>[] {
  if (text.length > 200000) throw new Error('CSV 超過 200 KB 上限');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quote = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quote && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      row.push(cell.trim());
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quote) throw new Error('CSV 引號未閉合');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('CSV 需包含標題與至少一筆資料');
  const header = rows.shift()!;
  if (new Set(header).size !== header.length) throw new Error('CSV 標題不可重複');
  return rows.map((r, i) => {
    if (r.length !== header.length) throw new Error(`第 ${i + 2} 列欄位數不正確`);
    return Object.fromEntries(header.map((h, j) => [h, r[j]]));
  });
}
export function parseResultsCsv(text: string): ResultInput[] {
  return parseCsv(text).map((r, i) => {
    if (r.status && r.status !== 'played')
      throw new Error(`第 ${i + 2} 列：Cancelled 請由裁判在後台裁定，不能用一般 CSV 收分匯入`);
    for (const key of ['assignmentId', 'board', 'level', 'strain', 'doubled', 'declarer', 'tricks'])
      if (!r[key]?.trim()) throw new Error(`第 ${i + 2} 列：${key} 不可空白`);
    const parsed = resultSchema.safeParse({
      assignmentId: r.assignmentId,
      board: Number(r.board),
      level: Number(r.level),
      strain: r.strain,
      doubled: Number(r.doubled),
      declarer: r.declarer,
      tricks: Number(r.tricks),
      lead: r.lead ?? '',
    });
    if (!parsed.success) throw new Error(`第 ${i + 2} 列：${parsed.error.issues[0].message}`);
    return parsed.data;
  });
}
export const resultsCsvHeader =
  'assignmentId,board,level,strain,doubled,declarer,tricks,lead,status';
function csvCell(s: unknown) {
  const v = String(s);
  return /^[=+@\-]/.test(v) && typeof s === 'string'
    ? `"'${v.replaceAll('"', '""')}"`
    : `"${v.replaceAll('"', '""')}"`;
}
export function exportResultsCsv(e: BridgeEvent) {
  return (
    resultsCsvHeader +
    '\n' +
    Object.values(e.results)
      .map((r) =>
        [
          r.assignmentId,
          r.board,
          r.level,
          r.strain,
          r.doubled,
          r.declarer,
          r.tricks,
          r.lead,
          r.status ?? 'played',
        ]
          .map(csvCell)
          .join(','),
      )
      .join('\n')
  );
}
export function exportMovement(e: BridgeEvent) {
  return (
    'round,table,ns,ew,boards\n' +
    e.assignments
      .map((a) => [a.round, a.table, a.ns, a.ew, a.boards.join(';')].map(csvCell).join(','))
      .join('\n')
  );
}
export function parseMovement(text: string, e: BridgeEvent): Assignment[] {
  const rows = parseCsv(text),
    assignments: Assignment[] = [];
  const occupied = new Set<string>(),
    played = new Set<string>(),
    tables = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const round = Number(r.round),
      tableLabel = (r.table ?? '').trim(),
      table = /^\d+$/.test(tableLabel) ? Number(tableLabel) : tableLabel,
      boards = (r.boards ?? '').split(';').map(Number);
    if (
      !Number.isInteger(round) ||
      round < 1 ||
      round > e.rounds ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(tableLabel) ||
      (typeof table === 'number' && (!Number.isSafeInteger(table) || table < 1))
    )
      throw new Error(`第 ${i + 2} 列輪次或桌號錯誤`);
    if (r.ns === r.ew || ![r.ns, r.ew].every((id) => e.participants.some((p) => p.id === id)))
      throw new Error(`第 ${i + 2} 列搭檔編號錯誤`);
    if (
      boards.length !== e.boardsPerRound ||
      new Set(boards).size !== boards.length ||
      boards.some((n) => !e.boards.some((b) => b.number === n))
    )
      throw new Error(`第 ${i + 2} 列牌組錯誤`);
    const tableKey = `${round}:${table}`;
    if (tables.has(tableKey)) throw new Error('同一輪桌號重複');
    tables.add(tableKey);
    for (const id of [r.ns, r.ew]) {
      const pos = `${round}:${id}`;
      if (occupied.has(pos)) throw new Error('同一輪搭檔被安排至多桌');
      occupied.add(pos);
      for (const b of boards) {
        const k = `${id}:${b}`;
        if (played.has(k)) throw new Error('搭檔被安排重複打同一副牌');
        played.add(k);
      }
    }
    assignments.push({
      id: `r${round}t${table}`,
      matchId: `r${round}t${table}`,
      round,
      table,
      room: 'pairs',
      ns: r.ns,
      ew: r.ew,
      boards,
    });
  }
  for (let round = 1; round <= e.rounds; round++)
    if (
      assignments.filter((a) => a.round === round).length !== Math.floor(e.participants.length / 2)
    )
      throw new Error(`第 ${round} 輪桌次不完整`);
  if (e.boards.some((b) => !assignments.some((a) => a.boards.includes(b.number))))
    throw new Error('有牌號未排入賽程');
  if (e.boards.some((b) => assignments.filter((a) => a.boards.includes(b.number)).length < 2))
    throw new Error('每副牌至少需兩桌結果才可比較 MP');
  return assignments;
}
export function parsePbn(text: string): Board[] {
  const records = text
    .replace(/\r/g, '')
    .split(/(?=\[Board\s+")/)
    .filter((s) => /^\[Board\s+"/.test(s));
  if (!records.length) throw new Error('找不到 PBN Board 標籤');
  const numbers = new Set<number>();
  return records.map((record) => {
    const tag = (name: string) => record.match(new RegExp(`\\[${name}\\s+"([^"]*)"\\]`))?.[1];
    const number = Number(tag('Board')),
      group = tag('BridgeboardGroup'),
      dealer = tag('Dealer') as Seat,
      vulnerability = tag('Vulnerable') as Vulnerability;
    if (
      !Number.isInteger(number) ||
      number < 1 ||
      numbers.has(number) ||
      !seats.includes(dealer) ||
      !['None', 'NS', 'EW', 'All'].includes(vulnerability)
    )
      throw new Error('PBN 牌號、發牌者或身價錯誤／重複');
    numbers.add(number);
    if (group !== undefined && (!group.trim() || group.length > 40))
      throw new Error(`牌 ${number} 的 BridgeboardGroup 必須為 1–40 字元`);
    const raw = tag('Deal')?.match(/^([NESW]):(.+)$/);
    if (!raw) throw new Error(`牌 ${number} 缺少完整 Deal`);
    const hands = raw[2].trim().split(/\s+/);
    if (hands.length !== 4) throw new Error(`牌 ${number} 需四家手牌`);
    const deal = {} as Board['deal'];
    hands.forEach((h, i) => {
      const suits = h.split('.');
      if (suits.length !== 4) throw new Error('手牌需以 S.H.D.C 表示');
      const cards = suits.flatMap((r, j) =>
        r
          .replaceAll('-', '')
          .split('')
          .map((rank) => {
            if (!'AKQJT98765432'.includes(rank)) throw new Error('PBN 點數格式錯誤');
            return ['S', 'H', 'D', 'C'][j] + rank;
          }),
      );
      if (cards.length !== 13) throw new Error('每家必須十三張牌');
      deal[seats[(seats.indexOf(raw[1] as Seat) + i) % 4]] = cards;
    });
    if (new Set(Object.values(deal).flat()).size !== 52) throw new Error('牌型包含重複牌');
    return { number, ...(group === undefined ? {} : { group: group.trim() }), dealer, vulnerability, deal };
  });
}
export function exportPbn(e: Pick<BridgeEvent, 'boards'>) {
  return e.boards
    .filter((b) => b.deal.N.length === 13)
    .map(
      (b) =>
        `[Board "${b.number}"]${b.group ? `\n[BridgeboardGroup "${b.group}"]` : ''}\n[Dealer "${b.dealer}"]\n[Vulnerable "${b.vulnerability}"]\n[Deal "N:${seats
          .map((s) =>
            ['S', 'H', 'D', 'C']
              .map((suit) =>
                b.deal[s]
                  .filter((c) => c[0] === suit)
                  .map((c) => c[1])
                  .sort((a, b) => 'AKQJT98765432'.indexOf(a) - 'AKQJT98765432'.indexOf(b))
                  .join(''),
              )
              .join('.'),
          )
          .join(' ')}"]`,
    )
    .join('\n\n');
}
