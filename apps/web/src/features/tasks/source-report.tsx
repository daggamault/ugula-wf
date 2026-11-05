import { describeCode, elementLabel } from '@ugula/nemsis';
import { CopyIcon } from 'lucide-react';
import { messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatDateTime } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { XmlTree } from '../../shared/ui/xml-tree.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { SourceReport, TasksClient } from './client.ts';
import { readPcr } from './pcr-reader.ts';
import { PcrSummaryView } from './pcr-summary.tsx';

export const SourceReportView = ({ source }: { source: SourceReport }) => {
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
        <Button variant="outline" onClick={() => void copy()}>
          <CopyIcon aria-hidden="true" className="size-4" />
          Copy XML
        </Button>
      }
    >
      <PcrSummaryView pcr={readPcr(source.data, source.dictionary)} />
      <details className="border-border border-t pt-4 text-sm">
        <summary
          className={classNamesOf(
            interactiveClasses,
            'text-surface-fg-muted hover:text-surface-fg w-fit rounded-lg select-none'
          )}
        >
          Show XML
        </summary>
        <div className="pt-3">
          <XmlTree
            label="Source Report"
            rootName="PatientCareReport"
            value={source.data}
            labelOf={(name) => elementLabel(name) ?? source.dictionary.elements[name] ?? null}
            meaningOf={(name, value) => describeCode(source.dictionary, name, value)}
          />
        </div>
      </details>
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
