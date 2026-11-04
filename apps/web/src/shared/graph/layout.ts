import { type Edge, ENTRY_TYPE, type GraphDef, type Signature } from '@ugula/graph';

type Point = { x: number; y: number };

export type Shape = {
  top: number;
  height: number;
  ins: string[];
  outs: string[];
  execOuts: number;
  pure: boolean;
};

type Anchor = { to: string; dy: number; weight: number };

type Slot = { id: string; want: number; height: number };

export const NODE_WIDTH = 240;
const COLUMN_GAP = 110;
const ROW_GAP = 32;
const TITLE = 34;
const DESCRIPTION = 34;
const PIN_ROW = 24;
const PIN_PADDING = 6;
const SWEEPS = 12;
const SETTLE_PASSES = 4;
const EXEC_WEIGHT = 8;
const CONSUMER_WEIGHT = 4;

export const shapeOf = (sig: Signature | null, described: boolean): Shape => {
  const ins = sig ? [...sig.execIn, ...sig.inputs.map((p) => p.name)] : [];
  const outs = sig ? [...sig.execOut, ...sig.outputs.map((p) => p.name)] : [];
  const top = TITLE + (described ? DESCRIPTION : 0);
  return {
    top,
    height: top + PIN_PADDING * 2 + PIN_ROW * Math.max(ins.length, outs.length, 1),
    ins,
    outs,
    execOuts: sig?.execOut.length ?? 0,
    pure: sig !== null && !sig.execIn.length && !sig.execOut.length
  };
};

const FALLBACK = shapeOf(null, false);

const pinOffset = (pins: string[], pin: string) =>
  PIN_PADDING + Math.max(pins.indexOf(pin), 0) * PIN_ROW;

const settle = (column: Slot[]) => {
  const offsets: number[] = [];
  let offset = 0;
  for (const n of column) {
    offsets.push(offset);
    offset += n.height + ROW_GAP;
  }
  const blocks: { sum: number; count: number }[] = [];
  column.forEach((n, i) => {
    blocks.push({ sum: n.want - (offsets[i] ?? 0), count: 1 });
    for (;;) {
      const last = blocks.at(-1);
      const prev = blocks.at(-2);
      if (!last || !prev || prev.sum / prev.count <= last.sum / last.count) break;
      blocks.splice(-2, 2, { sum: prev.sum + last.sum, count: prev.count + last.count });
    }
  });
  const base = blocks.flatMap((b) => Array<number>(b.count).fill(b.sum / b.count));
  return column.map((n, i) => [n.id, (base[i] ?? 0) + (offsets[i] ?? 0)] as const);
};

