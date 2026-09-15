import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCorrectionEvidenceFile } from '../scripts/reviewed-openapi-files.js';

describe('OpenAPI correction evidence files', () => {
  test('requires real source files and rejects directories, escapes and external symlinks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'supauth-evidence-test-'));
    const root = join(directory, 'repository');
    try {
      mkdirSync(join(root, 'packages'), { recursive: true });
      mkdirSync(join(root, 'tests'));
      writeFileSync(join(root, 'packages/source.ts'), 'export {};');
      writeFileSync(join(directory, 'outside.ts'), 'export {};');
      symlinkSync(join(directory, 'outside.ts'), join(root, 'tests/outside.ts'));
      symlinkSync(join(root, 'packages/source.ts'), join(root, 'tests/inside.ts'));
      expect(() => assertCorrectionEvidenceFile(root, 'packages/source.ts')).not.toThrow();
      expect(() => assertCorrectionEvidenceFile(root, 'tests/inside.ts')).not.toThrow();
      for (const path of ['packages/', 'tests/', 'tests/outside.ts', '../outside.ts', '.', 'missing.ts', join(root, 'packages/source.ts')]) {
        expect(() => assertCorrectionEvidenceFile(root, path)).toThrow();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
