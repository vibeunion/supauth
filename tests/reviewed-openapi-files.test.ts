import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { findOpenApiBreakingChanges } from '../scripts/openapi-additive-contract.js';
import { parseOpenApiDocument, sha256 } from '../scripts/openapi-document-corrections.js';
import { inspectReviewedOpenApiFiles } from '../scripts/reviewed-openapi-files.js';

const root = resolve(import.meta.dir, '..');
function reviewedDocument() {
  return parseOpenApiDocument(gunzipSync(
    readFileSync(resolve(root, 'tests/fixtures/openapi-typed-baseline.json.gz')),
  ).toString('utf8'));
}

describe('checked-in reviewed OpenAPI baseline', () => {
  test('preserves historical bytes and validates both complete baseline and bounded corrections', async () => {
    expect(sha256(readFileSync(resolve(root, 'tests/fixtures/openapi-gotrue-only-baseline.json'), 'utf8')))
      .toBe('c473ad0dda0c83d2f527a26fb4147c631537d286ac64ca883826494e42dbcc01');
    const result = await inspectReviewedOpenApiFiles(root, reviewedDocument());
    expect(result.rawChanges.length).toBeGreaterThan(0);
    expect(result.corrections).toBeGreaterThan(0);
    expect(result.residualChanges).toEqual([]);
    expect(result.reviewedChanges).toEqual([]);
  });

  test('the complete snapshot detects future path deletion and newly added authentication', () => {
    const before = reviewedDocument();
    const current = structuredClone(before);
    if (!current.paths || !Object.hasOwn(current.paths, '/v1/users/{userId}')) throw new Error('Missing reviewed user route');
    delete current.paths['/v1/users/{userId}'];
    current["security"] = [{ bearerAuth: [] }];
    const changes = findOpenApiBreakingChanges(before, current);
    expect(changes.some(change => change.includes('/v1/users/{userId}'))).toBe(true);
    expect(changes.some(change => change.includes('security'))).toBe(true);
  });

  test('missing frozen files fail closed instead of accepting current export as a baseline', async () => {
    await expect(inspectReviewedOpenApiFiles(resolve(root, 'tests/fixtures/missing-review'), reviewedDocument()))
      .rejects.toThrow();
  });
});