export const layout = (
  def: GraphDef,
  shapes: ReadonlyMap<string, Shape> = new Map()
): Record<string, Point> => {
  const ids = def.nodes.map((n) => n.id);
  const known = new Set(ids);
  const shape = (id: string) => shapes.get(id) ?? FALLBACK;
  const edges = def.edges.filter((e) => e.from !== e.to && known.has(e.from) && known.has(e.to));
  const outgoing = new Map<string, Edge[]>(ids.map((id) => [id, []]));
  for (const e of edges) outgoing.get(e.from)?.push(e);
  for (const [id, list] of outgoing) {
    const { outs } = shape(id);
    list.sort((a, b) => outs.indexOf(a.fromPin) - outs.indexOf(b.fromPin));
  }

  const entry = def.nodes.find((n) => n.type === ENTRY_TYPE)?.id;
  const state = new Map<string, 'open' | 'done'>();
  const finished: string[] = [];
  const back = new Set<Edge>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const e of outgoing.get(id) ?? []) {
      const seen = state.get(e.to);
      if (seen === 'open') back.add(e);
      else if (!seen) visit(e.to);
    }
    state.set(id, 'done');
    finished.push(id);
  };
  const targeted = new Set(edges.map((e) => e.to));
  for (const id of [...(entry ? [entry] : []), ...ids.filter((i) => !targeted.has(i)), ...ids]) {
    if (!state.has(id)) visit(id);
  }
  const ahead = (id: string) => (outgoing.get(id) ?? []).filter((e) => !back.has(e));

  const layer = new Map(ids.map((id) => [id, 0]));
  const topological = finished.toReversed();
  for (const id of topological) {
    for (const e of ahead(id)) {
      layer.set(e.to, Math.max(layer.get(e.to) ?? 0, (layer.get(id) ?? 0) + 1));
    }
  }
  const behind = new Map<string, Edge[]>(ids.map((id) => [id, []]));
  for (const id of ids) for (const e of ahead(id)) behind.get(e.to)?.push(e);
  const at = (id: string) => layer.get(id) ?? 0;
  const movable = finished.filter((id) => shape(id).pure && id !== entry && ahead(id).length);
  const latest = (id: string) => Math.min(...ahead(id).map((e) => at(e.to) - 1));
  for (const id of movable) layer.set(id, latest(id));
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    for (const id of pass % 2 ? movable.toReversed() : movable) {
      const prev = behind.get(id) ?? [];
      const lo = prev.reduce((max, e) => Math.max(max, at(e.from) + 1), 0);
      const wants = [...prev.map((e) => at(e.from) + 1), ...ahead(id).map((e) => at(e.to) - 1)];
      const median = wants.sort((a, b) => a - b)[Math.floor(wants.length / 2)] ?? lo;
      layer.set(id, Math.min(Math.max(median, lo), latest(id)));
    }
  }

  const anchors = new Map<string, Anchor[]>(ids.map((id) => [id, []]));
  for (const id of ids) {
    for (const e of ahead(id)) {
      const from = shape(e.from);
      const to = shape(e.to);
      const exec = from.outs.indexOf(e.fromPin) < from.execOuts;
      const dy = pinOffset(from.outs, e.fromPin) - pinOffset(to.ins, e.toPin);
      const span = Math.max((layer.get(e.to) ?? 0) - (layer.get(e.from) ?? 0), 1);
      if (exec || !from.pure || to.pure) {
        anchors.get(e.to)?.push({ to: e.from, dy, weight: (exec ? EXEC_WEIGHT : 1) / span });
      }
      if (from.pure && e.from !== entry) {
        anchors.get(e.from)?.push({ to: e.to, dy: -dy, weight: CONSUMER_WEIGHT / span });
      }
    }
  }

  const columns = new Map<number, string[]>();
  for (const id of topological) {
    const l = layer.get(id) ?? 0;
    columns.set(l, [...(columns.get(l) ?? []), id]);
  }
  const order = [...columns.keys()].sort((a, b) => a - b);
  const y = new Map<string, number>();
  for (const l of order) {
    const column = (columns.get(l) ?? []).map((id) => ({ id, want: 0, height: shape(id).height }));
    for (const [id, at] of settle(column)) y.set(id, at);
  }
  const want = (id: string) => {
    const list = anchors.get(id) ?? [];
    const total = list.reduce((sum, a) => sum + a.weight, 0);
    return total
      ? list.reduce((sum, a) => sum + a.weight * ((y.get(a.to) ?? 0) + a.dy), 0) / total
      : (y.get(id) ?? 0);
  };
  const sweep = (l: number) => {
    const column = (columns.get(l) ?? [])
      .map((id) => ({ id, want: want(id), height: shape(id).height }))
      .sort((a, b) => a.want - b.want);
    columns.set(
      l,
      column.map((n) => n.id)
    );
    for (const [id, at] of settle(column)) y.set(id, at);
  };
  for (let i = 0; i < SWEEPS; i++) for (const l of i % 2 ? order.toReversed() : order) sweep(l);
  for (const l of order) sweep(l);

  const first = order[0] ?? 0;
  const top = Math.min(...y.values());
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        x: ((layer.get(id) ?? 0) - first) * (NODE_WIDTH + COLUMN_GAP),
        y: Math.round((y.get(id) ?? 0) - top)
      }
    ])
  );
};
