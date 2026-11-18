import { Page } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { REMITTANCE_REPORT_PATH } from './remittance-report-page.tsx';

export const REPORTS_PATH = '/reports';

export const REPORTS: readonly { label: string; href: string; description: string }[] = [
  {
    label: 'Remittances',
    href: REMITTANCE_REPORT_PATH,
    description:
      'What payers deposited in a period, how it adds up from claim payments, and the payments that matched no claim.'
  }
];

export const ReportsPage = () => (
  <Page title="Reports">
    <SectionPanel title="Billing">
      <ul className="divide-border border-border flex flex-col divide-y rounded-xl border">
        {REPORTS.map((r) => (
          <li key={r.href} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
            <TextLink to={r.href}>{r.label}</TextLink>
            <span className="text-surface-fg-muted">{r.description}</span>
          </li>
        ))}
      </ul>
    </SectionPanel>
  </Page>
);
