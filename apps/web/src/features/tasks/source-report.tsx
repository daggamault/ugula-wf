import { describeCode, elementLabel } from '@ugula/nemsis';
import { CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatDateTime } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { XmlTree } from '../../shared/ui/xml-tree.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { SourceReport, TasksClient } from './client.ts';

type View = 'tree' | 'xml';

const VIEWS: readonly { value: View; label: string }[] = [
  { value: 'tree', label: 'Elements' },
  { value: 'xml', label: 'XML' }
];

export const SourceReportView = ({ source }: { source: SourceReport }) => {
  const [view, setView] = useState<View>('tree');
  const notify = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source.xml);
      notify({ title: 'XML copied to the clipboard' });
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not copy the XML', description: messageOf(err) });
    }
  };
  return (
    <SectionPanel
      title="Source Report"
      description={`Patient care report ${source.report.pcr_number ?? `#${source.report.position + 1}`} from ${source.report.file_name}, received ${formatDateTime(source.report.created_at)}.`}
      actions={
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">Show the report as</legend>
          {VIEWS.map((v) => (
            <Button
              key={v.value}
              variant={view === v.value ? 'solid' : 'outline'}
              aria-pressed={view === v.value}
              onClick={() => setView(v.value)}
            >
              {v.label}
            </Button>
          ))}
        </fieldset>
      }
    >
      {view === 'tree' ? (
        <XmlTree
          label="Source Report"
          rootName="PatientCareReport"
          value={source.data}
          labelOf={(name) => elementLabel(name) ?? source.dictionary.elements[name] ?? null}
          meaningOf={(name, value) => describeCode(source.dictionary, name, value)}
        />
      ) : (
        <figure aria-label="Source report XML" className="flex flex-col gap-2">
          <div>
            <Button variant="outline" onClick={() => void copy()}>
              <CopyIcon aria-hidden="true" className="size-4" />
              Copy XML
            </Button>
          </div>
          <pre className="border-border bg-canvas max-h-[32rem] overflow-auto rounded-xl border p-4 font-mono text-xs/6">
            {source.xml}
          </pre>
        </figure>
      )}
    </SectionPanel>
  );
};

export const SourceReportPanel = ({
  client,
  reportId
}: {
  client: TasksClient;
  reportId: string;
}) => {
  const report = useResource(`source-report:${reportId}`, () => client.report(reportId));
  if (report.error) return <Alert>{report.error.message}</Alert>;
  return report.data ? <SourceReportView source={report.data} /> : <PageLoading />;
};
