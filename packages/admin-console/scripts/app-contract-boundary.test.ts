import { build, Transpiler, type BunPlugin } from 'bun';
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { extractSvelteSafetyRegions } from './static-safety-svelte.js';

const adminDirectory = fileURLToPath(new URL('../', import.meta.url));
const contractEntry = realpathSync(fileURLToPath(import.meta.resolve('@supacloud/contracts/client')));
const packageDirectory = dirname(dirname(contractEntry));
const virtualEntry = join(adminDirectory, '__contracts_boundary_entry__.js');
const expectedEntry = realpathSync(join(packageDirectory, 'dist/client.js'));
const expectedSharedEntry = realpathSync(join(packageDirectory, 'dist/index-cbp7cdwr.js'));
const expectedEntries = new Set([expectedEntry, expectedSharedEntry]);
const transpiler = new Transpiler({ loader: 'js', target: 'browser' });

// 来自已核验的 npm 0.3.1 发布包；升级必须重新审核发布物和依赖边界。
const artifactHashes = {
  'dist/client.js': '58afbe7818c96f2700559eb8b3c3376cb787e684baec1df11624a5b06b7501be',
  'dist/client.d.ts': 'fec3352c409e20bffe34dddcd1bcc09e5836f8816acfd6c88bcd28b37848b513',
  'dist/index-cbp7cdwr.js': '5a352f33ea612e76a97c42bcfea526f40aef9e0a8fc7b49c1f6d7ab0830e13b5',
  'dist/http_contract.d.ts': '5c742f85e2519046afa7c074d594f7e544eedbe04387f64fa33a06314784b747',
};

function checkRuntimeGraph(paths: ReadonlySet<string>): void {
  if (paths.size !== expectedEntries.size || [...expectedEntries].some((path) => !paths.has(path))) {
    throw new Error(`Unexpected contracts browser graph: ${JSON.stringify([...paths].sort())}`);
  }
}

function consumerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return consumerFiles(path);
    return entry.isFile() && /\.(?:[cm]?[jt]sx?|svelte)$/.test(entry.name) ? [path] : [];
  }).sort();
}

function unparenthesized(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  return expression;
}

function isRequireCallee(expression: ts.Expression): boolean {
  const callee = unparenthesized(expression);
  if (ts.isIdentifier(callee)) return callee.text === 'require';
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return false;
  const receiver = unparenthesized(callee.expression);
  if (!ts.isIdentifier(receiver) || receiver.text !== 'require') return false;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'resolve';
  const key = unparenthesized(callee.argumentExpression);
  return (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))
    && key.text === 'resolve';
}

