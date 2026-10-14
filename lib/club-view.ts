import type { BridgeEvent } from './model';
import { resultKey } from './model';
import { project } from './scoring';
import { publicBoards } from './public-event';
import { roundProgress } from './round-progress';

export function audienceEvent(event: BridgeEvent) {
  const { audit, club, ...data } = event;
  const visible = club?.enabled ? new Set(event.assignments.filter(a => club.finalized.includes(a.round)).map(a => a.id)) : null;
  const results = visible ? Object.fromEntries(Object.entries(data.results).filter(([, r]) => visible.has(r.assignmentId))) : data.results;
  const safe = { ...data, results };
  // A board can recur in later rounds: keep its deal private until every scheduled use is settled.
  const boards = publicBoards(event).map(b => {
    if (club?.enabled && event.assignments.some(a => a.boards.includes(b.number) && !club.finalized.includes(a.round))) {
      const { deal, ...rest } = { ...b, deal: undefined };
      return { ...rest, published: false };
    }
    return b;
  });
  return { ...safe, boards, collectionProgress: roundProgress(event), projection: project({ ...event, results }) };
}

export function clubView(event: BridgeEvent, pair: string) {
  const round = event.currentRound ?? 0;
  const assignment = event.assignments.find(a => a.round === round && (a.ns === pair || a.ew === pair));
  return {
    id: event.id, name: [event.prefix, event.name].filter(Boolean).join(' '), pair,
    pairName: event.participants.find(p => p.id === pair)?.name ?? pair,
    round, phase: event.roundPhase, status: event.status,
    locked: !!event.club?.confirmations[round + ':' + pair],
    finalized: event.club?.finalized.includes(round) ?? false,
    assignment,
    names: assignment ? { ns: event.participants.find(p => p.id === assignment.ns)?.name, ew: event.participants.find(p => p.id === assignment.ew)?.name } : null,
    confirmations: assignment ? [assignment.ns, assignment.ew].map(id => ({ pair: id, confirmed: !!event.club?.confirmations[round + ':' + id] })) : [],
    boards: assignment ? event.boards.filter(b => assignment.boards.includes(b.number)).map(b => ({ number: b.number, dealer: b.dealer, vulnerability: b.vulnerability, result: event.results[resultKey(assignment.id, b.number)] ?? null })) : [],
  };
}
export type ClubView = ReturnType<typeof clubView>;
