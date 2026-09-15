import { describe, expect, it } from 'bun:test';
import ts from 'typescript';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectStaticSafety, inspectStrictOptions } from '../scripts/static-safety.js';
import { uncoveredSourceFiles, readCheckedProject, maintainedSourceFiles } from '../scripts/static-safety-projects.js';
import { inspectMaintainedSource } from '../scripts/static-safety-check.js';

describe('Node automation runtime contract', () => {
  it('checks actual Node built-ins and rejects browser-only globals', () => {
    const config = new URL('../.github/tsconfig.json', import.meta.url).pathname;
    const parsed = ts.getParsedCommandLineOfConfigFile(config, { noEmit: true, incremental: false }, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: diagnostic => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    });
    if (!parsed || parsed.errors.length) throw new Error('Cannot parse Node automation project');
    expect(inspectStrictOptions(parsed.options)).toEqual([]);
    const file = new URL('../.github/scripts/__node_runtime_contract__.mjs', import.meta.url).pathname;
    const diagnostics = (text: string) => {
      const host = ts.createCompilerHost(parsed.options);
      const original = host.getSourceFile.bind(host);
      host.getSourceFile = (name, ...args) => name === file
        ? ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
        : original(name, ...args);
      const program = ts.createProgram([...parsed.fileNames, file], parsed.options, host);
      expect(program.getSourceFiles().some(source => source.fileName.endsWith('/lib.dom.d.ts'))).toBe(false);
      return ts.getPreEmitDiagnostics(program).map(diagnostic => ({
        code: diagnostic.code,
        file: diagnostic.file?.fileName,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }));
    };
    const positive = 'export const value = Buffer.from("valid"); const response = Response.json({ pid: process.pid });';
    expect(diagnostics(positive)).toEqual([]);
    const rejected = diagnostics(`${positive}\ndocument.querySelector("body");\nwindow.alert("invalid");`);
    expect(rejected.map(diagnostic => diagnostic.code).sort()).toEqual([2304, 2584]);
    expect(rejected.every(diagnostic => diagnostic.file === file)).toBe(true);
  }, 20_000);
});

