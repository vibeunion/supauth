#!/usr/bin/env bun
import { requireDefined } from "./tooling-values.js";

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OpenApiDocument } from './openapi-additive-contract.js';
import { inspectReviewedOpenApiFiles } from './reviewed-openapi-files.js';
import { parseOpenApiDocument } from './openapi-document-corrections.js';

const root = resolve(import.meta.dir, '..');
const baselinePath = resolve(root, 'tests', 'fixtures', 'openapi-gotrue-only-baseline.json');

function readOpenApi(path: string): OpenApiDocument {
  if (!existsSync(path)) throw new Error(`OpenAPI document does not exist: ${path}`);
  return parseOpenApiDocument(readFileSync(path, 'utf8'));
}

function exportCurrentOpenApi(): { path: string; cleanup: () => void } {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'supaoauth-openapi-'));
  const openApiPath = join(temporaryDirectory, 'openapi.json');
  const exportProcess = Bun.spawnSync(['bun', '--no-env-file', 'run', 'scripts/export-openapi.ts', openApiPath], {
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
const currentPath = resolve(suppliedOpenApiPath || requireDefined(exportedOpenApi).path);

try {
  const review = await inspectReviewedOpenApiFiles(root, readOpenApi(currentPath));
  const breakingChanges = [...new Set([...review.residualChanges, ...review.reviewedChanges])];
  console.log(`Legacy differences: ${review.rawChanges.length}; reviewed document corrections: ${review.corrections}`);
  if (breakingChanges.length > 0) {
    console.error(`OpenAPI additive gate FAILED with ${breakingChanges.length} breaking change(s):`);
    for (const breakingChange of breakingChanges) console.error(`- ${breakingChange}`);
    process.exitCode = 1;
  } else {
    console.log(`OpenAPI additive gate passed: ${currentPath}`);
    console.log(`Baseline: ${baselinePath}`);
    console.log('Complete typed baseline and reviewed legacy document both passed.');
  }
} catch {
  console.error('OpenAPI additive gate FAILED: invalid document, baseline, correction ledger, or evidence.');
  process.exitCode = 1;
} finally {
  exportedOpenApi?.cleanup();
}
