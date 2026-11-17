import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

type Pkg = {
  name: string;
  dir: string;
  deps: string[];
  foreign: string[];
};

const root = resolve(import.meta.dirname, '..');

const dirs = (path: string) =>
  readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

const load = (dir: string): Pkg => {
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const all = { ...json.devDependencies, ...json.peerDependencies, ...json.dependencies };
  return {
    name: json.name,
    dir,
    deps: Object.keys(json.dependencies ?? {}).filter((d) => d.startsWith('@ugula/')),
    foreign: Object.entries(all)
      .filter(([d, v]) => !d.startsWith('@ugula/') || v !== 'workspace:*')
      .map(([d, v]) => `${d}@${v}`)
  };
};

const libDirs = dirs(join(root, 'libs'));

const libs = layers.flatMap((layer) =>
  dirs(join(root, 'libs', layer)).map((n) => ({
    ...load(join(root, 'libs', layer, n)),
    layer
  }))
);

const apps = dirs(join(root, 'apps')).map((n) => load(join(root, 'apps', n)));

const sourceDirs = ['src'];

const sources = (dir: string) => [
  ...readdirSync(dir).filter((f) => /\.tsx?$/.test(f)),
  ...sourceDirs
    .filter((d) => existsSync(join(dir, d)))
    .flatMap((d) =>
      (readdirSync(join(dir, d), { recursive: true, encoding: 'utf8' }) as string[])
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(d, f))
    )
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

test('biome lets each layer import exactly the libs in the layers below it', () => {
  const biome = JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8')) as {
    overrides: {
      includes: string[];
      linter?: {
        rules?: {
          style?: { noRestrictedImports?: { options: { patterns: { group: string[] }[] } } };
        };
      };
    }[];
  };
  const allowed = (layer: Layer) =>
    biome.overrides
      .find((o) => o.includes.includes(`libs/${layer}/**`))
      ?.linter?.rules?.style?.noRestrictedImports?.options.patterns.flatMap((p) => p.group)
      .filter((g) => g.startsWith('!@ugula/') && !g.endsWith('/**'))
      .map((g) => g.slice(1))
      .toSorted();
  for (const layer of layers) {
    const below = libs
      .filter((l) => (libLayers[layer] as readonly Layer[]).includes(l.layer))
      .map((l) => l.name)
      .toSorted();
    assert.deepEqual(allowed(layer), below, layer);
  }
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

test('workspace packages declare only libs, linked as workspace:*', () => {
  const bad = [...libs, ...apps].flatMap((p) => p.foreign.map((d) => `${p.name} declares ${d}`));
  assert.deepEqual(bad, []);
});

test('the root declares exactly the libs its scripts import', () => {
  const pkg = load(root);
  const used = new Set(
    ['.migrations', '.seeds'].flatMap((d) =>
      (readdirSync(join(root, d), { recursive: true, encoding: 'utf8' }) as string[])
        .filter((f) => /\.tsx?$/.test(f))
        .flatMap((f) => specifiers(join(root, d, f)))
        .map((s) => /^(@ugula\/[^/]+)/.exec(s)?.[1])
        .filter((l) => l !== undefined)
    )
  );
  assert.deepEqual(pkg.deps.toSorted(), [...used].toSorted());
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
