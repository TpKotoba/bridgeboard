import type { Board } from './model';

export function boardGroups<T extends Pick<Board, 'number' | 'group'>>(boards: T[], size: number) {
  const groups = new Map<string, T[]>();
  [...boards]
    .sort((a, b) => a.number - b.number)
    .forEach((board, index) => {
      const key = board.group
        ? `explicit:${board.group}`
        : `auto:${Math.floor(index / Math.max(1, size))}`;
      groups.set(key, [...(groups.get(key) ?? []), board]);
    });
  return [...groups.values()];
}

export function boardRange(numbers: number[]) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = i;
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(
      i - start >= 2 ? `${sorted[start]}-${sorted[i]}` : sorted.slice(start, i + 1).join(','),
    );
  }
  return parts.join(',');
}
