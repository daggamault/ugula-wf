export type JsonViewProps = {
  value: unknown;
  label: string;
};

export const JsonView = ({ value, label }: JsonViewProps) => (
  <figure className="flex min-w-0 flex-col">
    <figcaption className="sr-only">{label}</figcaption>
    <pre className="border-border bg-canvas text-surface-fg max-h-80 overflow-auto rounded-xl border p-4 font-mono text-xs leading-relaxed">
      {value === undefined ? '—' : JSON.stringify(value, null, 2)}
    </pre>
  </figure>
);
