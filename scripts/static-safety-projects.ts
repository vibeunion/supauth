import { lstatSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { inspectStrictOptions } from './static-safety.js';

// 此列表对应 check:type-safety 执行的项目，不用未执行的根 tsconfig 虚增覆盖率。
export const CHECKED_PROJECTS = [
  'tsconfig.tooling.json',
  '.github/tsconfig.json',
  'packages/auth-server/tsconfig.json',
  'packages/admin-console/jsconfig.json',
  'packages/admin-console/scripts/tsconfig.json',
  'packages/admin-console/tsconfig.config.json',
  'packages/admin-console/tsconfig.bun.json',
  'packages/shared/tsconfig.test.json',
  'packages/sdks/typescript/tsconfig.test.json',
  'packages/sdks/typescript/tsconfig.contracts.json',
  'packages/sdks/typescript/tsconfig.consumer.json',
  'packages/sdks/typescript/tsconfig.worker.json',
  'packages/sdks/typescript/tsconfig.tooling.json',
  'packages/sdks/auth-ui/tsconfig.json',
  'packages/sdks/auth-ui/tsconfig.consumer-dom.json',
  'packages/sdks/auth-ui/tsconfig.consumer-worker.json',
  'packages/authorization-core/tsconfig.test.json',
  'packages/authorization-postgres/tsconfig.test.json',
  'packages/authorization-conformance/tsconfig.test.json',
] as const;

const OUTPUT_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.svelte-kit', '.git']);
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|svelte)$/;

export function maintainedSourceFiles(root: string): string[] {
  const files: string[] = [];
  const assertOwnedPath = (path: string): void => {
    let current = resolve(root);
    for (const part of ['', ...relative(root, path).split(sep)]) {
      if (part) current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`Maintained source symlink requires an explicit checked owner: ${relative(root, current) || '.'}`);
      }
    }
  };
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (OUTPUT_DIRECTORIES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Maintained source symlink requires an explicit checked owner: ${relative(root, path)}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) files.push(path);
    }
  };
  for (const directory of ['packages', 'scripts', 'tests', '.github/scripts']) {
    const path = resolve(root, directory);
    assertOwnedPath(path);
    walk(path);
  }
  // 根 UI 历史代码已退休；只维护这个阻止误构建的可执行哨兵。
  const sentinel = resolve(root, 'vite.config.js');
  assertOwnedPath(sentinel);
  if (!lstatSync(sentinel).isFile()) throw new Error('Retired Vite entry must be a checked file');
  files.push(sentinel);
  return files.sort();
}

export interface CheckedProject {
  config: string;
  files: string[];
  errors: string[];
}

export function readCheckedProject(root: string, config: string): CheckedProject {
  const errors: string[] = [];
  const diagnostic = (value: ts.Diagnostic): void => {
    errors.push(ts.flattenDiagnosticMessageText(value.messageText, '\n'));
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(root, config), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic,
  }, undefined, undefined, [{ extension: '.svelte', scriptKind: ts.ScriptKind.Deferred, isMixedContent: true }]);
  if (!parsed) return { config, files: [], errors };
  for (const error of parsed.errors) diagnostic(error);
  errors.push(...inspectStrictOptions(parsed.options));
  return { config, files: parsed.fileNames, errors };
}

export function uncoveredSourceFiles(files: readonly string[], projects: readonly CheckedProject[]): string[] {
  const covered = new Set(projects.flatMap(project => project.files.map(file => resolve(file))));
  return files.filter(file => !covered.has(resolve(file)));
}

export function inspectProjectCoverage(root: string): {
  files: string[];
  projects: CheckedProject[];
  uncovered: string[];
} {
  const files = maintainedSourceFiles(root);
  const projects = CHECKED_PROJECTS.map(config => readCheckedProject(root, config));
  return { files, projects, uncovered: uncoveredSourceFiles(files, projects).map(file => relative(root, file)) };
}
