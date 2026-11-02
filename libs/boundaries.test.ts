import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';

const libLayers = {
  kernel: [],
  platform: ['kernel'],
  domain: ['kernel'],
  data: ['kernel', 'platform', 'domain'],
  composition: ['kernel', 'domain']
} as const satisfies Record<string, readonly string[]>;

type Layer = keyof typeof libLayers;

const layers = Object.keys(libLayers) as Layer[];

const appLayers: Record<string, readonly Layer[]> = {
  web: ['kernel', 'domain', 'composition']
};

type Pkg = {
  name: string;
  dir: string;
  may: readonly Layer[];
  deps: string[];
};

const root = resolve(import.meta.dirname, '..');

const dirs = (path: string) =>
  readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

const load = (dir: string, may: readonly Layer[]): Pkg => {
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
  };
  return {
    name: json.name,
    dir,
    may,
    deps: Object.keys(json.dependencies ?? {}).filter((d) => d.startsWith('@ugula/'))
  };
};

const libDirs = dirs(join(root, 'libs'));

const libs = layers.flatMap((layer) =>
  dirs(join(root, 'libs', layer)).map((n) => ({
    ...load(join(root, 'libs', layer, n), libLayers[layer]),
    layer
  }))
);

const apps = dirs(join(root, 'apps')).map((n) =>
  load(join(root, 'apps', n), appLayers[n] ?? layers)
);

const layerOf = new Map(libs.map((p) => [p.name, p.layer]));

const sources = (dir: string) => [
  ...readdirSync(dir).filter((f) => /\.tsx?$/.test(f)),
  ...(readdirSync(join(dir, 'src'), { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join('src', f))
];

const specifiers = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/\b(?:from|import)\s*\(?\s*'([^']+)'/g)].map(
    (m) => m[1] ?? ''
  );

const imports = (pkg: Pkg) =>
  sources(pkg.dir).flatMap((f) => specifiers(join(pkg.dir, f)).map((s) => ({ file: f, s })));

const libImports = (pkg: Pkg) =>
  imports(pkg)
    .map(({ file, s }) => ({ file, lib: /^(@ugula\/[^/]+)/.exec(s)?.[1] }))
    .filter((i): i is { file: string; lib: string } => i.lib !== undefined);

test('every folder under libs is a layer', () => {
  assert.deepEqual(libDirs.toSorted(), layers.toSorted());
});

test('packages import only libs in layers below them', () => {
  const bad = [...libs, ...apps].flatMap((p) =>
    libImports(p)
      .filter(({ lib }) => {
        const layer = layerOf.get(lib);
        return layer === undefined || !p.may.includes(layer);
      })
      .map(({ file, lib }) => `${p.name} (${file}) -> ${lib} (${layerOf.get(lib) ?? 'unknown'})`)
  );
  assert.deepEqual(bad, []);
});

test('packages declare exactly the libs they import', () => {
  const bad = [...libs, ...apps].flatMap((p) => {
    const used = new Set(libImports(p).map((i) => i.lib));
    return [
      ...[...used]
        .filter((l) => !p.deps.includes(l))
        .map((l) => `${p.name} imports undeclared ${l}`),
      ...p.deps.filter((l) => !used.has(l)).map((l) => `${p.name} declares unused ${l}`)
    ];
  });
  assert.deepEqual(bad, []);
});

test('relative imports stay inside their package', () => {
  const bad = [...libs, ...apps].flatMap((p) =>
    imports(p)
      .filter(({ s }) => s.startsWith('.'))
      .filter(({ file, s }) => relative(p.dir, resolve(p.dir, file, '..', s)).startsWith('..'))
      .map(({ file, s }) => `${p.name} (${file}) -> ${s}`)
  );
  assert.deepEqual(bad, []);
});
