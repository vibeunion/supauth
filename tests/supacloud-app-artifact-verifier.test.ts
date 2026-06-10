import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupacloudAppManifest } from '../scripts/supacloud-app-contract.js';
import { verifySupacloudAppArtifact } from '../scripts/verify-supacloud-app-artifact.js';

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'supauth-artifact-'));
  const adminDir = 'admin-build';
  const functionBundle = 'function/supacloud-function.js';
  const openapiPath = 'artifact/openapi.json';

  mkdirSync(join(root, 'function'), { recursive: true });
  mkdirSync(join(root, adminDir), { recursive: true });
  mkdirSync(join(root, 'artifact'), { recursive: true });

  writeFileSync(join(root, functionBundle), 'export default { fetch() {} };');
  writeFileSync(join(root, adminDir, 'index.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'authorize.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'claim.html'), '<!doctype html>');
  writeFileSync(join(root, openapiPath), JSON.stringify({ openapi: '3.0.3', paths: {} }));

  const manifest = createSupacloudAppManifest({
    functionBundle,
    adminStaticDir: adminDir,
    openapiPath,
  });
  writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { root, manifest };
}

describe('SupaCloud app artifact verifier', () => {
  it('accepts a self-contained SupaCloud Function and Pages artifact', () => {
    const { root } = createFixture();

    const result = verifySupacloudAppArtifact({
      root,
      artifactDir: 'artifact',
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects Function routes that collide with preserved Supabase runtime routes', () => {
    const { root, manifest } = createFixture();
    manifest.functions[0].routes.push({ path: '/auth/v1/*' });
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({
      root,
      artifactDir: 'artifact',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Function route /auth/v1/* collides with preserved runtime route /auth/v1/*');
  });
});
