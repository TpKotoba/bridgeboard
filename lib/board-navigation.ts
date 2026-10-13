import type { BridgeEvent } from './model';
export function boardRounds(event: Pick<BridgeEvent, 'rounds' | 'assignments'>) {
  return Array.from({ length: event.rounds }, (_, index) => ({
    round: index + 1,
    boards: [
      ...new Set(event.assignments.filter((a) => a.round === index + 1).flatMap((a) => a.boards)),
    ].sort((a, b) => a - b),
  }));
}
