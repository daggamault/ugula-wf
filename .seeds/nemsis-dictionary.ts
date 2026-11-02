import { gunzipSync } from 'node:zlib';
import type { Database } from '@ugula/db';
import { XMLParser } from 'fast-xml-parser';
import type { Kysely } from 'kysely';

/** A NEMSIS data element, e.g. eResponse.05 "Type of Service Requested". */
export type DictionaryElement = {
  element: string;
  name: string;
  definition: string;
  usage: string;
};

/**
 * One coded value. `list` is the element number for element values (eResponse.05) or the
 * attribute name prefixed with @ for attribute values shared by every element (@NV, @PN).
 */
export type DictionaryCode = {
  list: string;
  code: string;
  description: string;
};

export type Dictionary = {
  elements: DictionaryElement[];
  codes: DictionaryCode[];
};

/** Published 3.5.x releases, oldest first so later releases win when merged. */
export const NEMSIS_RELEASES = ['3.5.0', '3.5.1'] as const;

export const xsdZipUrl = (release: string) =>
  `https://nemsis.org/media/nemsis_v3/release-${release}/XSDs/NEMSIS_XSDs.zip`;

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute
});

const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null && !Array.isArray(x);

const childrenOf = (node: Node, key: string): Node[] => {
  const value = node[key];
  return Array.isArray(value) ? value.map((v) => (isNode(v) ? v : { '#text': v })) : [];
};

const first = (node: Node, ...path: string[]): Node | undefined => {
  let at: Node | undefined = node;
  for (const key of path) at = at && childrenOf(at, key)[0];
  return at;
};

const attr = (node: Node, name: string) => {
  const value = node[`@${name}`];
  return typeof value === 'string' ? value : undefined;
};

/** Collapses whitespace so a value fits on one line of the seed file. */
export const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim();

const textOf = (node: Node | undefined): string => {
  if (!node) return '';
  const own = node['#text'];
  return cleanText(typeof own === 'string' || typeof own === 'number' ? String(own) : '');
};

const local = (name: string) => name.slice(name.indexOf(':') + 1);

type Attribute = { name: string; info: TypeInfo };

type TypeInfo = {
  base?: string;
  members: string[];
  codes: [string, string][];
  attributes: Attribute[];
};

const refTo = (name: string): TypeInfo => ({
  base: local(name),
  members: [],
  codes: [],
  attributes: []
});

const EMPTY: TypeInfo = { members: [], codes: [], attributes: [] };

const enumerationsOf = (restriction: Node | undefined): [string, string][] =>
  restriction
    ? childrenOf(restriction, 'enumeration').map((e) => [
        attr(e, 'value') ?? '',
        textOf(first(e, 'annotation', 'documentation'))
      ])
    : [];

const attributesOf = (node: Node | undefined): Attribute[] =>
  node
    ? childrenOf(node, 'attribute').flatMap((a) => {
        const name = attr(a, 'name');
        if (!name) return [];
        const type = attr(a, 'type');
        const inline = first(a, 'simpleType');
        return [{ name, info: type ? refTo(type) : inline ? simpleInfo(inline) : EMPTY }];
      })
    : [];

const simpleInfo = (node: Node): TypeInfo => {
  const restriction = first(node, 'restriction');
  const base = restriction && attr(restriction, 'base');
  const union = first(node, 'union');
  return {
    ...(base ? { base: local(base) } : {}),
    members: (union && attr(union, 'memberTypes'))?.split(/\s+/).filter(Boolean).map(local) ?? [],
    codes: enumerationsOf(restriction),
    attributes: []
  };
};

const complexInfo = (node: Node): TypeInfo => {
  const content = first(node, 'simpleContent');
  const derived = content && (first(content, 'extension') ?? first(content, 'restriction'));
  const base = derived && attr(derived, 'base');
  return {
    ...(base ? { base: local(base) } : {}),
    members: [],
    codes: enumerationsOf(derived),
    attributes: [...attributesOf(derived), ...attributesOf(node)]
  };
};

const ELEMENT_NUMBER = /^[deis][A-Z][A-Za-z]+\.\d{2,3}$/;

type RawElement = DictionaryElement & { info: TypeInfo };

