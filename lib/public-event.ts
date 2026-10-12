import { BridgeEvent } from './model';
export function publicBoards(event: BridgeEvent) {
  return event.boards.map((b) => {
    const published = b.published ?? event.publishBoards;
    if (published) return { ...b, published };
    const { deal, ...rest } = b;
    void deal;
    return { ...rest, published: false };
  });
}
