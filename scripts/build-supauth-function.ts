#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const authServerDir = resolve(root, 'packages/auth-server');
const entrypoint = resolve(authServerDir, 'src/supacloud-function.ts');
const outdir = resolve(authServerDir, 'dist/supacloud-function');

// 构建只能消费已审核且未漂移的生成工厂，不在发布时静默重写。
const architectureCheck = Bun.spawnSync(['bun', '--no-env-file', 'run', 'app:compile:check'], {
  cwd: authServerDir,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (architectureCheck.exitCode !== 0) {
  throw new Error('SupAuth App 编译产物检查失败，请运行 app:compile 并审查变更');
}

const typeCheck = Bun.spawnSync(['bun', '--no-env-file', 'run', 'typecheck'], {
  cwd: authServerDir,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (typeCheck.exitCode !== 0) {
  throw new Error('SupAuth Function 类型检查失败，禁止打包未通过严格检查的候选产物');
}

function resolveRuntimeSafeEntry(packageName: string, entrypointName?: string) {
  try {
    return Bun.resolveSync(entrypointName ? `${packageName}/${entrypointName}` : packageName, authServerDir);
  } catch (error) {
    throw new Error(
      `无法解析 ${packageName}/${entrypointName}（基准目录：${authServerDir}）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const fileTypeEntry = resolveRuntimeSafeEntry('file-type');
const cuidBrowserEntry = resolve(root, 'node_modules/.bun/cuid@3.0.0/node_modules/cuid/dist/cuid.js');

const build = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  target: 'bun',
  format: 'esm',
  sourcemap: 'none',
  plugins: [
    {
      name: 'supauth-edge-runtime-safe-dependencies',
      setup(builder) {
        builder.onLoad({
          filter: /[\\/]elysia[\\/]dist[\\/]type[\\/](?:typebox-(?:type|value)|validator[\\/]exact-mirror)\.mjs$/,
        }, (args) => {
          // 保留原有注入、缓存与系统单例，仅将同步加载后备路径静态化。
          const source = readFileSync(args.path, 'utf8');
          const loaderImport = /^import \{ syncRequire \} from "\.\.?\/sync-require\.mjs";$/m;
          const loaderCall = 'syncRequire(import.meta, import.meta.url)';
          if (!loaderImport.test(source) || source.split(loaderCall).length !== 2) {
            throw new Error(`Elysia 同步加载器结构已变化：${args.path}`);
          }
          const modules = args.path.endsWith('typebox-type.mjs')
            ? ['typebox/type', 'typebox/system']
            : args.path.endsWith('typebox-value.mjs')
              ? ['typebox/value', 'typebox/schema', 'typebox/compile']
              : ['exact-mirror'];
          const imports = modules.map((specifier, index) =>
            `import * as supauthStaticDependency${index} from ${JSON.stringify(specifier)};`,
          ).join('\n');
          const entries = modules.map((specifier, index) =>
            `${JSON.stringify(specifier)}: supauthStaticDependency${index}`,
          ).join(', ');
          const staticLoader = `((specifier) => ({ ${entries} })[specifier])`;
          return {
            contents: source.replace(loaderImport, imports).replace(loaderCall, staticLoader),
            loader: 'js',
            resolveDir: dirname(args.path),
          };
        });
        builder.onResolve({ filter: /^file-type$/ }, () => {
          // Elysia 只使用 Blob/内存类型检测；file-type@22 的主入口不静态引入文件系统模块。
          return { path: fileTypeEntry, namespace: 'supauth-file-type' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'supauth-file-type' }, (args) => {
          const source = readFileSync(args.path, 'utf8');
          const runtimeImport = 'function importAtRuntime(specifier) {\n\treturn import(specifier);\n}';
          if (!source.includes(runtimeImport)) {
            throw new Error('file-type 主入口结构已变化，无法安全禁用 Node 文件系统动态导入');
          }
          return {
            contents: source.replace(
              runtimeImport,
              "function importAtRuntime() {\n\treturn Promise.reject(new Error('Edge Runtime 不支持 file-type 的文件系统入口'));\n}",
            ),
            loader: 'js',
            resolveDir: dirname(args.path),
          };
        });
        builder.onResolve({ filter: /^pg$/ }, () => ({ path: 'pg', namespace: 'supauth-pg' }));
        builder.onLoad({ filter: /.*/, namespace: 'supauth-pg' }, () => ({
          // ZenStack's optional PostgreSQL parser hook is not used by the Bun SQL dialect.
          // Keep the dynamic import resolved without shipping the Node pg driver to Edge.
          contents: `export const types = { builtins: { TIMESTAMP: 1114, DATE: 1082 }, setTypeParser() {} };\nexport default { types };`,
          loader: 'js',
        }));
        builder.onResolve({ filter: /^cuid$/ }, () => ({ path: cuidBrowserEntry }));
        builder.onResolve({ filter: /^@noble\/hashes\/(?:crypto|cryptoNode)(?:\.js)?$/ }, () => ({
          path: 'supauth-webcrypto',
          namespace: 'supauth-webcrypto',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'supauth-webcrypto' }, () => ({
          // ZenStack 的 CUID 生成只需要 WebCrypto；禁止把 Node 原生 crypto
          // loader 带入多租户 Edge Runtime。
          contents: 'export const crypto = globalThis.crypto;\nexport default crypto;\n',
          loader: 'js',
        }));
        builder.onResolve({ filter: /^fflate$/ }, () => {
          return { path: resolveRuntimeSafeEntry('fflate', 'browser') };
        });
      },
    },
  ],
});

if (!build.success) {
  const details = build.logs.map((log) => log.message).filter(Boolean).join('\n');
  throw new Error(`SupAuth Function 构建失败${details ? `：\n${details}` : ''}`);
}

const [bundle] = build.outputs;
if (build.outputs.length !== 1 || !bundle) {
  const outputs = build.outputs.map((output) => output.path).join(', ') || '(无输出)';
  throw new Error(`SupAuth Function 必须生成单文件 bundle，实际输出 ${build.outputs.length} 个：${outputs}`);
}

const bundleSource = readFileSync(bundle.path, 'utf8');
if (/__require\s*\(/.test(bundleSource)) {
  throw new Error('SupAuth Function bundle still contains native import.meta.require calls');
}
// Bun emits this helper whenever a CommonJS dependency is present, even when
// all call sites were eliminated by the Edge-safe dependency shims above.
// Remove the inert loader reference so artifact verification and the runtime
// cannot observe a forbidden native loader boundary.
writeFileSync(bundle.path, bundleSource.replace(
  'var __require = import.meta.require;',
  'var __require = undefined;',
));

console.log(`Built SupAuth Function bundle: ${bundle.path}`);
