import { isRecord, type Json } from '@ugula/graph';
import { useId, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { EmptyText } from './empty-state.tsx';
import { Input } from './input.tsx';
import { interactiveClasses } from './interactive.ts';

type XmlAttribute = { name: string; value: string; meaning: string | null };

type XmlNode = {
  path: string;
  name: string;
  label: string | null;
  attributes: XmlAttribute[];
  text: string | null;
  meaning: string | null;
  children: XmlNode[];
};

type LabelOf = (name: string) => string | null;

type MeaningOf = (name: string, value: string) => string | null;

const noMeaning: MeaningOf = () => null;

const TEXT = '#text';

const scalar = (value: Json) => (value === null ? '' : String(value));

type RawNode = Omit<XmlNode, 'path' | 'children'> & { children: RawNode[] };

const toNodes = (name: string, value: Json, labelOf: LabelOf, meaningOf: MeaningOf): RawNode[] => {
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

const withPaths = (nodes: readonly RawNode[], parent: string): XmlNode[] =>
  nodes.map((n, i) => {
    const path = parent ? `${parent}.${i}` : String(i);
    return { ...n, path, children: withPaths(n.children, path) };
  });

export const xmlNodes = (
  name: string,
  value: Json,
  labelOf: LabelOf = () => null,
  meaningOf: MeaningOf = noMeaning
) => withPaths(toNodes(name, value, labelOf, meaningOf), '');

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

type Toggled = ReadonlyMap<string, boolean>;

type ElementProps = {
  node: XmlNode;
  depth: number;
  expanded: boolean;
  toggled: Toggled;
  onToggle: (path: string, isOpen: boolean) => void;
};

const Element = ({ node, depth, expanded, toggled, onToggle }: ElementProps) => {
  if (!node.children.length) {
    return (
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
  }
  const isOpen = toggled.get(node.path) ?? (expanded || depth < 2);
  return (
    <li>
      <details
        open={isOpen}
        onToggle={(e) => {
          if (e.currentTarget.open !== isOpen) onToggle(node.path, e.currentTarget.open);
        }}
        className="group"
      >
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
          {node.children.map((c) => (
            <Element
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggled={toggled}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </details>
    </li>
  );
};

type XmlTreeProps = {
  label: string;
  rootName: string;
  value: Json;
  labelOf?: LabelOf;
  meaningOf?: MeaningOf;
};

export const XmlTree = ({ label, rootName, value, labelOf, meaningOf }: XmlTreeProps) => {
  const [query, setQuery] = useState('');
  const [toggled, setToggled] = useState<Toggled>(new Map());
  const searchId = useId();
  const nodes = filterXml(xmlNodes(rootName, value, labelOf, meaningOf), query);
  const expanded = query.trim() !== '';
  const onToggle = (path: string, isOpen: boolean) =>
    setToggled((t) => new Map(t).set(path, isOpen));
  return (
    <figure aria-label={label} className="flex min-w-0 flex-col gap-3">
      <Input
        id={searchId}
        label={`Search ${label}`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find an element, label or value"
      />
      {nodes.length ? (
        <ul className="overflow-x-auto font-mono text-xs/6">
          {nodes.map((n) => (
            <Element
              key={n.path}
              node={n}
              depth={0}
              expanded={expanded}
              toggled={toggled}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : (
        <EmptyText reason="noMatches">Nothing in this report matches “{query}”.</EmptyText>
      )}
    </figure>
  );
};
