import { downloadText } from '../../shared/download.ts';

export type CsvCell = string | number | null;

const FORMULA = /^[=+\-@\t\r]/;

const NUMBER = /^[+-]?\d+(\.\d+)?$/;

const cell = (value: CsvCell) => {
  const raw = value === null ? '' : String(value);
  const text = FORMULA.test(raw) && !NUMBER.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (rows: readonly (readonly CsvCell[])[]) =>
  rows.map((row) => row.map(cell).join(',')).join('\r\n');

export const downloadCsv = (fileName: string, rows: readonly (readonly CsvCell[])[]) =>
  downloadText(fileName, toCsv(rows), 'text/csv;charset=utf-8');
