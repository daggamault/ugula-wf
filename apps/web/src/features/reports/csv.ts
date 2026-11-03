import { downloadText } from '../../shared/download.ts';

export type CsvCell = string | number | null;

const cell = (value: CsvCell) => {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (rows: readonly (readonly CsvCell[])[]) =>
  rows.map((row) => row.map(cell).join(',')).join('\r\n');

export const dollars = (cents: number) => (cents / 100).toFixed(2);

export const downloadCsv = (fileName: string, rows: readonly (readonly CsvCell[])[]) =>
  downloadText(fileName, toCsv(rows), 'text/csv;charset=utf-8');
