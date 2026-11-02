import { fail } from './errors.ts';
import { CHARS_PER_UNIT, type ExprValue, exprFunctions, type FnValue } from './expr-functions.ts';
import { deepEqual, isRecord, isTruthy, kindOf, toText } from './json.ts';
import type { Json } from './types.ts';

export type Ast =
  | { k: 'lit'; v: Json }
  | { k: 'id'; name: string }
  | { k: 'arr'; items: Ast[] }
  | { k: 'obj'; entries: [string, Ast][] }
  | { k: 'mem'; obj: Ast; prop: Ast; opt: boolean }
  | { k: 'call'; fn: string; args: Ast[] }
  | { k: 'un'; op: string; arg: Ast }
  | { k: 'bin'; op: string; l: Ast; r: Ast }
  | { k: 'cond'; test: Ast; then: Ast; else: Ast }
  | { k: 'fn'; params: string[]; body: Ast };

type Token = { t: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string; pos: number };

type Env = { vars: Record<string, ExprValue>; parent: Env | null };

export type EvalOptions = { now?: Date; maxOps?: number };

const OPS = ['?.', '??', '==', '!=', '<=', '>=', '&&', '||', '=>'];
const SINGLE = '+-*/%<>!?:.,()[]{}';
const BP: Record<string, number> = {
  '??': 2,
  '||': 3,
  '&&': 4,
  '==': 5,
  '!=': 5,
  '<': 6,
  '<=': 6,
  '>': 6,
  '>=': 6,
  '+': 7,
  '-': 7,
  '*': 8,
  '/': 8,
  '%': 8
};
const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"'
};
const NUM_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const ID_RE = /[A-Za-z_$][\w$]*/y;
const cache = new Map<string, Ast>();

const tokenize = (src: string): Token[] => {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    NUM_RE.lastIndex = i;
    ID_RE.lastIndex = i;
    const num = /[\d.]/.test(c) ? NUM_RE.exec(src) : null;
    const id = ID_RE.exec(src);
    if (num) {
      out.push({ t: 'num', v: num[0], pos: i });
      i += num[0].length;
    } else if (id) {
      out.push({ t: 'id', v: id[0], pos: i });
      i += id[0].length;
    } else if (c === '"' || c === "'") {
      let s = '';
      let j = i + 1;
      for (; j < src.length && src.charAt(j) !== c; j++) {
        const ch = src.charAt(j);
        if (ch !== '\\') {
          s += ch;
          continue;
        }
        const esc = src.charAt(++j);
        if (esc === 'u') {
          s += String.fromCharCode(Number.parseInt(src.slice(j + 1, j + 5), 16));
          j += 4;
        } else s += ESCAPES[esc] ?? esc;
      }
      if (j >= src.length) fail(`Unterminated string at ${i}`);
      out.push({ t: 'str', v: s, pos: i });
      i = j + 1;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i)) ?? (SINGLE.includes(c) ? c : null);
      if (!op) return fail(`Unexpected "${c}" at ${i}`);
      out.push({ t: 'op', v: op, pos: i });
      i += op.length;
    }
  }
  out.push({ t: 'eof', v: '', pos: src.length });
  return out;
};

