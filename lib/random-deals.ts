import { seats, type Board } from './model';

// Rejection sampling avoids modulo bias in Fisher–Yates shuffle indices.
function randomBelow(limit: number): number {
  const ceiling = 0x100000000 - (0x100000000 % limit);
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= ceiling);
  return sample[0] % limit;
}

export function randomDeals(boards: Omit<Board, 'deal'>[], predeal: Board['deal'] = { N: [], E: [], S: [], W: [] }): Board[] {
  const fixed = new Set(Object.values(predeal).flat());
  return boards.map(board => {
    const deck = ['S', 'H', 'D', 'C'].flatMap(suit => [...'AKQJT98765432'].map(rank => suit + rank)).filter(card => !fixed.has(card));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomBelow(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    let offset = 0;
    return { ...board, deal: Object.fromEntries(seats.map(seat => {
      const count = 13 - predeal[seat].length;
      const hand = [...predeal[seat], ...deck.slice(offset, offset + count)]; offset += count;
      return [seat, hand];
    })) as Board['deal'] };
  });
}
