import type { Json, NodeInstance } from '@ugula/graph';
import { TableIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { Textarea } from '../../shared/ui/textarea.tsx';
import type { EffectiveTable } from './client.ts';
import { DecisionTableEditor, LookupTableEditor } from './table-editors.tsx';

export const TABLE_EDITORS = {
  'std.table.lookup': LookupTableEditor,
  'std.table.decide': DecisionTableEditor
} as const;

export const ConfigEditor = ({
  node,
  editable,
  onConfig
}: {
  node: NodeInstance;
  editable: boolean;
  onConfig: (config: Json | undefined) => void;
}) => {
  const [text, setText] = useState(() =>
    node.config === undefined ? '' : JSON.stringify(node.config, null, 2)
  );
  const [error, setError] = useState<string>();
  return (
    <Textarea
      isMonospace
      id={`${node.id}-config`}
      label="Settings (JSON)"
      hint="For example the expression to evaluate, the fields of a task, or which workflow to start."
      error={error}
      disabled={!editable}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) {
          setError(undefined);
          onConfig(undefined);
          return;
        }
        try {
          onConfig(JSON.parse(e.target.value) as Json);
          setError(undefined);
        } catch {
          setError('This is not valid JSON yet.');
        }
      }}
    />
  );
};

export const TableReference = ({
  tableKey,
  table
}: {
  tableKey: string;
  table: EffectiveTable | undefined;
}) => (
  <div className="flex flex-col gap-3">
    <p className="text-sm">
      Uses the shared table <code className="font-mono">{tableKey}</code>, so its rules can change
      without changing this workflow.
    </p>
    {table ? (
      <span className="flex flex-wrap items-center gap-2">
        <ButtonLink to={`/tables/${table.id}`} variant="outline">
          <TableIcon aria-hidden="true" className="size-4" />
          Open Table
        </ButtonLink>
        {table.scope === 'system' ? null : (
          <Badge intent="custom">
            {table.scope === 'agency'
              ? 'Customized for This Agency'
              : 'Customized for Organization'}
          </Badge>
        )}
      </span>
    ) : (
      <p className="text-danger text-sm">This table is not available to your agency.</p>
    )}
  </div>
);
