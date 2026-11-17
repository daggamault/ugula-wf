import { documentationIssues, type GraphDef, type Issue } from '@ugula/graph';
import { GitCompareArrowsIcon } from 'lucide-react';
import { classNamesOf } from '../../shared/class-names.ts';
import type { Catalog } from '../../shared/graph/catalog.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';

export const documentationHints = (def: GraphDef, catalog: Catalog) =>
  documentationIssues(def).map((i) => {
    const inst = i.node ? def.nodes.find((n) => n.id === i.node) : undefined;
    if (!inst) return i.message;
    const { label: _, ...plain } = inst;
    return `${catalog.titleOf(plain)}: ${i.message}`;
  });

export const DocumentationHints = ({ hints }: { hints: readonly string[] }) => (
  <Alert intent="warning">
    <details className="flex flex-col gap-1">
      <summary className={classNamesOf(interactiveClasses, 'w-fit rounded-lg font-semibold')}>
        {hints.length} Documentation {hints.length === 1 ? 'Hint' : 'Hints'}
      </summary>
      <ul className="flex list-disc flex-col gap-1 pt-1 pl-4">
        {hints.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </details>
  </Alert>
);

type EditorNoticesProps = {
  error: string;
  issues: readonly Issue[];
  hints: readonly string[];
  base: 'stale' | 'updated' | null;
  compareHref: string;
};

export const EditorNotices = ({ error, issues, hints, base, compareHref }: EditorNoticesProps) =>
  error || issues.length || hints.length || base ? (
    <div className="flex flex-col gap-2 px-4 py-3">
      {error ? <Alert>{error}</Alert> : null}
      {base ? (
        <Alert
          intent="warning"
          action={
            <ButtonLink to={compareHref} variant="outline">
              <GitCompareArrowsIcon aria-hidden="true" className="size-4" />
              Compare
            </ButtonLink>
          }
        >
          <strong className="font-semibold">Base Updated.</strong>{' '}
          {base === 'stale'
            ? 'The base changed its inputs, outputs or exits, so runs use the base until you bring this copy up to date.'
            : 'The base has changed since this copy was made. Compare to see what changed.'}
        </Alert>
      ) : null}
      {issues.map((issue, i) => (
        <Alert key={`${i}-${issue.message}`} intent="warning">
          {issue.message}
        </Alert>
      ))}
      {hints.length ? <DocumentationHints hints={hints} /> : null}
    </div>
  ) : null;
