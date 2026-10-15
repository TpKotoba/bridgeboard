import type { Assignment, BridgeEvent } from './model';
import { resultKey } from './model';

export function clubRoles(event: Pick<BridgeEvent, 'club'>, assignment: Assignment) {
  const override = event.club?.inputOverrides?.[assignment.id];
  const rule = event.club?.inputRule ?? 'ns';
  const lower = assignment.ns.localeCompare(assignment.ew, 'en', { numeric: true }) < 0 ? assignment.ns : assignment.ew;
  const inputPair = override === assignment.ns || override === assignment.ew ? override
    : rule === 'ew' ? assignment.ew
    : rule === 'lower' ? lower
    : rule === 'higher' ? (lower === assignment.ns ? assignment.ew : assignment.ns)
    : assignment.ns;
  return { inputPair, confirmPair: inputPair === assignment.ns ? assignment.ew : assignment.ns };
}

// Bind approval to this table's roles and exact results, not unrelated table updates.
export function clubReviewVersion(event: Pick<BridgeEvent, 'club' | 'results'>, assignment: Assignment) {
  return JSON.stringify([assignment.id, clubRoles(event, assignment), assignment.boards.map(b => {
    const r = event.results[resultKey(assignment.id, b)];
    return r ? [b, r.level, r.strain, r.declarer, r.doubled, r.tricks, r.lead, r.status, r.nsScore, r.updatedAt] : [b];
  })]);
}

export function clubAccepted(event: Pick<BridgeEvent, 'club' | 'results'>, assignment: Assignment) {
  const { confirmPair } = clubRoles(event, assignment);
  const confirmation = event.club?.confirmations[`${assignment.round}:${confirmPair}`];
  return assignment.boards.every(b => !!event.results[resultKey(assignment.id, b)]) &&
    confirmation?.reviewVersion === clubReviewVersion(event, assignment);
}
