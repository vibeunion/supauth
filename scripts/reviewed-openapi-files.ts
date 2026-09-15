import { isUnknownArray, parseJson } from "./tooling-values.js";
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isAbsolute, relative, resolve } from 'node:path';
import { inspectReviewedOpenApi } from './openapi-document-corrections.js';
import type { OpenApiDocument } from './openapi-additive-contract.js';

export function assertCorrectionEvidenceFile(root: string, evidence: unknown): void {
  if (typeof evidence !== 'string' || isAbsolute(evidence) || evidence.split('/').includes('..')) {
    throw new Error('Invalid document correction evidence path');
  }
  const realRoot = realpathSync(root);
  const target = realpathSync(resolve(root, evidence));
  const local = relative(realRoot, target);
  if (!local || local === '..' || local.startsWith('../') || isAbsolute(local) || !statSync(target).isFile()) {
    throw new Error('Document correction evidence must be a file within the repository');
  }
}

export async function inspectReviewedOpenApiFiles(root: string, current: OpenApiDocument) {
  const fixture = resolve(root, 'tests/fixtures');
  const legacySource = readFileSync(resolve(fixture, 'openapi-gotrue-only-baseline.json'), 'utf8');
  const reviewedSource = gunzipSync(readFileSync(resolve(fixture, 'openapi-typed-baseline.json.gz')), {
    maxOutputLength: 32 * 1024 * 1024,
  }).toString('utf8');
  const ledgerSource = readFileSync(resolve(fixture, 'openapi-document-corrections.json'), 'utf8');
  const result = await inspectReviewedOpenApi(legacySource, reviewedSource, ledgerSource, current);
  // 指纹验证之后仍检查证据路径，防止更正记录指向已经丢失的源文件或测试。
  const ledger: unknown = parseJson(ledgerSource);
  if (ledger === null || typeof ledger !== 'object' || !('corrections' in ledger)
    || !isUnknownArray(ledger.corrections)) throw new Error('Invalid document correction evidence');
  for (const correction of ledger.corrections) {
    if (correction === null || typeof correction !== 'object' || !('evidence' in correction)
      || !isUnknownArray(correction.evidence)) throw new Error('Invalid document correction evidence');
    for (const evidence of correction.evidence) {
      assertCorrectionEvidenceFile(root, evidence);
    }
  }
  return result;
}
