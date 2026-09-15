import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('@tanstack/svelte-query/package.json')), 'dist');
const declaration = join(dist, 'containers.d.svelte.ts');
const options: ts.CompilerOptions = {
  strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
  noImplicitOverride: true, noPropertyAccessFromIndexSignature: true,
  noFallthroughCasesInSwitch: true, skipLibCheck: false, noEmit: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
  lib: ['lib.es2022.d.ts'], types: [],
};

function diagnose(text: string) {
  const fixture = fileURLToPath(new URL('./__tanstack_declarations__.ts', import.meta.url));
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) => name === fixture
    ? ts.createSourceFile(fixture, text, ts.ScriptTarget.ES2022, true)
    : original(name, ...args);
  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host)).map(diagnostic => ({
    code: diagnostic.code,
    file: diagnostic.file?.fileName,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

test('the native Svelte redirect preserves real exports and unchanged implementation', () => {
  expect(readFileSync(declaration, 'utf8')).toBe("export * from './containers.svelte.js';\n");
  const hash = (file: string): string => createHash('sha256')
    .update(readFileSync(join(dist, file))).digest('hex');
  expect(hash('containers.svelte.js')).toBe('6cc48ea049d78b9650aa41f19ac6c8ddc64b4c923fb51f0d0f8d24de962450b3');
  expect(hash('containers.svelte.d.ts')).toBe('f9c67becbd1406702196f9a3617467787c5f479895923eca0b689398337d1a11');
});

test('the native Svelte redirect retains generic inference without inventing a default export', () => {
  const specifier = JSON.stringify(declaration);
  const positive = `
    import type { ReactiveValue, createRawRef, Box } from ${specifier};
    declare const Reactive: typeof ReactiveValue;
    declare const create: typeof createRawRef;
    const reactive = new Reactive(() => 1, () => {});
    const box: Box<number> = reactive;
    const count: number = box.current;
    const [state, update] = create({ name: 'valid' });
    update({ name: 'next' });
    const name: string = state.name;
    type HasDefault = 'default' extends keyof typeof import(${specifier}) ? true : false;
    const hasDefault: HasDefault = false;
  `;
  expect(diagnose(positive)).toEqual([]);
  const rejected = diagnose(`${positive}
    const wrong: string = reactive.current;
    update({ name: 1 });
    const inventedDefault: HasDefault = true;
  `);
  expect(rejected.map(diagnostic => diagnostic.code)).toEqual([2322, 2322, 2322]);
  expect(rejected.every(diagnostic => diagnostic.file?.endsWith('/__tanstack_declarations__.ts'))).toBe(true);
});