/** Named types and numbered elements from one XSD file. */
const scan = (xsd: string) => {
  const types = new Map<string, TypeInfo>();
  const elements: RawElement[] = [];
  const schema = childrenOf(parser.parse(xsd) as Node, 'schema')[0] ?? {};
  const visit = (node: Node) => {
    for (const t of childrenOf(node, 'simpleType')) {
      const name = attr(t, 'name');
      if (name) types.set(name, simpleInfo(t));
    }
    for (const t of childrenOf(node, 'complexType')) {
      const name = attr(t, 'name');
      if (name) types.set(name, complexInfo(t));
    }
    for (const e of childrenOf(node, 'element')) {
      const number = attr(e, 'name') ?? '';
      if (ELEMENT_NUMBER.test(number)) {
        const doc = first(e, 'annotation', 'documentation', 'nemsisTacDoc');
        const type = attr(e, 'type');
        const inlineSimple = first(e, 'simpleType');
        const inlineComplex = first(e, 'complexType');
        const info = type
          ? refTo(type)
          : inlineSimple
            ? simpleInfo(inlineSimple)
            : inlineComplex
              ? complexInfo(inlineComplex)
              : EMPTY;
        elements.push({
          element: number,
          name: doc ? textOf(first(doc, 'name')) : '',
          definition: doc ? textOf(first(doc, 'definition')) : '',
          usage: doc ? textOf(first(doc, 'usage')) : '',
          info
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@') || key === '#text' || !Array.isArray(value)) continue;
      for (const child of value) if (isNode(child)) visit(child);
    }
  };
  visit(schema);
  return { types, elements };
};

/** Builds the dictionary of one release from the text of all of its XSD files. */
export const parseXsds = (xsds: readonly string[]): Dictionary => {
  const types = new Map<string, TypeInfo>();
  const raw: RawElement[] = [];
  for (const xsd of xsds) {
    const scanned = scan(xsd);
    for (const [name, info] of scanned.types) types.set(name, info);
    raw.push(...scanned.elements);
  }
  const chain = (info: TypeInfo): TypeInfo[] => {
    const out: TypeInfo[] = [];
    const seen = new Set<string>();
    for (let at: TypeInfo | undefined = info; at; ) {
      out.push(at);
      const base = at.base;
      if (!base || seen.has(base)) break;
      seen.add(base);
      at = types.get(base);
    }
    return out;
  };
  const codesOf = (info: TypeInfo, depth = 0): [string, string][] => {
    if (depth > 20) return [];
    for (const t of chain(info)) {
      if (t.codes.length) return t.codes;
      if (t.members.length) {
        return t.members.flatMap((m) => {
          const member = types.get(m);
          return member ? codesOf(member, depth + 1) : [];
        });
      }
    }
    return [];
  };
  const codes = new Map<string, DictionaryCode>();
  const add = (list: string, [code, description]: [string, string]) => {
    if (code && description) codes.set(`${list}\t${code}`, { list, code, description });
  };
  const elements = new Map<string, DictionaryElement>();
  for (const { info, ...element } of raw) {
    if (!elements.has(element.element) || element.name) elements.set(element.element, element);
    for (const c of codesOf(info)) add(element.element, c);
    for (const a of chain(info).flatMap((t) => t.attributes)) {
      for (const c of codesOf(a.info)) add(`@${a.name}`, c);
    }
  }
  return {
    elements: [...elements.values()]
      .filter((e) => e.name)
      .sort((a, b) => compare(a.element, b.element)),
    codes: sortCodes([...codes.values()])
  };
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sortCodes = (codes: DictionaryCode[]) =>
  codes.sort((a, b) => compare(a.list, b.list) || compare(a.code, b.code));

/** Merges releases; later ones win, and values only older releases had stay readable. */
export const mergeDictionaries = (...dictionaries: Dictionary[]): Dictionary => {
  const elements = new Map<string, DictionaryElement>();
  const codes = new Map<string, DictionaryCode>();
  for (const d of dictionaries) {
    for (const e of d.elements) elements.set(e.element, e);
    for (const c of d.codes) codes.set(`${c.list}\t${c.code}`, c);
  }
  return {
    elements: [...elements.values()].sort((a, b) => compare(a.element, b.element)),
    codes: sortCodes([...codes.values()])
  };
};

const tsv = (rows: readonly string[][]) => `${rows.map((r) => r.join('\t')).join('\n')}\n`;

const rowsOf = (text: string) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));

export const elementsToTsv = (elements: readonly DictionaryElement[]) =>
  tsv(elements.map((e) => [e.element, e.name, e.definition, e.usage]));

export const codesToTsv = (codes: readonly DictionaryCode[]) =>
  tsv(codes.map((c) => [c.list, c.code, c.description]));

export const readElements = (gzipped: Buffer): DictionaryElement[] =>
  rowsOf(gunzipSync(gzipped).toString('utf8')).map(
    ([element = '', name = '', definition = '', usage = '']) => ({
      element,
      name,
      definition,
      usage
    })
  );

export const readCodes = (gzipped: Buffer): DictionaryCode[] =>
  rowsOf(gunzipSync(gzipped).toString('utf8')).map(([list = '', code = '', description = '']) => ({
    list,
    code,
    description
  }));

export const DICTIONARY_BATCH = 2_000;

export const buildUpsertElements = (db: Kysely<Database>, elements: readonly DictionaryElement[]) =>
  db
    .insertInto('nemsis_elements')
    .values(elements.map((e) => ({ ...e })))
    .onConflict((oc) =>
      oc.column('element').doUpdateSet({
        name: (eb) => eb.ref('excluded.name'),
        definition: (eb) => eb.ref('excluded.definition'),
        usage: (eb) => eb.ref('excluded.usage')
      })
    );

export const buildUpsertCodes = (db: Kysely<Database>, codes: readonly DictionaryCode[]) =>
  db
    .insertInto('nemsis_codes')
    .values(codes.map((c) => ({ ...c })))
    .onConflict((oc) =>
      oc
        .columns(['list', 'code'])
        .doUpdateSet({ description: (eb) => eb.ref('excluded.description') })
    );

export const upsertDictionary = async (db: Kysely<Database>, { elements, codes }: Dictionary) => {
  for (let i = 0; i < elements.length; i += DICTIONARY_BATCH) {
    await buildUpsertElements(db, elements.slice(i, i + DICTIONARY_BATCH)).execute();
  }
  for (let i = 0; i < codes.length; i += DICTIONARY_BATCH) {
    await buildUpsertCodes(db, codes.slice(i, i + DICTIONARY_BATCH)).execute();
  }
};
