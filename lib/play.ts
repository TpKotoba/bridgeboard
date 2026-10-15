import { Board, Result, Seat, seats } from './model';
export const strains = ['S', 'H', 'D', 'C', 'NT'] as const;
export const ranks = '23456789TJQKA';
export function bestDeclarerTricks(values: number[], turn: Seat, declarer: Seat) {
  if (!values.length) return undefined;
  const sameSide = (turn === 'N' || turn === 'S') === (declarer === 'N' || declarer === 'S');
  return sameSide ? Math.max(...values) : Math.min(...values);
}
export type Play = { seat: Seat; card: string };
export type PlayState = {
  hands: Board['deal'];
  trick: Play[];
  lastTrick?: Play[];
  leader: Seat;
  ns: number;
  ew: number;
};
export function visibleHandSeats(perspective: Seat | null, declarer: Seat, state?: PlayState): Seat[] {
  if (!perspective) return [...seats];
  const led = !!state && (state.trick.length > 0 || state.ns + state.ew > 0);
  const dummy = seats[(seats.indexOf(declarer) + 2) % 4];
  return led && dummy !== perspective ? [perspective, dummy] : [perspective];
}
export function rewindToCard(history: PlayState[], seat: Seat, card: string) {
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].hands[seat].includes(card) && !history[i + 1].hands[seat].includes(card))
      return history.slice(0, i + 1);
  }
  return history;
}
export function initialPlay(board: Board, declarer: Seat): PlayState {
  return {
    hands: structuredClone(board.deal),
    trick: [],
    leader: seats[(seats.indexOf(declarer) + 1) % 4],
    ns: 0,
    ew: 0,
  };
}
export function playFromResult(board: Board, result?: Result) {
  return result && result.status !== 'cancelled' && result.level > 0
    ? initialPlay(board, result.declarer)
    : null;
}
export function toPbn(hands: Board['deal']) {
  return (
    'N:' +
    seats
      .map((s) =>
        strains
          .slice(0, 4)
          .map((suit) =>
            hands[s]
              .filter((c) => c[0] === suit)
              .map((c) => c[1])
              .join(''),
          )
          .join('.'),
      )
      .join(' ')
  );
}
export function nextSeat(state: PlayState): Seat {
  return seats[(seats.indexOf(state.leader) + state.trick.length) % 4];
}
export function legalCards(state: PlayState) {
  const hand = state.hands[nextSeat(state)];
  const suit = state.trick[0]?.card[0];
  const follow = hand.filter((c) => c[0] === suit);
  return follow.length ? follow : hand;
}
export function playCard(state: PlayState, card: string, strain: string): PlayState {
  if (!legalCards(state).includes(card)) throw new Error('請依序出牌並跟花');
  const s = structuredClone(state),
    seat = nextSeat(s);
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick.push({ seat, card });
  if (s.trick.length === 4) {
    const led = s.trick[0].card[0];
    const weight = (c: string) =>
      (c[0] === strain ? 100 : c[0] === led ? 50 : 0) + ranks.indexOf(c[1]);
    const winner = s.trick.reduce((best, p) =>
      weight(p.card) > weight(best.card) ? p : best,
    ).seat;
    s.leader = winner;
    s[winner === 'N' || winner === 'S' ? 'ns' : 'ew']++;
    s.lastTrick = s.trick;
    s.trick = [];
  }
  return s;
}
