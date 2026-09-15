import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodePackageManifest, readPackageManifest, rewritePackageDependencies,
} from '../scripts/prepare-npm-packages.js';

describe('package manifest input contract', () => {
  test.each([
    null, [], {}, { name: 12, version: '1.0.0' }, { name: 'pkg', version: false },
    { name: 'pkg', version: '1.0.0', files: 'dist' },
    { name: 'pkg', version: '1.0.0', dependencies: { dependency: 12 } },
    { name: 'pkg', version: '1.0.0', optionalDependencies: [] },
  ].map(value => ({ value })))('rejects invalid package data %#', ({ value }) => {
    expect(() => decodePackageManifest(value)).toThrow();
  });

  test('rewrites only validated workspace dependencies and preserves metadata', () => {
    const pkg = decodePackageManifest({
      name: 'pkg', version: '1.0.0', exports: { '.': './dist/index.js' },
      dependencies: { shared: 'workspace:*', thirdParty: '^2.0.0' },
      peerDependencies: { shared: 'workspace:*' },
    });
    expect(rewritePackageDependencies(pkg, { shared: '3.0.0' })).toBe(true);
    expect(pkg.dependencies).toEqual({ shared: '^3.0.0', thirdParty: '^2.0.0' });
    expect(pkg.peerDependencies).toEqual({ shared: '^3.0.0' });
    expect(pkg['exports']).toEqual({ '.': './dist/index.js' });
    expect(rewritePackageDependencies(pkg, { shared: '3.0.0' })).toBe(false);
  });

  test('rejects invalid files without changing their contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'supauth-package-decoder-'));
    const file = join(directory, 'package.json');
    try {
      for (const source of ['{', 'null', '{"name":"pkg","version":1}']) {
        writeFileSync(file, source);
        expect(() => readPackageManifest(file)).toThrow();
        expect(readFileSync(file, 'utf8')).toBe(source);
      }
      expect(() => readPackageManifest(join(directory, 'missing.json'))).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
