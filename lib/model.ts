import { z } from 'zod';
export const seats = ['N', 'E', 'S', 'W'] as const;
export type Seat = (typeof seats)[number];
export type Kind = 'teams' | 'pairs';
export type PairMethod = 'mp' | 'crossimp' | 'butler';
export type Trim = 'none' | 'one' | 'ten-percent';
export type Vulnerability = 'None' | 'NS' | 'EW' | 'All';
export type Participant = { id: string; name: string; players: string };
export type Board = {
  number: number;
  group?: string;
  dealer: Seat;
  vulnerability: Vulnerability;
  deal: Record<Seat, string[]>;
  published?: boolean;
};
export type Assignment = {
  id: string;
  round: number;
  table: number | string;
  room: 'open' | 'closed' | 'pairs';
  ns: string;
  ew: string;
  boards: number[];
  matchId: string;
};
export const resultSchema = z
  .object({
    assignmentId: z.string().min(1).max(100),
    board: z.number().int().min(1).max(128),
    level: z.number().int().min(0).max(7),
    strain: z.enum(['C', 'D', 'H', 'S', 'NT']),
    doubled: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    declarer: z.enum(seats),
    tricks: z.number().int().min(0).max(13),
    lead: z.string().max(4).default(''),
  })
  .strict()
  .refine(
    (r) => r.level !== 0 || (r.tricks === 0 && r.doubled === 1),
    'Pass out 必須是 0 墩、未加倍',
  );
export type ResultInput = z.infer<typeof resultSchema>;
export type Result = ResultInput & {
  nsScore: number;
  updatedAt: string;
  status?: 'played' | 'cancelled';
};
export type Audit = {
  at: string;
  action: string;
  reason: string;
  revision: number;
  detail?: string;
  changes?: { key: string; before: Result | null; after: Result | null }[];
};
export type BridgeEvent = {
  id: string;
  name: string;
  prefix?: string;
  kind: Kind;
  date: string;
  venue: string;
  rounds: number;
  boardsPerRound: number;
  awardPlaces?: number;
  movementImported?: boolean;
  currentRound?: number;
  roundPhase?: 'playing' | 'break';
  roundTimes?: Record<number, { startAt: string; endAt: string }>;
  status: 'live' | 'finished';
  publishBoards: boolean;
  pairMethod?: PairMethod;
  trim?: Trim;
  penalties?: Record<string, number>;
  demo: boolean;
  participants: Participant[];
  boards: Board[];
  assignments: Assignment[];
  results: Record<string, Result>;
  audit: Audit[];
  revision: number;
  updatedAt: string;
};
export const createSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    prefix: z.string().trim().max(80).optional(),
    kind: z.enum(['teams', 'pairs']),
    pairMethod: z.enum(['mp', 'crossimp', 'butler']).optional(),
    trim: z.enum(['none', 'one', 'ten-percent']).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
        '日期不正確',
      ),
    venue: z.string().trim().max(80),
    names: z.array(z.string().trim().min(1).max(60)).min(4).max(32),
    rounds: z.number().int().min(1).max(15),
    boardsPerRound: z.number().int().min(1).max(32),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.names).size !== v.names.length)
      ctx.addIssue({ code: 'custom', message: '名稱不可重複' });
    if (v.kind === 'teams' && v.names.length % 2)
      ctx.addIssue({ code: 'custom', message: '首版隊制賽需偶數隊伍' });
    if (v.rounds > (v.names.length % 2 ? v.names.length : v.names.length - 1))
      ctx.addIssue({ code: 'custom', message: '輪次超過單循環上限' });
    if (v.rounds * v.boardsPerRound > 128)
      ctx.addIssue({ code: 'custom', message: '每場最多 128 副' });
  });
export const mutationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('round-control'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      round: z.number().int().min(0).max(15),
      phase: z.enum(['playing', 'break']),
    })
    .strict(),
  z
    .object({
      action: z.literal('round-timing'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      round: z.number().int().min(1).max(15),
      startAt: z.string().datetime({ offset: true }).nullable(),
      endAt: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('board-publication'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      board: z.number().int().min(1).max(128),
      published: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('ruling'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      assignmentId: z.string().min(1).max(100),
      board: z.number().int().min(1).max(128),
      cancelled: z.boolean(),
      result: resultSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('penalty'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      participantId: z.string().min(1).max(100),
      amount: z.number().min(0).max(10000),
    })
    .strict(),
  z
    .object({
      action: z.literal('results'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      results: z.array(resultSchema).min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal('settings'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      status: z.enum(['live', 'finished']),
      publishBoards: z.boolean().optional(),
      awardPlaces: z.number().int().min(0).max(32).optional(),
      name: z.string().trim().min(2).max(80).optional(),
      prefix: z.string().trim().max(80).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('pbn'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      pbn: z.string().min(1).max(200000),
    })
    .strict(),
  z
    .object({
      action: z.literal('movement'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      csv: z.string().min(1).max(200000),
    })
    .strict(),
]);
export type Mutation = z.infer<typeof mutationSchema>;
export type StoredEvent = { event: BridgeEvent; requests: string[]; projection: Projection };
export type Standing = {
  id: string;
  name: string;
  players: string;
  rank: number;
  score: number | null;
  secondary: number;
  played: number;
  total: number;
  penalty?: number;
};
export type MatchScore = {
  id: string;
  round: number;
  a: string;
  b: string;
  impsA: number;
  impsB: number;
  completed: number;
  total: number;
  vpA: number | null;
  vpB: number | null;
};
export type PairScore = {
  ns: number | null;
  ew: number | null;
  top: number;
  provisional: boolean;
  datum?: number;
  cancelled?: boolean;
};
export type Projection = {
  standings: Standing[];
  matches: MatchScore[];
  pairScores: Record<string, PairScore>;
  received: number;
  expected: number;
};
export type PublicEvent = Omit<BridgeEvent, 'audit' | 'boards'> & {
  boards: Omit<Board, 'deal'>[] | Board[];
  projection: Projection;
};
export const resultKey = (assignment: string, board: number) => `${assignment}:${board}`;
