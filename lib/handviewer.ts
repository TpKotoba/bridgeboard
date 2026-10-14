import type { Board } from './model';

// BBO's documented handviewer parameters: https://www.bridgebase.com/tools/hvdoc.html
export function handviewerUrl(board: Board): string {
  const params = new URLSearchParams({
    a: '?',
    b: String(board.number),
    d: board.dealer.toLowerCase(),
    v: { None: '-', NS: 'n', EW: 'e', All: 'b' }[board.vulnerability],
  });
  for (const seat of ['N', 'E', 'S', 'W'] as const) {
    params.set(seat.toLowerCase(), ['S', 'H', 'D', 'C'].map((suit) =>
      suit + board.deal[seat].filter((card) => card[0] === suit).map((card) => card[1]).join(''),
    ).join(''));
  }
  return `https://www.bridgebase.com/tools/handviewer.html?${params}`;
}
