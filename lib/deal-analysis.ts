import type { Board, Seat } from './model';
import { strains } from './play';

export function highestParContract(contracts: string[], dealer?: Seat) {
  const rank = (contract: string) => {
    const match = contract.match(/^([1-7])(NT|[CDHSN])/);
    return match
      ? Number(match[1]) * 5 + ['C', 'D', 'H', 'S', 'N'].indexOf(match[2].replace('NT', 'N'))
      : -1;
  };
  const highest = contracts.reduce<string | undefined>(
    (best, contract) => (best === undefined || rank(contract) > rank(best) ? contract : best),
    undefined,
  );
  return highest ? formatParContract(highest, dealer) : 'Pass out';
}

export function formatParContract(contract: string, dealer?: Seat) {
  const match = contract.match(/^([1-7](?:NT|[CDHSN]))(\*{1,2}|X{1,2})?-([NESW]{1,2})([+-]\d+)?$/);
  if (!match) return contract;
  const [, bid, doubled = '', seat, result = ''] = match;
  const order = 'NESW';
  const start = dealer ? order.indexOf(dealer) : 0;
  const declarer = dealer && ['NS', 'SN', 'EW', 'WE'].includes(seat)
    ? Array.from({ length: 4 }, (_, i) => order[(start + i) % 4]).find((s) => seat.includes(s))!
    : seat;
  const displayBid = bid.replace(
    /NT|[CDHSN]/,
    (suit) => ({ C: '♣', D: '♦', H: '♥', S: '♠', N: 'NT', NT: 'NT' })[suit]!,
  );
  return `${displayBid}${doubled.replace(/\*/g, 'x').toLowerCase()}.${declarer}${result ? `/${result}` : ''}`;
}

export function fullParContracts(contracts: string[]): string[] {
  return contracts.length
    ? contracts.map((contract) => formatParContract(contract).replace('.', ' ').replace('/', ' '))
    : ['Pass out'];
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