function consumerImportViolations(source: string, filename: string): string[] {
  const violations: string[] = [];
  function inspect(text: string): void {
    const file = ts.createSourceFile(
      filename.endsWith('.svelte') ? `${filename}.ts` : filename,
      text, ts.ScriptTarget.Latest, true,
    );
    const visited = new Set<ts.Node>();
    function checkSpecifier(node: ts.Node | undefined): void {
      if (node === undefined
        || (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node))) {
        violations.push(`${filename}: import target must be a static string`);
        return;
      }
      const specifier = node.text;
      if (specifier === '@supacloud/contracts/client') return;
      if (specifier === '@supacloud/contracts' || specifier.startsWith('@supacloud/contracts/')) {
        violations.push(`${filename}: forbidden consumer import ${specifier}`);
        return;
      }
      if (/(?:^|[/\\])(?:@supacloud[/\\](?:app|compiler)(?:[/\\?#]|$)|@angular[/\\])/.test(specifier)) {
        violations.push(`${filename}: forbidden consumer import ${specifier}`);
      }
    }
    function visit(node: ts.Node): void {
      if (visited.has(node)) return;
      visited.add(node);
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isJSDocImportTag(node)) {
        if (node.moduleSpecifier !== undefined) checkSpecifier(node.moduleSpecifier);
      } else if (ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)) {
        checkSpecifier(node.moduleReference.expression);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        checkSpecifier(node.argument.literal);
      } else if (ts.isCallExpression(node)) {
        if (unparenthesized(node.expression).kind === ts.SyntaxKind.ImportKeyword
          || isRequireCallee(node.expression)) {
          checkSpecifier(node.arguments[0]);
        }
      }
      // forEachChild 不遍历附属 JSDoc；复用公开 API 并去重共享的类型节点。
      for (const doc of ts.getJSDocCommentsAndTags(node)) visit(doc);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  if (filename.endsWith('.svelte')) {
    const regions = extractSvelteSafetyRegions(source, filename);
    for (const script of regions.scripts) inspect(script.text);
    for (const region of regions.templateExpressions) {
      inspect(region.kind === 'statement' ? region.text : `(${region.text})`);
    }
  } else {
    inspect(source);
  }
  return violations;
}

describe('@supacloud/contracts/client published browser boundary', () => {
  test('all admin source consumers keep the narrow package entry', () => {
    const files = consumerFiles(join(adminDirectory, 'src'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith('.svelte'))).toBe(true);
    expect(files.flatMap((file) => consumerImportViolations(readFileSync(file, 'utf8'), file)))
      .toEqual([]);
  });

  test('consumer AST gate rejects root, deep, compiler and computed import forms', () => {
    for (const source of [
      "import { Module } from '@supacloud/app';",
      "import '@supacloud/contracts';",
      "import '@supacloud/contracts/browser';",
      "import '@angular/core';",
      "export * from '@supacloud/app';",
      "export { Injector } from '@supacloud/app/dist/injector.js';",
      "import type { Module } from '@supacloud/app';",
      "type Root = import('@supacloud/app').Module;",
      "import App = require('@supacloud/app');",
      "const app = require('@supacloud/app');",
      "require.resolve('@supacloud/app');",
      "const app = import('@supacloud/app');",
      'const app = import(`@supacloud/app`);',
      "import '@supacloud/compiler';",
      "import '../../node_modules/@supacloud/app/dist/index.js';",
      "import '@supacloud/app/contracts?raw';",
      "const target = '@supacloud/app'; import(target);",
      "import('@supacloud/' + 'app');",
    ]) {
      expect(consumerImportViolations(source, 'consumer.ts')).toHaveLength(1);
    }
  });

  test('consumer AST gate allows narrow imports without flagging comments or strings', () => {
    const source = `
import { createContractCommandClient } from '@supacloud/contracts/client';
export * from '@supacloud/contracts/client';
type Contract = import('@supacloud/contracts/client').CommandContract<string, string>;
const lazy = import('@supacloud/contracts/client');
const documentation = "import '@supacloud/app'";
// import '@angular/core';
`;
    expect(consumerImportViolations(source, 'consumer.ts')).toEqual([]);
  });

  test('consumer AST gate handles parenthesized require and element-access resolve', () => {
    for (const source of [
      '(require)("@supacloud/app");',
      '((require))("@supacloud/app");',
      'require["resolve"]("@angular/core");',
      '(require.resolve)("@supacloud/app");',
      '((require)["resolve"])("@angular/core");',
      '(require).resolve("@supacloud/app");',
      'require[`resolve`]("@angular/compiler");',
    ]) {
      expect(consumerImportViolations(source, 'consumer.js')).toHaveLength(1);
    }
    expect(consumerImportViolations(`
(require)("@supacloud/contracts/client");
((require)["resolve"])("@supacloud/contracts/client");
`, 'consumer.js')).toEqual([]);
  });

  test('consumer AST gate visits JSDoc imports once and preserves narrow types', () => {
    for (const source of [
      '/** @type {import("@supacloud/app").Module} */ let value;',
      '/** @typedef {import("@supacloud/app").Module} Module */',
      '/** @param {import("@angular/core").Injector} value */ function use(value) {}',
      '/** @import { Module } from "@supacloud/app" */',
    ]) {
      expect(consumerImportViolations(source, 'consumer.js')).toHaveLength(1);
    }
    expect(consumerImportViolations(`
/** @type {import("@supacloud/contracts/client").CommandOutcome<string>} */
let value;
/** @import { CommandOutcome } from "@supacloud/contracts/client" */
/** Documentation mentions import("@supacloud/app"), not a type declaration. */
const label = "import('@angular/core')";
`, 'consumer.js')).toEqual([]);
  });

  test('consumer AST gate covers both Svelte scripts and template imports', () => {
    for (const source of [
      "<script>import '@supacloud/app';</script>",
      "<script module>import '@angular/compiler';</script>",
      "{#await import('@supacloud/app')}loading{/await}",
    ]) {
      expect(consumerImportViolations(source, 'page.svelte')).toHaveLength(1);
    }
    expect(consumerImportViolations(`
<script lang="ts">
import { createContractCommandClient } from '@supacloud/contracts/client';
const label = "import '@supacloud/app'";
</script>
<p>{label}</p>
`, 'page.svelte')).toEqual([]);
  });

  test('resolves the reviewed 0.3.1 export and exact published artifacts', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
    );
    if (typeof manifest !== 'object' || manifest === null
      || !('name' in manifest) || !('version' in manifest)
      || !('exports' in manifest)) {
      throw new Error('Invalid installed @supacloud/contracts manifest');
    }
    expect(manifest.name).toBe('@supacloud/contracts');
    expect(manifest.version).toBe('0.3.1');
    expect(manifest.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
      './client': {
        types: './dist/client.d.ts',
        import: './dist/client.js',
      },
      './browser': {
        types: './dist/browser.d.ts',
        import: './dist/browser.js',
      },
    });
    const dependencies = 'dependencies' in manifest ? manifest.dependencies : undefined;
    expect(dependencies ?? {}).toEqual({});
    expect(contractEntry).toBe(expectedEntry);
    for (const [path, hash] of Object.entries(artifactHashes)) {
      const bytes = readFileSync(join(packageDirectory, path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
    }

    const runtime = readFileSync(expectedEntry, 'utf8');
    expect(Buffer.byteLength(runtime)).toBe(7567);
    const runtimeScan = transpiler.scan(runtime);
    expect(runtimeScan.imports).toEqual([{ kind: 'import-statement', path: './index-cbp7cdwr.js' }]);
    expect(runtimeScan.exports).toContain('createContractCommandClient');
    expect(runtimeScan.exports).toContain('createAuthoritativeCommandClient');
  });

  test('the real browser resolver loads only the self-contained contract runtime', async () => {
    const loadedPaths = new Set<string>();
    const requestedImports = new Set<string>();
    const graphPlugin: BunPlugin = {
          name: 'record-contracts-browser-graph',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === virtualEntry) return { path: virtualEntry, namespace: 'file' };
          requestedImports.add(args.path);
          // 不改写包解析，让 browser 条件及发布包 exports 真实参与解析。
          return undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
          if (args.path === virtualEntry) {
            return {
              contents: "export * from '@supacloud/contracts/client';",
              loader: 'js',
            };
          }
          loadedPaths.add(realpathSync(args.path));
          return undefined;
        });
      },
    };
    // Bun 的内存构建通过省略 outdir 实现，不写入 bundle 或临时入口文件。
    const result = await build({
      entrypoints: [virtualEntry],
      target: 'browser',
      format: 'esm',
      packages: 'bundle',
      external: [],
      plugins: [graphPlugin],
    });
    expect(result.success).toBe(true);
    expect(result.logs).toEqual([]);
    expect(new Set(requestedImports)).toEqual(new Set(['@supacloud/contracts/client', './index-cbp7cdwr.js']));
    checkRuntimeGraph(loadedPaths);
    expect(result.outputs).toHaveLength(1);
    const [output] = result.outputs;
    if (output === undefined) throw new Error('Browser bundle was not produced');
    expect(output.kind).toBe('entry-point');
    const bundled = await output.text();
    expect(bundled.length).toBeGreaterThan(0);
    const bundledScan = transpiler.scan(bundled);
    expect(bundledScan.imports).toEqual([]);
    expect(bundledScan.exports).toContain('createContractCommandClient');
    expect(bundledScan.exports).toContain('createAuthoritativeCommandClient');
  });

  test('the graph gate rejects missing runtime and every extra reachable module', () => {
    expect(() => checkRuntimeGraph(new Set())).toThrow('Unexpected contracts browser graph');
    for (const extra of [
      join(packageDirectory, 'dist/index.js'),
      join(packageDirectory, 'dist/browser.js'),
      join(packageDirectory, 'dist/decorators.js'),
      join(packageDirectory, 'dist/injector.js'),
      join(adminDirectory, 'node_modules/@angular/core/fesm2022/core.mjs'),
      join(adminDirectory, 'node_modules/@angular/compiler/fesm2022/compiler.mjs'),
      join(adminDirectory, 'node_modules/@supacloud/compiler/dist/index.js'),
      join(adminDirectory, '../app/src/contract_client.ts'),
    ]) {
      expect(() => checkRuntimeGraph(new Set([expectedEntry, expectedSharedEntry, extra])))
        .toThrow('Unexpected contracts browser graph');
    }
    expect(() => checkRuntimeGraph(expectedEntries)).not.toThrow();
  });
});
