type Cell = string | number | boolean | null;

const quote = (cell: Cell) => {
  const text = cell === null ? '' : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (header: readonly string[], rows: readonly (readonly Cell[])[]) =>
  [header, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');

export const downloadCsv = (fileName: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};
