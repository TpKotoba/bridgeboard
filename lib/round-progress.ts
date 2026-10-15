import type { BridgeEvent } from './model';
import { resultKey } from './model';

export function allRoundsComplete(event: Pick<BridgeEvent, 'rounds' | 'assignments' | 'results' | 'club'>) {
  return Array.from({ length: event.rounds }, (_, i) => i + 1).every(round => {
    const tables = event.assignments.filter(a => a.round === round);
    return tables.length > 0 && tables.every(a => a.boards.length > 0 &&
      a.boards.every(b => !!event.results[resultKey(a.id, b)])) &&
      (!event.club?.enabled || event.club.finalized.includes(round));
  });
}

export function roundProgress(
  event: Pick<BridgeEvent, 'currentRound' | 'assignments' | 'results'>,
) {
  const round = event.currentRound || Math.max(0, ...event.assignments
    .filter(a => a.boards.some(b => !!event.results[resultKey(a.id, b)]))
    .map(a => a.round));
  const tables = event.assignments
    .filter((a) => a.round === round)
    .map((assignment) => {
      const expected = assignment.boards.length;
      const received = assignment.boards.filter(
        (b) => !!event.results[resultKey(assignment.id, b)],
      ).length;
      return { assignment, received, expected, ratio: expected ? received / expected : 1 };
    });
  const unfinished = tables.filter((table) => table.received < table.expected);
  const lowest = Math.min(...unfinished.map((table) => table.ratio));
  return {
    round,
    received: tables.reduce((sum, table) => sum + table.received, 0),
    expected: tables.reduce((sum, table) => sum + table.expected, 0),
    slowest: unfinished.filter((table) => table.ratio === lowest),
  };
}
