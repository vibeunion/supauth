import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { extractSvelteSafetyRegions } from '../packages/admin-console/scripts/static-safety-svelte.js';
import { inspectProjectCoverage } from './static-safety-projects.js';
import { inspectStaticSafety, type StaticSafetyIssue } from './static-safety.js';

export function inspectMaintainedSource(text: string, file: string): StaticSafetyIssue[] {
  if (!file.endsWith('.svelte')) return inspectStaticSafety(text, file);
  const regions = extractSvelteSafetyRegions(text, file);
  const issues: StaticSafetyIssue[] = [];
  const inspect = (start: number, source: string): void => {
    const offset = text.slice(0, start).split('\n').length - 1;
    issues.push(...inspectStaticSafety(source, `${file}.ts`)
      .map(issue => ({ ...issue, file, line: issue.line + offset })));
  };
  for (const script of regions.scripts) inspect(script.start, script.text);
  for (const expression of regions.templateExpressions) {
    const source = expression.kind === 'statement' ? expression.text
      : expression.kind === 'pattern' ? `function value(${expression.text}) {}`
        : `const value = (${expression.text});`;
    inspect(expression.start, source);
  }
  return issues;
}

export function checkStaticSafety(root: string): {
  files: number;
  projects: number;
  issues: StaticSafetyIssue[];
  errors: string[];
} {
  const inventory = inspectProjectCoverage(root);
  const errors = inventory.projects.flatMap(project => project.errors.map(error => `${project.config}: ${error}`));
  errors.push(...inventory.uncovered.map(file => `Uncovered maintained source: ${file}`));
  const issues: StaticSafetyIssue[] = [];
  for (const file of inventory.files) {
    const name = relative(root, file);
    try {
      issues.push(...inspectMaintainedSource(readFileSync(file, 'utf8'), name));
    } catch {
      // 不持久化第三方 parser 的原始源码摘录；文件路径足以定位失败。
      errors.push(`Cannot inspect maintained source: ${name}`);
    }
  }
  return { files: inventory.files.length, projects: inventory.projects.length, issues, errors };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const result = checkStaticSafety(root);
  const path = resolve(root, 'artifacts/type-safety/static-safety.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Static safety: ${result.files} maintained files, ${result.projects} checking projects`);
  for (const error of result.errors.slice(0, 20)) console.error(error);
  for (const issue of result.issues.slice(0, 20)) console.error(`${issue.file}:${issue.line}: ${issue.code}`);
  console.log(`Issues: ${result.issues.length}; configuration/coverage errors: ${result.errors.length}`);
  console.log(`Full report: ${path}`);
  if (result.errors.length || result.issues.length) process.exitCode = 1;
}
