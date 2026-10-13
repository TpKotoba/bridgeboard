import type { Board, Seat } from './model';
import { strains } from './play';

export function formatParContract(contract: string) {
  const match = contract.match(/^([1-7](?:NT|[CDHSN]))(\*{1,2}|X{1,2})?-([NESW]{1,2})([+-]\d+)?$/);
  if (!match) return contract;
  const [, bid, doubled = '', seat, result = ''] = match;
  const displayBid = bid.replace(
    /NT|[CDHSN]/,
    (suit) => ({ C: '♣', D: '♦', H: '♥', S: '♠', N: 'NT', NT: 'NT' })[suit]!,
  );
  return `${displayBid}${doubled.replace(/\*/g, 'X')}.${seat}${result ? `/${result}` : ''}`;
}

export function highCardPoints(cards: string[]) {
  return cards.reduce((sum, card) => sum + ({ A: 4, K: 3, Q: 2, J: 1 }[card[1]] ?? 0), 0);
}

export function lawOfTotalTricks(board: Board, table: number[][]) {
  const partnerships: [Seat, Seat][] = [
    ['N', 'S'],
    ['E', 'W'],
  ];
  const seatIndex: Record<Seat, number> = { N: 0, E: 1, S: 2, W: 3 };
  const choices = partnerships.map(
    ([a, b]) =>
      strains
        .slice(0, 4)
        .map((suit, index) => ({
          fit: [...board.deal[a], ...board.deal[b]].filter((card) => card[0] === suit).length,
          tricks: Math.max(table[index][seatIndex[a]], table[index][seatIndex[b]]),
          suit,
        }))
        .sort((x, y) => y.fit - x.fit || y.tricks - x.tricks)[0],
  );
  const fit = choices[0].fit + choices[1].fit;
  const tricks = choices[0].tricks + choices[1].tricks;
  return { fit, tricks, difference: fit - tricks, suits: choices.map((c) => c.suit) };
}
