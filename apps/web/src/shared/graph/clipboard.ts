import {
  ENTRY_TYPE,
  type GraphComment,
  type GraphDef,
  type Edge as GraphEdge,
  graphDefSchema,
  type NodeInstance
} from '@ugula/graph';
import * as v from 'valibot';
import { nextCommentId } from './comments.ts';

export type Clip = { nodes: NodeInstance[]; edges: GraphEdge[]; comments: GraphComment[] };

const CLIP_KIND = 'ugula/graph-clip';

export const PASTE_OFFSET = 40;

export const clipOf = (
  def: GraphDef,
  nodeIds: readonly string[],
  commentIds: readonly string[] = []
): Clip => {
  const nodes = def.nodes.filter((n) => nodeIds.includes(n.id) && n.type !== ENTRY_TYPE);
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: def.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    comments: (def.comments ?? []).filter((c) => commentIds.includes(c.id))
  };
};

const freshId = (taken: Set<string>, id: string) => {
  const base = id.replace(/\d+$/, '') || 'node';
  for (let i = 1; ; i++) {
    const next = `${base}${i}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
};

const shifted = (p: { x: number; y: number } | undefined, by: number) => ({
  x: (p?.x ?? 0) + by,
  y: (p?.y ?? 0) + by
});

export const pasted = (def: GraphDef, clip: Clip, offset = PASTE_OFFSET) => {
  const taken = new Set(def.nodes.map((n) => n.id));
  const ids = new Map(clip.nodes.map((n) => [n.id, freshId(taken, n.id)]));
  const nodes = clip.nodes.map((n) => ({
    ...n,
    id: ids.get(n.id) ?? n.id,
    position: shifted(n.position, offset)
  }));
  const edges = clip.edges.flatMap((e) => {
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    return from && to ? [{ ...e, from, to }] : [];
  });
  const takenComments = new Set((def.comments ?? []).map((c) => c.id));
  const comments = clip.comments.map((c) => {
    const id = nextCommentId(takenComments);
    takenComments.add(id);
    return { ...c, id, position: shifted(c.position, offset) };
  });
  return {
    nodes: nodes.map((n) => n.id),
    comments: comments.map((c) => c.id),
    def: {
      ...def,
      nodes: [...def.nodes, ...nodes],
      edges: [...def.edges, ...edges],
      ...(comments.length || def.comments
        ? { comments: [...(def.comments ?? []), ...comments] }
        : {})
    }
  };
};

export const clipText = (clip: Clip) => JSON.stringify({ kind: CLIP_KIND, ...clip });

const envelope = v.object({
  kind: v.literal(CLIP_KIND),
  nodes: v.unknown(),
  edges: v.unknown(),
  comments: v.unknown()
});

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const clipFrom = (text: string, def: GraphDef): Clip | null => {
  const raw = v.safeParse(envelope, parsedJson(text));
  if (!raw.success) return null;
  const { nodes, edges, comments } = raw.output;
  const parsed = v.safeParse(graphDefSchema, {
    signature: def.signature,
    variables: [],
    nodes,
    edges,
    comments
  });
  return parsed.success
    ? {
        nodes: parsed.output.nodes,
        edges: parsed.output.edges,
        comments: parsed.output.comments ?? []
      }
    : null;
};
