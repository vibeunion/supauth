#!/usr/bin/env bun

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findOpenApiBreakingChanges, type OpenApiDocument } from './openapi-additive-contract.js';

const baselinePath = resolve(import.meta.dir, '..', 'tests', 'fixtures', 'openapi-gotrue-only-baseline.json');

function readOpenApi(path: string): OpenApiDocument {
  if (!existsSync(path)) throw new Error(`OpenAPI document does not exist: ${path}`);
  const document = JSON.parse(readFileSync(path, 'utf8')) as OpenApiDocument;
  if (!document.openapi || !document.paths) throw new Error(`Invalid OpenAPI document: ${path}`);
  return document;
}

function exportCurrentOpenApi(): { path: string; cleanup: () => void } {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'supaoauth-openapi-'));
  const openApiPath = join(temporaryDirectory, 'openapi.json');
  const exportProcess = Bun.spawnSync(['bun', 'run', 'scripts/export-openapi.ts', openApiPath], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (exportProcess.exitCode !== 0) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    process.exit(exportProcess.exitCode);
  }
  return {
    path: openApiPath,
    cleanup: () => rmSync(temporaryDirectory, { recursive: true, force: true }),
  };
}

const suppliedOpenApiPath = process.argv[2];
const exportedOpenApi = suppliedOpenApiPath ? null : exportCurrentOpenApi();
const currentPath = resolve(suppliedOpenApiPath || exportedOpenApi!.path);

try {
  const breakingChanges = findOpenApiBreakingChanges(readOpenApi(baselinePath), readOpenApi(currentPath));
  if (breakingChanges.length > 0) {
    console.error(`OpenAPI additive gate FAILED with ${breakingChanges.length} breaking change(s):`);
    for (const breakingChange of breakingChanges) console.error(`- ${breakingChange}`);
    process.exitCode = 1;
  } else {
    console.log(`OpenAPI additive gate passed: ${currentPath}`);
    console.log(`Baseline: ${baselinePath}`);
  }
} finally {
  exportedOpenApi?.cleanup();
}
