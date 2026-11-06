import type { GraphDef, NodeInstance } from '@ugula/graph';
import { CheckIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import type { GraphComparison } from './client.ts';
import { describeDiff } from './override-diff.ts';
import { scopeLabel } from './scope-badges.tsx';

type ComparePanelProps = {
  comparison: GraphComparison;
  current: GraphDef;
  noun: string;
  titleOf: (node: NodeInstance) => string;
  canEdit: boolean;
  busy: boolean;
  onKeep: () => void;
  onReset: () => void;
  onClose: () => void;
};

const Differences = ({ items, empty }: { items: readonly string[]; empty: string }) =>
  items.length ? (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="text-surface-fg-muted text-sm">{empty}</p>
  );

export const ComparePanel = ({
  comparison,
  current,
  noun,
  titleOf,
  canEdit,
  busy,
  onKeep,
  onReset,
  onClose
}: ComparePanelProps) => {
  const titleId = useId();
  const { copiedFrom, latest, baseChanged } = comparison;
  const baseNow =
    copiedFrom && latest ? describeDiff(copiedFrom.definition, latest.definition, titleOf) : [];
  const yours = copiedFrom ? describeDiff(copiedFrom.definition, current, titleOf) : [];
  return (
    <aside aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex items-start justify-between gap-4 border-b p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-base font-bold">
            Compare With Base
          </h2>
          <p className="text-surface-fg-muted text-sm">
            What the {noun} you copied looked like, what it looks like now, and what you changed.
          </p>
        </div>
        <IconButton
          label="Close Compare"
          tooltip="Close"
          icon={XIcon}
          tooltipSide="left"
          onClick={onClose}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <SectionPanel
          title="Base Then"
          description={
            copiedFrom
              ? `The ${scopeLabel(copiedFrom.scope).toLowerCase()} ${noun} v${copiedFrom.version}, which this copy started from.`
              : 'This copy does not record the version it started from.'
          }
        >
          <p className="text-sm">
            {copiedFrom ? `${copiedFrom.definition.nodes.length} nodes` : 'Unknown'}
          </p>
        </SectionPanel>
        <SectionPanel
          title="Base Now"
          description={
            latest
              ? `v${latest.version}, what runs use when there is no copy.`
              : 'There is no published base.'
          }
        >
          <Differences
            items={baseChanged ? baseNow : []}
            empty="The base has not changed since you copied it."
          />
        </SectionPanel>
        <SectionPanel title="Yours">
          <Differences items={yours} empty="Nothing yet: this copy matches its base." />
        </SectionPanel>
        {canEdit && latest ? (
          <SectionPanel
            title="Bring It Up to Date"
            description="Keep your changes on the newest base, or start again from it."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button isPending={busy} onClick={onKeep}>
                <CheckIcon aria-hidden="true" className="size-4" />
                Keep Mine
              </Button>
              <Button variant="outline" intent="danger" onClick={onReset}>
                <RotateCcwIcon aria-hidden="true" className="size-4" />
                Start From Base
              </Button>
            </div>
          </SectionPanel>
        ) : null}
      </div>
    </aside>
  );
};
