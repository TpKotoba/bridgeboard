import type { BridgeEvent } from './model';
export function displayedBoardNumber(number: number, event?: Pick<BridgeEvent, 'kind' | 'maxBoardNumber'>) {
  const maximum = event?.maxBoardNumber ?? (event?.kind === 'pairs' ? 0 : 32);
  return maximum === 0 ? number : (number - 1) % maximum + 1;
}
export function boardRounds(event: Pick<BridgeEvent, 'rounds' | 'assignments'>) {
  return Array.from({ length: event.rounds }, (_, index) => ({
    round: index + 1,
    boards: [
      ...new Set(event.assignments.filter((a) => a.round === index + 1).flatMap((a) => a.boards)),
    ].sort((a, b) => a - b),
  }));
}
