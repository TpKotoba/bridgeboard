import { seats, type Board, type Seat, type Vulnerability } from './model';
import { randomDeals } from './random-deals';

type Expr = (deal: Board['deal'], stack: Set<string>) => number;
const compass: Record<string, Seat> = { north: 'N', east: 'E', south: 'S', west: 'W' };
const suits: Record<string, string> = { spade: 'S', spades: 'S', heart: 'H', hearts: 'H', diamond: 'D', diamonds: 'D', club: 'C', clubs: 'C' };
const ranks = 'AKQJT98765432';
const precedence: Record<string, number> = { or: 1, '||': 1, and: 2, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
function binary(op: string, a: number, b: number) {
  switch (op) {
    case '+': return a + b; case '-': return a - b; case '*': return a * b;
    case '/': if (!b) throw new Error('Deal Source：除數不可為 0'); return Math.floor(a / b);
    case '%': if (!b) throw new Error('Deal Source：除數不可為 0'); return a % b;
    case '==': return +(a === b); case '!=': return +(a !== b);
    case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
    default: throw new Error(`不支援運算子 ${op}`);
  }
}
function shapeMatches(lengths: number[], pattern: string, any: boolean): boolean {
  if (!any) return [...pattern].every((n, i) => n === 'x' || +n === lengths[i]);
  if (!pattern.length) return true;
  return lengths.some((n, i) => (pattern[0] === 'x' || +pattern[0] === n) &&
    shapeMatches(lengths.filter((_, j) => i !== j), pattern.slice(1), true));
}

/** A parsed, bounded Dealer expression interpreter. Source is never evaluated as JavaScript. */
export function compileDealerSource(source: string, defaultCount: number) {
  if (source.length > 16000) throw new Error('Deal Source 最多 16,000 字元');
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/#[^\n]*|\/\/[^\n]*/g, ' ');
  const tokens: string[] = [];
  const lexer = /\s+|(?:\d[\dx]*|[a-z_][a-z_\d]*)|&&|\|\||==|!=|<=|>=|[()?,:+*/%<>=!-]/giy;
  let offset = 0;
  while (offset < clean.length) {
    lexer.lastIndex = offset;
    const match = lexer.exec(clean);
    if (!match) throw new Error(`Deal Source：無法識別「${clean.slice(offset, offset + 16)}」`);
    offset = lexer.lastIndex;
    if (match[0].trim()) tokens.push(match[0].toLowerCase());
  }
  if (tokens.length > 4000) throw new Error('Deal Source 過長');
  let pos = 0, depth = 0;
  const variables = new Map<string, Expr>(), references = new Set<string>();
  const predeal: Board['deal'] = { N: [], E: [], S: [], W: [] };
  let count = defaultCount, limit = 1000000, dealer: Seat | undefined, vulnerability: Vulnerability | undefined;
  let condition: Expr = () => 1;
  let points = [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const peek = () => tokens[pos];
  const take = () => { if (pos >= tokens.length) throw new Error('Deal Source 不完整'); return tokens[pos++]; };
  const expect = (text: string) => { if (take() !== text) throw new Error(`Deal Source：預期 ${text}`); };
  const seat = () => { const value = compass[take()]; if (!value) throw new Error('請使用 north、east、south 或 west'); return value; };
  function integer() { const value = take(); if (!/^\d+$/.test(value)) throw new Error('此處需要整數'); return Number(value); }
  function expression(min = 0): Expr {
    if (++depth > 64) throw new Error('Deal Source 運算巢狀過深');
    let left: Expr;
    const token = take();
    if (token === '(') { left = expression(); expect(')'); }
    else if (['not', '!', '-', '+'].includes(token)) {
      const arg = expression(7); left = (d, s) => token === '-' ? -arg(d, s) : token === '+' ? arg(d, s) : +!arg(d, s);
    } else if (/^\d+$/.test(token)) { const value = Number(token); left = () => value; }
    else if (peek() === '(') {
      take();
      const player = seat(); expect(token === 'shape' || token === 'hascard' ? ',' : peek() === ',' ? ',' : ')');
      if (token === 'shape') {
        const patterns: { add: boolean; any: boolean; pattern: string }[] = [];
        let add = true;
        do {
          let any = false;
          if (peek() === 'any') { take(); any = true; }
          const pattern = take();
          if (!/^[0-9x]{4}$/.test(pattern) || (!pattern.includes('x') && [...pattern].reduce((s, x) => s + +x, 0) !== 13)) throw new Error('shape 需為四個花色長度，例如 any 4333 或 54xx');
          patterns.push({ add, any, pattern });
          if (peek() !== '+' && peek() !== '-') break;
          add = take() === '+';
        } while (true);
        expect(')');
        left = d => {
          const lengths = [...'SHDC'].map(suit => d[player].filter(c => c[0] === suit).length);
          let result = false;
          for (const p of patterns) if (shapeMatches(lengths, p.pattern, p.any)) result = p.add;
          return +result;
        };
      } else if (token === 'hascard') {
        const card = take().toUpperCase(); expect(')');
        if (!/^[AKQJT2-9][SHDC]$/.test(card)) throw new Error('hascard 的牌張格式例如 AS、TC');
        left = d => +d[player].includes(card[1] + card[0]);
      } else {
        // The closing parenthesis was consumed above when there is no suit argument.
        let suit: string | undefined;
        if (tokens[pos - 1] === ',') { suit = suits[take()]; if (!suit) throw new Error('未知花色'); expect(')'); }
        const supported = ['hcp', 'hcps', 'control', 'controls', 'loser', 'losers', 'ace', 'aces', 'king', 'kings', 'queen', 'queens', 'jack', 'jacks', 'tens', 'top2', 'top3', 'top4', 'top5', 'c13'];
        if (!suits[token] && !supported.includes(token)) throw new Error(`尚未支援 Dealer 函式：${token}`);
        if (suits[token] && suit) throw new Error('花色長度函式只接受一家');
        left = d => {
          const hand = d[player].filter(c => !suit || c[0] === suit);
          if (suits[token]) return hand.filter(c => c[0] === suits[token]).length;
          if (token === 'loser' || token === 'losers') return [...'SHDC'].reduce((sum, s) => {
            const cards = hand.filter(c => c[0] === s).map(c => c[1]);
            const n = Math.min(3, cards.length);
            return sum + n - [...'AKQ'].slice(0, n).filter(r => cards.includes(r)).length;
          }, 0);
          return hand.reduce((sum, c) => {
            const rank = ranks.indexOf(c[1]);
            if (token === 'hcp' || token === 'hcps') return sum + points[rank];
            if (token.startsWith('control')) return sum + (rank === 0 ? 2 : rank === 1 ? 1 : 0);
            if (token === 'c13') return sum + ([6, 4, 2, 1][rank] ?? 0);
            if (token.startsWith('top')) return sum + +(rank < Number(token.slice(3)));
            const wanted = token.startsWith('ace') ? 0 : token.startsWith('king') ? 1 : token.startsWith('queen') ? 2 : token.startsWith('jack') ? 3 : 4;
            return sum + +(rank === wanted);
          }, 0);
        };
      }
    } else if (/^[a-z_]\w*$/.test(token)) {
      references.add(token);
      left = (d, s) => {
        if (s.has(token)) throw new Error(`變數循環引用：${token}`);
        const value = variables.get(token); if (!value) throw new Error(`未定義變數：${token}`);
        s.add(token); try { return value(d, s); } finally { s.delete(token); }
      };
    } else throw new Error(`Deal Source：不合法的運算式 ${token}`);
    while (precedence[peek()] !== undefined && precedence[peek()] >= min) {
      const op = take(), a = left, b = expression(precedence[op] + 1);
      left = (d, s) => op === 'and' || op === '&&' ? +(!!a(d, s) && !!b(d, s)) : op === 'or' || op === '||' ? +(!!a(d, s) || !!b(d, s)) : binary(op, a(d, s), b(d, s));
    }
    if (min === 0 && peek() === '?') {
      take(); const a = left, yes = expression(); expect(':'); const no = expression();
      left = (d, s) => a(d, s) ? yes(d, s) : no(d, s);
    }
    depth--; return left;
  }
  while (pos < tokens.length) {
    const command = take();
    if (command === 'generate') limit = integer();
    else if (command === 'produce') count = integer();
    else if (command === 'dealer') dealer = seat();
    else if (command === 'vulnerable') {
      const value: Record<string, Vulnerability> = { none: 'None', ns: 'NS', ew: 'EW', all: 'All' };
      vulnerability = value[take()]; if (!vulnerability) throw new Error('vulnerable 需為 none、ns、ew 或 all');
    } else if (command === 'predeal') {
      const player = seat(); if (peek() === ',') take();
      do {
        const holding = take().toUpperCase();
        if (!/^[SHDC][AKQJT2-9]+$/.test(holding)) throw new Error('predeal 格式例如 north SAQ542, HKJ87');
        predeal[player].push(...[...holding.slice(1)].map(rank => holding[0] + rank));
        if (peek() !== ',') break; take();
      } while (true);
    } else if (command === 'condition') condition = expression();
    else if (command === 'pointcount') {
      const values = [integer()]; while (peek() === ',') { take(); values.push(integer()); }
      if (values.length > 13) throw new Error('pointcount 最多 13 個點數');
      points = [...values, ...Array(13 - values.length).fill(0)];
    } else if (command === 'action') {
      do {
        const action = take();
        if (!['printall', 'printpbn', 'printoneline'].includes(action)) throw new Error(`PBN 產生器尚未支援 action ${action}`);
        if (peek() !== ',') break; take();
      } while (true);
    } else if (peek() === '=') { take(); variables.set(command, expression()); }
    else { pos--; condition = expression(); }
  }
  for (const name of references) if (!variables.has(name)) throw new Error(`未定義變數：${name}`);
  if (!Number.isInteger(count) || count < 1 || count > 128) throw new Error('produce 需為 1–128 副');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000000) throw new Error('generate 需為 1–1,000,000 次');
  const fixed = Object.values(predeal).flat();
  if (new Set(fixed).size !== fixed.length || Object.values(predeal).some(h => h.length > 13)) throw new Error('predeal 有重複牌或單家超過 13 張');
  return { count, limit, dealer, vulnerability, predeal, accepts: (deal: Board['deal']) => !!condition(deal, new Set()) };
}

export async function generateDealerBoards(boards: Omit<Board, 'deal'>[], source: string, signal?: AbortSignal,
  progress?: (accepted: number, attempts: number) => void) {
  const program = compileDealerSource(source, boards.length);
  if (program.count > boards.length) throw new Error(`produce 不可超過本賽段 ${boards.length} 副牌；可下載較少副，但套用需包含全部牌號。`);
  const result: Board[] = [];
  const start = Date.now();
  for (let attempt = 0; attempt < program.limit && result.length < program.count; attempt++) {
    if (attempt % 250 === 0) {
      progress?.(result.length, attempt);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (signal?.aborted) throw new Error('已取消產生牌局');
      if (Date.now() - start > 30000) throw new Error(`條件搜尋超過 30 秒，目前找到 ${result.length} 副；請放寬條件。`);
    }
    const board = randomDeals([boards[result.length]], program.predeal)[0];
    if (!program.accepts(board.deal)) continue;
    result.push({ ...board, ...(program.dealer ? { dealer: program.dealer } : {}), ...(program.vulnerability ? { vulnerability: program.vulnerability } : {}) });
  }
  if (result.length !== program.count) throw new Error(`已達 generate 上限，只找到 ${result.length} / ${program.count} 副；請放寬條件或增加 generate。`);
  return result;
}
