import { isRecord, type Json } from '@ugula/graph';
import { SearchIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { EmptyText } from './empty-state.tsx';
import { interactiveClasses } from './interactive.ts';

export type XmlAttribute = { name: string; value: string; meaning: string | null };

export type XmlNode = {
  name: string;
  label: string | null;
  attributes: XmlAttribute[];
  text: string | null;
  /** What a coded text value means, e.g. 2205001 → Emergency Response. */
  meaning: string | null;
  children: XmlNode[];
};

export type LabelOf = (name: string) => string | null;

/** Describes a coded value of an element, or of an attribute when the name starts with @. */
export type MeaningOf = (name: string, value: string) => string | null;

const noMeaning: MeaningOf = () => null;

const TEXT = '#text';

const scalar = (value: Json) => (value === null ? '' : String(value));

const toNodes = (name: string, value: Json, labelOf: LabelOf, meaningOf: MeaningOf): XmlNode[] => {
  if (Array.isArray(value)) return value.flatMap((v) => toNodes(name, v, labelOf, meaningOf));
  const label = labelOf(name);
  const meaning = (text: string | null) => (text ? meaningOf(name, text) : null);
  if (!isRecord(value)) {
    const text = scalar(value);
    return [{ name, label, attributes: [], text, meaning: meaning(text), children: [] }];
  }
  const entries = Object.entries(value);
  const attributes = entries
    .filter(([k]) => k.startsWith('@'))
    .map(([k, v]): XmlAttribute => {
      const text = scalar(v);
      return { name: k.slice(1), value: text, meaning: text ? meaningOf(k, text) : null };
    });
  const own = Object.hasOwn(value, TEXT) ? scalar(value[TEXT] ?? null) : null;
  return [
    {
      name,
      label,
      attributes,
      text: own,
      meaning: meaning(own),
      children: entries
        .filter(([k]) => k !== TEXT && !k.startsWith('@'))
        .flatMap(([k, v]) => toNodes(k, v, labelOf, meaningOf))
    }
  ];
};

export const xmlNodes = (
  name: string,
  value: Json,
  labelOf: LabelOf = () => null,
  meaningOf: MeaningOf = noMeaning
) => toNodes(name, value, labelOf, meaningOf);

const matches = (node: XmlNode, query: string) =>
  [
    node.name,
    node.label,
    node.text,
    node.meaning,
    ...node.attributes.flatMap((a) => [a.name, a.value, a.meaning])
  ].some((s) => s?.toLowerCase().includes(query));

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
      : node.attributes.map((a) => (
          <span key={a.name} className="text-info">
            {' '}
            {a.name}="{a.value}"
            {a.meaning ? (
              <span className="text-surface-fg-muted font-sans"> ({a.meaning})</span>
            ) : null}
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
        <summary
          className={classNamesOf(
            interactiveClasses,
            'hover:bg-surface-fg/6 rounded-lg px-1 select-none'
          )}
        >
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
      {node.meaning ? (
        <span className="text-surface-fg ml-2 font-sans text-xs font-medium">{node.meaning}</span>
      ) : null}
      <Label node={node} />
    </li>
  );

export type XmlTreeProps = {
  label: string;
  rootName: string;
  value: Json;
  labelOf?: LabelOf;
  meaningOf?: MeaningOf;
};

export const XmlTree = ({ label, rootName, value, labelOf, meaningOf }: XmlTreeProps) => {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const nodes = filterXml(xmlNodes(rootName, value, labelOf, meaningOf), query);
  return (
    <figure aria-label={label} className="flex min-w-0 flex-col gap-3">
      <label
        htmlFor={searchId}
        className="border-border bg-surface hover:bg-surface-hover focus-within:outline-primary flex h-10 items-center gap-2 rounded-lg border px-3 outline-2 outline-transparent transition duration-150 ease-out pointer-coarse:h-11"
      >
        <SearchIcon aria-hidden="true" className="text-surface-fg-muted size-4" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an Element, Label or Value"
          aria-label={`Search ${label}`}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
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