export const parseExpr = (src: string): Ast => {
  const hit = cache.get(src);
  if (hit) return hit;
  const toks = tokenize(src);
  let p = 0;
  const eof = toks[toks.length - 1] ?? { t: 'eof', v: '', pos: 0 };
  const peek = (o = 0) => toks[p + o] ?? eof;
  const take = () => toks[p++] ?? eof;
  const isOp = (v: string, o = 0) => peek(o).t === 'op' && peek(o).v === v;
  const expect = (v: string) => {
    if (!isOp(v)) fail(`Expected "${v}" at ${peek().pos}`);
    p++;
  };
  const list = <T>(close: string, item: () => T): T[] => {
    const items: T[] = [];
    while (!isOp(close)) {
      items.push(item());
      if (!isOp(close)) expect(',');
    }
    p++;
    return items;
  };
  const name = () => {
    const t = take();
    return t.t === 'id' ? t.v : fail(`Expected name at ${t.pos}`);
  };
  const arrowParams = (): string[] | null => {
    const start = p;
    p++;
    const params: string[] = [];
    while (peek().t === 'id') {
      params.push(take().v);
      if (!isOp(',')) break;
      p++;
    }
    if (isOp(')') && isOp('=>', 1)) {
      p += 2;
      return params;
    }
    p = start;
    return null;
  };
  const primary = (): Ast => {
    const t = peek();
    if (t.t === 'num' || t.t === 'str' || t.t === 'id') p++;
    if (t.t === 'num') {
      const v = Number(t.v);
      return Number.isFinite(v) ? { k: 'lit', v } : fail(`Number ${t.v} is too large`);
    }
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (isOp('=>')) {
        p++;
        return { k: 'fn', params: [t.v], body: expr(0) };
      }
      if (isOp('(')) {
        if (!Object.hasOwn(exprFunctions, t.v)) fail(`Unknown function "${t.v}"`);
        p++;
        return { k: 'call', fn: t.v, args: list(')', () => expr(0)) };
      }
      return { k: 'id', name: t.v };
    }
    if (isOp('(')) {
      const params = arrowParams();
      if (params) return { k: 'fn', params, body: expr(0) };
      p++;
      const inner = expr(0);
      expect(')');
      return inner;
    }
    if (isOp('[')) {
      p++;
      return { k: 'arr', items: list(']', () => expr(0)) };
    }
    if (isOp('{')) {
      p++;
      return {
        k: 'obj',
        entries: list('}', () => {
          const key = peek().t === 'str' ? take().v : name();
          if (!isOp(':')) return [key, { k: 'id', name: key }] as [string, Ast];
          p++;
          return [key, expr(0)] as [string, Ast];
        })
      };
    }
    return fail(t.t === 'eof' ? 'Unexpected end of expression' : `Unexpected "${t.v}" at ${t.pos}`);
  };
  const postfix = (base: Ast): Ast => {
    let node = base;
    let chained = false;
    for (;;) {
      if (isOp('.') || (isOp('?.') && peek(1).t === 'id')) {
        const opt: boolean = take().v === '?.' || chained;
        chained = opt;
        node = { k: 'mem', obj: node, prop: { k: 'lit', v: name() }, opt };
      } else if (isOp('[') || (isOp('?.') && isOp('[', 1))) {
        const explicit = isOp('?.');
        p += explicit ? 2 : 1;
        const opt: boolean = explicit || chained;
        chained = opt;
        const prop = expr(0);
        expect(']');
        node = { k: 'mem', obj: node, prop, opt };
      } else return node;
    }
  };
  const prefix = (): Ast => {
    if (isOp('-') || isOp('!')) return { k: 'un', op: take().v, arg: prefix() };
    return postfix(primary());
  };
  const expr = (minBp: number): Ast => {
    let left = prefix();
    for (;;) {
      const t = peek();
      if (t.t !== 'op') break;
      if (t.v === '?') {
        if (minBp > 1) break;
        p++;
        const then = expr(0);
        expect(':');
        left = { k: 'cond', test: left, then, else: expr(1) };
        continue;
      }
      const bp = BP[t.v];
      if (bp === undefined || bp <= minBp) break;
      p++;
      left = { k: 'bin', op: t.v, l: left, r: expr(bp) };
    }
    return left;
  };
  const ast = expr(0);
  if (peek().t !== 'eof') fail(`Unexpected "${peek().v}" at ${peek().pos}`);
  if (cache.size > 2000) cache.clear();
  cache.set(src, ast);
  return ast;
};

const scan = (src: string | Ast) => {
  const found = new Set<string>();
  const called = new Set<string>();
  const walk = (n: Ast, bound: ReadonlySet<string>) => {
    switch (n.k) {
      case 'lit':
        return;
      case 'id':
        if (!bound.has(n.name)) found.add(n.name);
        return;
      case 'arr':
        for (const x of n.items) walk(x, bound);
        return;
      case 'obj':
        for (const [, x] of n.entries) walk(x, bound);
        return;
      case 'mem':
        walk(n.obj, bound);
        walk(n.prop, bound);
        return;
      case 'call':
        called.add(n.fn);
        for (const x of n.args) walk(x, bound);
        return;
      case 'un':
        walk(n.arg, bound);
        return;
      case 'bin':
        walk(n.l, bound);
        walk(n.r, bound);
        return;
      case 'cond':
        walk(n.test, bound);
        walk(n.then, bound);
        walk(n.else, bound);
        return;
      case 'fn':
        walk(n.body, new Set([...bound, ...n.params]));
    }
  };
  walk(typeof src === 'string' ? parseExpr(src) : src, new Set());
  return { identifiers: [...found], functions: [...called] };
};

export const freeIdentifiers = (src: string | Ast): string[] => scan(src).identifiers;