describe('static safety syntax gate', () => {
  it('rejects explicit any, unchecked double assertions and non-null assertions', () => {
    expect(inspectStaticSafety('let a: any; const b = a as unknown as string; b!;', 'test.ts')
      .map(issue => issue.code)).toEqual(['explicit_any', 'double_assertion', 'non_null_assertion']);
    expect(inspectStaticSafety('const a = (<unknown>value) as string;', 'test.ts'))
      .toContainEqual({ file: 'test.ts', line: 1, code: 'double_assertion' });
  });

  it('rejects definite assignment assertions and JavaScript any annotations', () => {
    expect(inspectStaticSafety('class A { value!: string; }', 'test.ts')[0]?.code).toBe('non_null_assertion');
    expect(inspectStaticSafety('/** @type {any} */ let value;', 'test.js')
      .some(issue => issue.code === 'explicit_any')).toBe(true);
  });

  it('rejects disabled checks only in comments, not in test fixture strings', () => {
    expect(inspectStaticSafety('// @ts-ignore\nconst x = 1;', 'test.ts')[0]?.code).toBe('suppressed_check');
    expect(inspectStaticSafety('/* @ts-nocheck */', 'test.ts')[0]?.code).toBe('suppressed_check');
    expect(inspectStaticSafety('/* eslint-disable */', 'test.ts')[0]?.code).toBe('suppressed_check');
    expect(inspectStaticSafety('const text = "// @ts-ignore";', 'test.ts')).toEqual([]);
  });

  it('permits narrowing, literal preservation, and diagnostic-tested negative fixtures', () => {
    expect(inspectStaticSafety(`
      const value: unknown = JSON.parse("{}");
      const options = { mode: "strict" } as const;
      // @ts-expect-error regression: wrong input type must fail compilation
      const invalid: string = 1;
    `, 'packages/sdks/typescript/consumers/browser.ts')).toEqual([]);
  });

  it('keeps template and regular-expression text separate from real comments', () => {
    expect(inspectStaticSafety('const text = `x${1}`; // @ts-ignore\nconst x: number = "bad";', 'test.ts')
      .some(issue => issue.code === 'suppressed_check')).toBe(true);
    expect(inspectStaticSafety('const text = `x${1} // @ts-ignore`;', 'test.ts')).toEqual([]);
    expect(inspectStaticSafety('const regex = /[//] @ts-ignore/;', 'test.ts')).toEqual([]);
    expect(inspectStaticSafety('const text = `${/* @ts-ignore */ 1}`;', 'test.ts')
      .some(issue => issue.code === 'suppressed_check')).toBe(true);
  });

  it('distinguishes JSX text from comments and visits empty-container trivia', () => {
    expect(inspectStaticSafety('const x = <div>// @ts-ignore</div>;', 'test.tsx')).toEqual([]);
    for (const text of [
      'const x = <div>{/* @ts-ignore */}</div>;',
      'function f() { /* eslint-disable */ }',
      'const f = { /* @ts-ignore */ };',
      'const f = [ /* @ts-ignore */ ];',
      'const f = () => { /* @ts-nocheck */ };',
    ]) {
      expect(inspectStaticSafety(text, 'test.tsx').some(issue => issue.code === 'suppressed_check')).toBe(true);
    }
  });

  it('rejects JSDoc aliases for any and casts through transparent wrappers', () => {
    for (const text of ['/** @type {*} */ let a;', '/** @type {?} */ let b;',
      '/** @param {Array<*>} a */ function test(a) {}', '/** @returns {?} */ function test() { return 1; }']) {
      expect(inspectStaticSafety(text, 'test.js').some(issue => issue.code === 'explicit_any')).toBe(true);
    }
    expect(inspectStaticSafety('const v = ((42 as unknown) satisfies unknown) as string;', 'test.ts')
      .some(issue => issue.code === 'double_assertion')).toBe(true);
    expect(inspectStaticSafety('const v = /** @type {string} */ (/** @type {unknown} */ (42));', 'test.js')
      .some(issue => issue.code === 'double_assertion')).toBe(true);
    expect(inspectStaticSafety('const v = [1, 2] as const as readonly number[];', 'test.ts')).toEqual([]);
    expect(inspectStaticSafety('const v = 42 as const as unknown as string;', 'test.ts')
      .some(issue => issue.code === 'double_assertion')).toBe(true);
  });

  it('rejects unregistered or unexplained expected errors and syntax errors', () => {
    expect(inspectStaticSafety('// @ts-expect-error regression\nconst v: string = 1;', 'src/app.ts')[0]?.code)
      .toBe('suppressed_check');
    expect(inspectStaticSafety('// @ts-expect-error\nconst v: string = 1;', 'packages/sdks/typescript/consumers/browser.ts')[0]?.code)
      .toBe('suppressed_check');
    expect(inspectStaticSafety('// biome-ignore lint/suspicious/noExplicitAny: reason', 'test.ts')[0]?.code)
      .toBe('suppressed_check');
    expect(inspectStaticSafety('const x: = ;', 'broken.ts').some(issue => issue.code === 'syntax_error')).toBe(true);
  });
});

