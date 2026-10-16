import { parseCsv } from './imports';
import type { BridgeEvent } from './model';

export function parseRoundTimes(text: string, event: Pick<BridgeEvent, 'rounds' | 'date'>) {
  const rows = parseCsv(text), seen = new Set<number>();
  if (!rows.length) throw new Error('請輸入至少一圈時間');
  function time(value: string) {
    const local = /^\d{2}:\d{2}$/.test(value) ? `${event.date} ${value}` : value;
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(local)) throw new Error('時間請使用 HH:mm 或 YYYY-MM-DD HH:mm（臺灣時間）');
    const normalized = local.replace(' ', 'T');
    const parsed = new Date(`${normalized}+08:00`);
    if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 8 * 3600000).toISOString().slice(0, 16) !== normalized)
      throw new Error('日期或時間不正確');
    return parsed.toISOString();
  }
  return rows.map(row => {
    if (row.round === undefined || row.startAt === undefined || row.endAt === undefined) throw new Error('欄位需為 round,startAt,endAt');
    const round = Number(row.round);
    if (!Number.isInteger(round) || round < 1 || round > event.rounds) throw new Error('圈數超過賽程範圍');
    if (seen.has(round)) throw new Error(`第 ${round} 圈重複`);
    seen.add(round);
    const start = row.startAt.trim(), end = row.endAt.trim();
    if (!start !== !end) throw new Error('開始與結束時間需一起填寫或一起清除');
    const startAt = start ? time(start) : null, endAt = end ? time(end) : null;
    if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) throw new Error('結束時間必須晚於開始時間');
    return { round, startAt, endAt };
  });
}

export function exportRoundTimes(event: Pick<BridgeEvent, 'rounds' | 'roundTimes'>) {
  const local = (value?: string) => value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '';
  return ['round,startAt,endAt', ...Array.from({ length: event.rounds }, (_, i) => {
    const timing = event.roundTimes?.[i + 1];
    return `${i + 1},${local(timing?.startAt)},${local(timing?.endAt)}`;
  })].join('\n');
}
