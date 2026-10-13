import type { BridgeEvent } from './model';
import { resultKey } from './model';

export function roundProgress(
  event: Pick<BridgeEvent, 'currentRound' | 'assignments' | 'results'>,
) {
  const round = event.currentRound ?? 0;
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
