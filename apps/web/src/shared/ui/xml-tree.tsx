import { isRecord, type Json } from '@ugula/graph';
import { SearchIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { EmptyText } from './empty-state.tsx';

export type XmlNode = {
  name: string;
  label: string | null;
  attributes: [string, string][];
  text: string | null;
  children: XmlNode[];
};

export type LabelOf = (name: string) => string | null;

const TEXT = '#text';

const scalar = (value: Json) => (value === null ? '' : String(value));

const toNodes = (name: string, value: Json, labelOf: LabelOf): XmlNode[] => {
  if (Array.isArray(value)) return value.flatMap((v) => toNodes(name, v, labelOf));
  const label = labelOf(name);
  if (!isRecord(value)) return [{ name, label, attributes: [], text: scalar(value), children: [] }];
  const entries = Object.entries(value);
  const attributes = entries
    .filter(([k]) => k.startsWith('@'))
    .map(([k, v]): [string, string] => [k.slice(1), scalar(v)]);
  const own = Object.hasOwn(value, TEXT) ? scalar(value[TEXT] ?? null) : null;
  return [
    {
      name,
      label,
      attributes,
      text: own,
      children: entries
        .filter(([k]) => k !== TEXT && !k.startsWith('@'))
        .flatMap(([k, v]) => toNodes(k, v, labelOf))
    }
  ];
};

export const xmlNodes = (name: string, value: Json, labelOf: LabelOf = () => null) =>
  toNodes(name, value, labelOf);

const matches = (node: XmlNode, query: string) =>
  [node.name, node.label, node.text, ...node.attributes.flat()].some((s) =>
    s?.toLowerCase().includes(query)
  );

export const filterXml = (nodes: readonly XmlNode[], query: string): XmlNode[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [...nodes];
  return nodes.flatMap((n) => {
    if (matches(n, q)) return [n];
    const children = filterXml(n.children, q);
    return children.length ? [{ ...n, children }] : [];
  });
};

const Tag = ({ node, closing = false }: { node: XmlNode; closing?: boolean }) => (
  <span className="text-primary">
    {closing ? '</' : '<'}
    {node.name}
    {closing
      ? null
      : node.attributes.map(([k, v]) => (
          <span key={k} className="text-info">
            {' '}
            {k}="{v}"
          </span>
        ))}
    {'>'}
  </span>
);

const Label = ({ node }: { node: XmlNode }) =>
  node.label ? (
    <span className="text-surface-fg-muted ml-2 font-sans text-xs">{node.label}</span>
  ) : null;

const Element = ({ node, depth, expanded }: { node: XmlNode; depth: number; expanded: boolean }) =>
  node.children.length ? (
    <li>
      <details open={expanded || depth < 2} className="group">
        <summary className="hover:bg-surface-fg/6 cursor-pointer rounded px-1 select-none">
          <Tag node={node} />
          <Label node={node} />
          <span className="text-surface-fg-muted group-open:hidden"> … {node.children.length}</span>
        </summary>
        <ul className="border-border ml-3 border-l pl-3">
          {node.children.map((c, i) => (
            <Element key={`${c.name}-${i}`} node={c} depth={depth + 1} expanded={expanded} />
          ))}
        </ul>
      </details>
    </li>
  ) : (
    <li className="px-1">
      <Tag node={node} />
      <span className="text-surface-fg break-words whitespace-pre-wrap">{node.text}</span>
      <Tag node={node} closing />
      <Label node={node} />
    </li>
  );

export type XmlTreeProps = {
  label: string;
  rootName: string;
  value: Json;
  labelOf?: LabelOf;
};

export const XmlTree = ({ label, rootName, value, labelOf }: XmlTreeProps) => {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const nodes = filterXml(xmlNodes(rootName, value, labelOf), query);
  return (
    <figure aria-label={label} className="flex min-w-0 flex-col gap-3">
      <label
        htmlFor={searchId}
        className="border-border bg-canvas focus-within:border-primary flex items-center gap-2 rounded-lg border px-3"
      >
        <SearchIcon aria-hidden="true" className="text-surface-fg-muted size-4" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an element, label or value"
          aria-label={`Search ${label}`}
          className="min-h-9 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {nodes.length ? (
        <ul className="max-h-[32rem] overflow-auto font-mono text-xs/6">
          {nodes.map((n, i) => (
            <Element key={`${n.name}-${i}`} node={n} depth={0} expanded={query.trim() !== ''} />
          ))}
        </ul>
      ) : (
        <EmptyText reason="noMatches">Nothing in this report matches “{query}”.</EmptyText>
      )}
    </figure>
  );
};
