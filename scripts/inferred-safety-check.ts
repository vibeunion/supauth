import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { CHECKED_PROJECTS, maintainedSourceFiles } from './static-safety-projects.js';
import { inspectStrictOptions } from './static-safety.js';
import { inspectInferredSafety, type InferredSafetyIssue } from './inferred-safety.js';

const root = resolve(import.meta.dir, '..');
const files = new Set(maintainedSourceFiles(root).filter(file => !file.endsWith('.svelte')));
const issues = new Map<string, InferredSafetyIssue>();
const covered = new Set<string>();
for (const config of CHECKED_PROJECTS) {
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(root, config), { noEmit: true, incremental: false }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (!parsed || parsed.errors.length || inspectStrictOptions(parsed.options).length) {
    throw new Error(`Invalid strict checking project: ${config}`);
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  for (const file of program.getSourceFiles()) if (files.has(file.fileName)) covered.add(file.fileName);
  for (const issue of inspectInferredSafety(program, files)) {
    const normalized = { ...issue, file: relative(root, issue.file) };
    issues.set(`${normalized.file}:${issue.line}:${issue.column}:${issue.code}`, normalized);
  }
}
const uncovered = [...files].filter(file => !covered.has(file)).map(file => relative(root, file));
const result = { compiler: ts.version, files: covered.size, issues: [...issues.values()], uncovered };
const path = resolve(root, 'artifacts/type-safety/inferred-safety.json');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Inferred safety: ${covered.size} maintained JS/TS files; ${issues.size} issues; ${uncovered.length} uncovered`);
for (const issue of result.issues.slice(0, 20)) console.error(`${issue.file}:${issue.line}: ${issue.code}`);
console.log(`Full report: ${path}`);
if (issues.size || uncovered.length) process.exitCode = 1;
