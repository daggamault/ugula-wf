import { COMMENT_COLORS, type CommentColor, type GraphComment } from '@ugula/graph';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { createContext, useContext } from 'react';
import { classNamesOf } from '../class-names.ts';
import { labelFromName } from '../format.ts';
import { interactiveClasses } from '../ui/interactive.ts';
import type { CommentFlowNode } from './comments.ts';

type CommentPatch = Partial<Omit<GraphComment, 'id'>>;

export const CommentActions = createContext<((id: string, patch: CommentPatch) => void) | null>(
  null
);

const COMMENT_TINTS: Readonly<Record<CommentColor, string>> = {
  neutral: 'bg-surface-fg/5 border-border text-surface-fg',
  primary: 'bg-primary/10 border-primary/30 text-primary',
  info: 'bg-info/10 border-info/30 text-info',
  success: 'bg-success/10 border-success/30 text-success',
  warning: 'bg-warning/10 border-warning/30 text-warning-text',
  danger: 'bg-danger/10 border-danger/30 text-danger'
};

const SWATCHES: Readonly<Record<CommentColor, string>> = {
  neutral: 'bg-surface-fg-muted',
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger'
};

const MIN_COMMENT = { width: 160, height: 80 };

export const CommentNode = ({ data, selected }: NodeProps<CommentFlowNode>) => {
  const update = useContext(CommentActions);
  const { comment } = data;
  const color = comment.color ?? 'neutral';
  return (
    <section
      aria-label={comment.text || 'Comment'}
      className={classNamesOf(
        'flex size-full flex-col rounded-xl border-2',
        COMMENT_TINTS[color],
        selected && 'ring-primary ring-2'
      )}
    >
      {update ? (
        <NodeResizer
          isVisible={selected}
          minWidth={MIN_COMMENT.width}
          minHeight={MIN_COMMENT.height}
          lineClassName="pointer-events-auto! border-primary!"
          handleClassName="pointer-events-auto! size-2.5! rounded-full! border-surface! bg-primary!"
          onResizeEnd={(_, p) =>
            update(comment.id, {
              position: { x: Math.round(p.x), y: Math.round(p.y) },
              size: { width: Math.round(p.width), height: Math.round(p.height) }
            })
          }
        />
      ) : null}
      <header className="comment-handle pointer-events-auto flex cursor-grab items-center gap-2 px-3 py-2">
        {update ? (
          <input
            aria-label="Comment Title"
            value={comment.text}
            onChange={(e) => update(comment.id, { text: e.target.value })}
            className={classNamesOf(
              interactiveClasses,
              'nodrag min-w-0 flex-1 cursor-text rounded-lg bg-transparent px-1 text-base font-bold'
            )}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate px-1 text-base font-bold">{comment.text}</h3>
        )}
        {update && selected ? (
          <fieldset className="nodrag flex items-center gap-1">
            <legend className="sr-only">Comment Color</legend>
            {COMMENT_COLORS.map((c) => (
              <input
                key={c}
                type="radio"
                name={`${comment.id}-color`}
                checked={c === color}
                aria-label={labelFromName(c)}
                title={labelFromName(c)}
                onChange={() => update(comment.id, { color: c })}
                className={classNamesOf(
                  interactiveClasses,
                  'border-surface checked:border-surface-fg size-5 appearance-none rounded-full border-2',
                  SWATCHES[c]
                )}
              />
            ))}
          </fieldset>
        ) : null}
      </header>
    </section>
  );
};
