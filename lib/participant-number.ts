import type { Kind } from './model';

/** Display numbers without changing persisted participant IDs. */
export function participantNumber(id: string, kind: Kind): string {
  return kind === 'teams' ? id.toUpperCase().replace(/^P(?=\d+$)/, 'T') : id.toUpperCase();
}
