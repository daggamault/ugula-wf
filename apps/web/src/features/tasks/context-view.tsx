import { isRecord, type Json } from '@ugula/graph';
import type { ReactNode } from 'react';
import { ClaimIssues, isIssueList } from '../../shared/claims/claim-issues.tsx';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatCents, formatDate, formatDateTime, titleCaseWords } from '../../shared/format.ts';
import { AlertList } from '../../shared/ui/alert.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { JsonView } from '../../shared/ui/json-view.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { ClaimCheckView, isClaimCheck } from './claim-check.tsx';

type ContextViewProps = {
  value: Json | undefined;
  label: string;
};

const ACRONYMS = new Set(['id', 'pcr', 'iv', 'hcpcs', 'icd', 'npi', 'url']);

export const labelOf = (key: string) => {
  const words = key
    .replace(/Cents$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
  return words.length ? titleCaseWords(words, ACRONYMS) : key;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINKS: Record<string, { to: (id: string) => string; text: string }> = {
  claimId: { to: (id) => `/claims/${id}`, text: 'Open Claim' },
  runId: { to: (id) => `/runs/${id}`, text: 'Open Run' },
  taskId: { to: (id) => `/tasks/${id}`, text: 'Open Task' }
};

const isEmpty = (value: Json | undefined) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.values(value).every(isEmpty));

const isHidden = (key: string, value: Json | undefined) =>
  isEmpty(value) || (typeof value === 'string' && UUID.test(value) && !LINKS[key]);

const entriesOf = (value: Record<string, Json>) =>
  Object.entries(value).filter(([key, v]) => !isHidden(key, v));

const isRecordList = (value: Json): value is Record<string, Json>[] =>
  Array.isArray(value) && value.length > 0 && value.every(isRecord);

const scalarText = (key: string, value: Json): ReactNode => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return key.endsWith('Cents') ? formatCents(value) : value.toLocaleString();
  }
  if (typeof value !== 'string') return null;
  const link = LINKS[key];
  if (link && UUID.test(value)) return <TextLink to={link.to(value)}>{link.text}</TextLink>;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) {
    return formatDateTime(value);
  }
  return value;
};

const ValueText = ({ name, value }: { name: string; value: Json }): ReactNode => {
  if (Array.isArray(value)) {
    return value.every((v) => !isRecord(v) && !Array.isArray(v)) ? (
      value.map((v, i) => (
        <span key={`${i}-${String(v)}`}>
          {i ? ', ' : ''}
          {scalarText(name, v)}
        </span>
      ))
    ) : (
      <ul className="flex flex-col gap-1">
        {value.map((v, i) => (
          <li key={i}>
            <ValueText name={name} value={v} />
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    return (
      <dl className="flex flex-col gap-1">
        {entriesOf(value).map(([key, v]) => (
          <div key={key} className="flex flex-wrap gap-x-2">
            <dt className="text-surface-fg-muted">{labelOf(key)}</dt>
            <dd>
              <ValueText name={key} value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return scalarText(name, value);
};

const Fields = ({ value }: { value: Record<string, Json> }) => (
  <DetailList>
    {entriesOf(value).map(([key, v]) => (
      <Detail key={key} label={labelOf(key)}>
        <ValueText name={key} value={v} />
      </Detail>
    ))}
  </DetailList>
);

const subheading = 'text-surface-fg-muted text-xs font-semibold tracking-wide uppercase';

type Change = { field: string; was: Json; now: Json };

const isTextList = (x: Json | undefined): x is string[] =>
  Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string');

const isChangeList = (x: Json | undefined): x is Change[] =>
  Array.isArray(x) && x.every((c) => isRecord(c) && typeof c.field === 'string');

const changeText = (value: Json) =>
  value === null || value === '' ? emptyValue : (scalarText('', value) ?? JSON.stringify(value));

const Changes = ({ changes }: { changes: readonly Change[] }) => (
  <section className="flex flex-col gap-3">
    <h3 className={subheading}>
      Changes <span className="font-normal">({changes.length})</span>
    </h3>
    {changes.length ? (
      <Table label="Changes from the earlier report" head={['Field', 'Was', 'Now']}>
        {changes.map((c) => (
          <TableRow key={c.field}>
            <TableCell>{c.field}</TableCell>
            <TableCell kind="wrap" isMuted>
              {changeText(c.was)}
            </TableCell>
            <TableCell kind="wrap">{changeText(c.now)}</TableCell>
          </TableRow>
        ))}
      </Table>
    ) : (
      <EmptyText>Nothing billed from the report changed.</EmptyText>
    )}
  </section>
);

const NOTICES = {
  warnings: { intent: 'warning', title: 'Warnings' },
  notes: { intent: 'info', title: 'Notes' }
} as const;

const SPECIAL = new Set(['issues', 'warnings', 'notes', 'changes', 'claim']);

const ContextBody = ({ value, hasIssues }: { value: Record<string, Json>; hasIssues: boolean }) => {
  const entries = entriesOf(value).filter(([key]) => !SPECIAL.has(key));
  const simple = Object.fromEntries(
    entries.filter(([, v]) => !isRecord(v) && !isRecordList(v))
  ) as Record<string, Json>;
  const { issues, changes, claim } = value;
  const showIssues = !hasIssues && isIssueList(issues);
  return (
    <>
      {showIssues ? <ClaimIssues issues={issues} /> : null}
      {(['warnings', 'notes'] as const).map((key) => {
        const items = value[key];
        return isTextList(items) ? (
          <AlertList
            key={key}
            intent={NOTICES[key].intent}
            title={NOTICES[key].title}
            items={items.map((text) => ({ text }))}
          />
        ) : null;
      })}
      {Object.keys(simple).length ? <Fields value={simple} /> : null}
      {entries.map(([key, v]) =>
        isRecord(v) ? (
          <section key={key} className="flex flex-col gap-3">
            <h3 className={subheading}>{labelOf(key)}</h3>
            <Fields value={v} />
          </section>
        ) : isRecordList(v) ? (
          <section key={key} className="flex flex-col gap-3">
            <h3 className={subheading}>
              {labelOf(key)} <span className="font-normal">({v.length})</span>
            </h3>
            <ul className="flex flex-col gap-2">
              {v.map((item, i) => (
                <li key={i} className="border-border bg-surface rounded-xl border p-4">
                  <Fields value={item} />
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}
      {isChangeList(changes) ? <Changes changes={changes} /> : null}
      {isClaimCheck(claim) ? (
        <section className="flex flex-col gap-3">
          <h3 className={subheading}>Claim</h3>
          <ClaimCheckView claim={claim} />
        </section>
      ) : isRecord(claim) ? (
        <ContextBody value={claim} hasIssues={hasIssues || showIssues} />
      ) : null}
    </>
  );
};

export const ContextView = ({ value, label }: ContextViewProps) => {
  const raw = (
    <details className="group text-sm">
      <summary
        className={classNamesOf(
          interactiveClasses,
          'text-surface-fg-muted hover:text-surface-fg w-fit rounded-lg select-none'
        )}
      >
        Show Raw Data
      </summary>
      <div className="pt-2">
        <JsonView label={label} value={value} />
      </div>
    </details>
  );
  if (!isRecord(value)) {
    return isEmpty(value) ? null : (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{scalarText('', value as Json)}</p>
        {raw}
      </div>
    );
  }
  return (
    <figure aria-label={label} className="flex min-w-0 flex-col gap-5">
      <ContextBody value={value} hasIssues={false} />
      {raw}
    </figure>
  );
};