export const exprProblem = (src: string): string | null => {
  try {
    const unknown = scan(src).functions.find((fn) => !Object.hasOwn(exprFunctions, fn));
    return unknown ? `Unknown function "${unknown}"` : null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

const finite = (n: number) =>
  Number.isFinite(n) ? n : fail('Arithmetic result is not a finite number');

const asJson = (v: ExprValue): Json =>
  typeof v === 'function' ? fail('A function cannot be used as a value') : v;

const arith = (op: string, a: ExprValue, b: ExprValue): ExprValue => {
  if (op === '+' && (typeof a === 'string' || typeof b === 'string')) {
    return toText(asJson(a)) + toText(asJson(b));
  }
  if (typeof a !== 'number' || typeof b !== 'number') {
    return fail(
      `Operator "${op}" needs numbers, got ${kindOf(asJson(a))} and ${kindOf(asJson(b))}`
    );
  }
  if ((op === '/' || op === '%') && b === 0) return fail('Division by zero');
  return finite(
    op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b
  );
};

const compare = (op: string, a: ExprValue, b: ExprValue): boolean => {
  if (
    !(
      (typeof a === 'number' && typeof b === 'number') ||
      (typeof a === 'string' && typeof b === 'string')
    )
  ) {
    return fail(`Operator "${op}" needs two numbers or two strings`);
  }
  return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
};

const member = (obj: ExprValue, key: ExprValue, opt: boolean): ExprValue => {
  if (obj === null) return opt ? null : fail(`Cannot read "${toText(asJson(key))}" of null`);
  if (Array.isArray(obj) && typeof key === 'number') return obj[key] ?? null;
  if (isRecord(obj) && typeof key === 'string') {
    return Object.hasOwn(obj, key) ? (obj[key] ?? null) : null;
  }
  return fail(`Cannot read "${toText(asJson(key))}" of ${kindOf(asJson(obj))}`);
};

export const evaluateExpr = (
  src: string | Ast,
  vars: Record<string, Json>,
  { now, maxOps = 1_000_000 }: EvalOptions = {}
): Json => {
  let ops = 0;
  const charge = (units: number) => {
    ops += units;
    if (ops > maxOps) fail('Expression exceeded its evaluation budget');
  };
  const sizeOf = (v: ExprValue) =>
    Array.isArray(v) ? v.length : typeof v === 'string' ? v.length / CHARS_PER_UNIT : 0;
  const lookup = (env: Env, id: string): ExprValue => {
    for (let e: Env | null = env; e; e = e.parent) {
      if (Object.hasOwn(e.vars, id)) return e.vars[id] ?? null;
    }
    return fail(`Unknown name "${id}"`);
  };
  const callFn = (fn: ExprValue, args: ExprValue[]): ExprValue =>
    typeof fn === 'function' ? fn(args) : fail('Expected a function');
  const ev = (n: Ast, env: Env): ExprValue => {
    charge(1);
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'id':
        return lookup(env, n.name);
      case 'arr':
        return n.items.map((x) => asJson(ev(x, env)));
      case 'obj':
        return Object.fromEntries(n.entries.map(([k, x]) => [k, asJson(ev(x, env))]));
      case 'mem':
        return member(ev(n.obj, env), ev(n.prop, env), n.opt);
      case 'call': {
        const impl =
          (Object.hasOwn(exprFunctions, n.fn) ? exprFunctions[n.fn] : undefined) ??
          fail(`Unknown function "${n.fn}"`);
        const out = impl(
          n.args.map((x) => ev(x, env)),
          { call: callFn, charge, now }
        );
        charge(sizeOf(out));
        return out;
      }
      case 'un': {
        const v = ev(n.arg, env);
        if (n.op === '!') return !isTruthy(v);
        return typeof v === 'number' ? -v : fail('Unary "-" needs a number');
      }
      case 'bin': {
        const { op } = n;
        if (op === '&&') return isTruthy(ev(n.l, env)) && isTruthy(ev(n.r, env));
        if (op === '||') return isTruthy(ev(n.l, env)) || isTruthy(ev(n.r, env));
        if (op === '??') return ev(n.l, env) ?? ev(n.r, env);
        const l = ev(n.l, env);
        const r = ev(n.r, env);
        if (op === '==') return deepEqual(asJson(l), asJson(r));
        if (op === '!=') return !deepEqual(asJson(l), asJson(r));
        if (op === '<' || op === '<=' || op === '>' || op === '>=') return compare(op, l, r);
        const out = arith(op, l, r);
        charge(sizeOf(out));
        return out;
      }
      case 'cond':
        return isTruthy(ev(n.test, env)) ? ev(n.then, env) : ev(n.else, env);
      case 'fn': {
        const fn: FnValue = (args) =>
          ev(n.body, {
            vars: Object.fromEntries(n.params.map((name, i) => [name, args[i] ?? null])),
            parent: env
          });
        return fn;
      }
    }
  };
  return asJson(ev(typeof src === 'string' ? parseExpr(src) : src, { vars, parent: null }));
};