describe('maintained source coverage', () => {
  it('rejects a maintained source absent from all executed checking projects', () => {
    expect(uncoveredSourceFiles(['/repo/a.ts', '/repo/b.svelte'], [{
      config: 'tsconfig.json', files: ['/repo/a.ts'], errors: [],
    }])).toEqual(['/repo/b.svelte']);
  });

  it('counts overlap once and normalizes file paths', () => {
    expect(uncoveredSourceFiles(['/repo/a.ts'], [
      { config: 'one.json', files: ['/repo/nested/../a.ts'], errors: [] },
      { config: 'two.json', files: ['/repo/a.ts'], errors: [] },
    ])).toEqual([]);
  });

  it('reads inherited effective options and reports missing or invalid projects', () => {
    const root = mkdtempSync(join(tmpdir(), 'supauth-strict-project-'));
    try {
      writeFileSync(join(root, 'base.json'), JSON.stringify({ compilerOptions: {
        strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
        noImplicitOverride: true, noPropertyAccessFromIndexSignature: true,
        noFallthroughCasesInSwitch: true, skipLibCheck: false,
      } }));
      writeFileSync(join(root, 'entry.ts'), 'export const value = 1;');
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
        extends: './base.json', compilerOptions: { noCheck: true }, include: ['entry.ts'],
      }));
      const result = readCheckedProject(root, 'tsconfig.json');
      expect(result.files).toEqual([join(root, 'entry.ts')]);
      expect(result.errors).toEqual(['noCheck disables checking']);
      expect(readCheckedProject(root, 'missing.json').errors.length).toBeGreaterThan(0);
      writeFileSync(join(root, 'tsconfig.json'), '{');
      expect(readCheckedProject(root, 'tsconfig.json').errors.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('counts maintained automation independently of configuration and rejects symlink gaps', () => {
    const root = mkdtempSync(join(tmpdir(), 'supauth-strict-inventory-'));
    try {
      for (const directory of ['packages', 'scripts', 'tests', '.github/scripts']) {
        mkdirSync(join(root, directory), { recursive: true });
      }
      const automation = join(root, '.github/scripts/review.mjs');
      writeFileSync(automation, 'export const value = 1;');
      writeFileSync(join(root, 'vite.config.js'), 'export {};');
      expect(maintainedSourceFiles(root)).toContain(automation);
      symlinkSync(automation, join(root, 'scripts/linked.mjs'));
      expect(() => maintainedSourceFiles(root)).toThrow('symlink');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects linked entry roots, intermediate directories and the explicit sentinel', () => {
    for (const linked of ['scripts', '.github', 'vite.config.js']) {
      const root = mkdtempSync(join(tmpdir(), 'supauth-strict-root-link-'));
      try {
        for (const directory of ['packages', 'scripts', 'tests', '.github/scripts', 'external/scripts']) {
          mkdirSync(join(root, directory), { recursive: true });
        }
        const sentinel = join(root, 'vite.config.js');
        writeFileSync(sentinel, 'export {};');
        const link = join(root, linked);
        rmSync(link, { recursive: true, force: true });
        symlinkSync(linked.endsWith('.js') ? join(root, 'external/entry.mjs') : join(root, 'external'), link);
        expect(() => maintainedSourceFiles(root)).toThrow('symlink');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});

describe('Svelte syntax safety integration', () => {
  it('checks scripts and template expressions at original source lines', () => {
    const text = '<script lang="ts">\nlet value: unknown;\n</script>\n<p>{value as unknown as string}</p>';
    expect(inspectMaintainedSource(text, 'page.svelte')).toEqual([
      { file: 'page.svelte', line: 4, code: 'double_assertion' },
    ]);
  });

  it('does not scan visible prose or CSS as application TypeScript', () => {
    expect(inspectMaintainedSource('<p>any as unknown as number!</p><style>p { color: red; }</style>', 'page.svelte'))
      .toEqual([]);
  });

  it('fails on malformed Svelte instead of treating it as an empty file', () => {
    expect(() => inspectMaintainedSource('<script>const =</script>', 'page.svelte')).toThrow();
  });
});

describe('effective strict compiler options', () => {
  const options = {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noPropertyAccessFromIndexSignature: true,
    noFallthroughCasesInSwitch: true,
    skipLibCheck: false,
  } satisfies ts.CompilerOptions;

  it('requires all practical strict flags and dependency declaration checks', () => {
    expect(inspectStrictOptions(options)).toEqual([]);
    expect(inspectStrictOptions({ ...options, skipLibCheck: true })).toContain('skipLibCheck must be false');
    expect(inspectStrictOptions({ ...options, noPropertyAccessFromIndexSignature: false }))
      .toContain('noPropertyAccessFromIndexSignature');
  });

  it('detects strict overrides and unchecked JavaScript', () => {
    expect(inspectStrictOptions({ ...options, noImplicitAny: false })).toContain('noImplicitAny overrides strict');
    expect(inspectStrictOptions({ ...options, allowJs: true, checkJs: false })).toContain('allowJs requires checkJs');
    expect(inspectStrictOptions({ ...options, noCheck: true })).toContain('noCheck disables checking');
    expect(inspectStrictOptions({ ...options, skipDefaultLibCheck: true })).toContain('skipDefaultLibCheck disables declaration checking');
    expect(inspectStrictOptions({ ...options, strictBuiltinIteratorReturn: false })).toContain('strictBuiltinIteratorReturn overrides strict');
  });
});
