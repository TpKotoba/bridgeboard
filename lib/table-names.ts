import type { Assignment, Kind, Participant, Seat } from './model';

function splitPairNames(value: string) {
  const text = value.trim();
  const names = text
    .split(/\s*[/／、,，;；\n&＆]\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 2) return names;
  // Accept two space-separated Chinese names without splitting an English full name.
  const chinesePair = text.match(/^(\p{Script=Han}{2,6})[\t \u3000]+(\p{Script=Han}{2,6})$/u);
  return chinesePair ? [chinesePair[1], chinesePair[2]] : names;
}

export function tableNames(
  kind: Kind,
  participants: Participant[],
  assignment?: Assignment,
): Partial<Record<Seat, string>> {
  if (!assignment) return {};
  const names: Partial<Record<Seat, string>> = {};
  for (const [id, directions] of [
    [assignment.ns, ['N', 'S']],
    [assignment.ew, ['E', 'W']],
  ] as const) {
    const participant = participants.find((p) => p.id === id);
    if (!participant) continue;
    // A team roster does not establish the room's actual seating.
    const pair =
      kind === 'pairs' ? splitPairNames(participant.players.trim() || participant.name) : [];
    directions.forEach((seat, index) => {
      names[seat] = pair.length === 2 ? pair[index] : participant.name;
    });
  }
  return { ...names, ...Object.fromEntries(Object.entries(assignment.playerNames ?? {}).filter(([, name]) => name)) };
}
