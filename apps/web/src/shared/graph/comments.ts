import type { GraphComment, GraphDef } from '@ugula/graph';
import type { Node } from '@xyflow/react';

export type Rect = { x: number; y: number; width: number; height: number };

type CommentData = { comment: GraphComment };

export type CommentFlowNode = Node<CommentData, 'comment'>;

const COMMENT_PREFIX = 'comment:';

const PADDING = 40;

const TITLE_SPACE = 48;

const DEFAULT_SIZE = { width: 480, height: 280 };

export const commentNodeId = (id: string) => `${COMMENT_PREFIX}${id}`;

export const commentIdOf = (nodeId: string) =>
  nodeId.startsWith(COMMENT_PREFIX) ? nodeId.slice(COMMENT_PREFIX.length) : null;

export const commentsToFlow = (def: GraphDef): CommentFlowNode[] =>
  (def.comments ?? []).map((comment) => ({
    id: commentNodeId(comment.id),
    type: 'comment',
    position: comment.position,
    width: comment.size.width,
    height: comment.size.height,
    zIndex: -2,
    className: 'pointer-events-none!',
    dragHandle: '.comment-handle',
    data: { comment }
  }));

const withComments = (def: GraphDef, comments: GraphComment[]): GraphDef => {
  const { comments: _, ...rest } = def;
  return comments.length ? { ...rest, comments } : rest;
};

export const nextCommentId = (taken: ReadonlySet<string>) => {
  for (let i = 1; ; i++) if (!taken.has(`comment${i}`)) return `comment${i}`;
};

export const boundsOf = (rects: readonly Rect[]): Rect | null => {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.x)) - PADDING;
  const top = Math.min(...rects.map((r) => r.y)) - PADDING - TITLE_SPACE;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + PADDING;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + PADDING;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const addComment = (
  def: GraphDef,
  around: Rect | null,
  center: { x: number; y: number }
) => {
  const id = nextCommentId(new Set((def.comments ?? []).map((c) => c.id)));
  const rect = around ?? {
    x: center.x - DEFAULT_SIZE.width / 2,
    y: center.y - DEFAULT_SIZE.height / 2,
    ...DEFAULT_SIZE
  };
  const comment: GraphComment = {
    id,
    text: 'Comment',
    position: { x: Math.round(rect.x), y: Math.round(rect.y) },
    size: { width: Math.round(rect.width), height: Math.round(rect.height) }
  };
  return { id, def: withComments(def, [...(def.comments ?? []), comment]) };
};

export const updateComment = (
  def: GraphDef,
  id: string,
  patch: Partial<Omit<GraphComment, 'id'>>
): GraphDef =>
  withComments(
    def,
    (def.comments ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c))
  );

export const removeComments = (def: GraphDef, ids: readonly string[]): GraphDef =>
  def.comments
    ? withComments(
        def,
        def.comments.filter((c) => !ids.includes(c.id))
      )
    : def;

export const moveComments = (
  def: GraphDef,
  positions: Readonly<Record<string, { x: number; y: number }>>
): GraphDef =>
  def.comments
    ? withComments(
        def,
        def.comments.map((c) => {
          const p = positions[c.id];
          return p ? { ...c, position: { x: Math.round(p.x), y: Math.round(p.y) } } : c;
        })
      )
    : def;

const inside = (frame: Rect, r: Rect) =>
  r.x >= frame.x &&
  r.y >= frame.y &&
  r.x + r.width <= frame.x + frame.width &&
  r.y + r.height <= frame.y + frame.height;

export const framed = (frame: Rect, rects: readonly (Rect & { id: string })[]) =>
  rects.filter((r) => inside(frame, r)).map((r) => r.id);
