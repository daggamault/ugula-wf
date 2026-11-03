import type { ReactNode } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import type { ReportColumn } from './report-columns.ts';

export type ReportDocumentProps<R> = {
  title: string;
  details: readonly ReactNode[];
  columns: readonly ReportColumn<R>[];
  rows: readonly R[];
  totals: readonly string[] | null;
};

const cellClasses = (isNumeric: boolean | undefined) =>
  classNamesOf('px-2 py-1.5 text-left align-top', isNumeric && 'tabular-nums');

export const ReportDocument = <R,>({
  title,
  details,
  columns,
  rows,
  totals
}: ReportDocumentProps<R>) => (
  <article className="rounded-xl border border-gray-300 bg-white p-6 text-black sm:p-8 print:rounded-none print:border-0 print:p-0">
    <header className="mb-5 flex flex-col gap-1 border-b border-gray-400 pb-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {details.map((d, i) => (
        <p key={i} className="text-sm text-gray-600">
          {d}
        </p>
      ))}
    </header>
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-gray-800">
            {columns.map((c) => (
              <th key={c.label} scope="col" className={cellClasses(c.isNumeric)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="break-inside-avoid border-b border-gray-200 even:bg-gray-50">
              {columns.map((c) => (
                <td key={c.label} className={cellClasses(c.isNumeric)}>
                  {c.text(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-bold">
              {totals.map((t, i) => (
                <td key={columns[i]?.label ?? i} className={cellClasses(columns[i]?.isNumeric)}>
                  {t}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  </article>
);
