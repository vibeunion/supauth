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
  writeFileSync(join(root, adminDir, 'change-password.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'account.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'logout.html'), '<!doctype html>');
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

  it('requires the exact Admin Console root route as well as nested routes', () => {
    const { root, manifest } = createFixture();
    const adminPage = manifest.pages.find((page) => page.name === 'supauth-admin')!;
    adminPage.routes = ['/admin/*'];
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('supauth-admin must route /admin');
  });

  it('requires the exact Admin Console root route on the Function', () => {
    const { root, manifest } = createFixture();
    manifest.functions[0].routes = manifest.functions[0].routes.filter((route) => route.path !== '/admin');
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing Function route: /admin');
  });

  it('rejects manifests that advertise removed local tables', () => {
    const { root, manifest } = createFixture();
    const tableOwnership = manifest.supaoauth_table_ownership as Record<string, unknown>;
    tableOwnership.passkeys = { class: 'legacy-temporary' };
    tableOwnership.account_sessions = { class: 'legacy-temporary' };
    tableOwnership.webhooks = { class: 'legacy-temporary' };
    tableOwnership.webhook_deliveries = { class: 'legacy-temporary' };
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Removed local table must not be advertised: passkeys');
    expect(result.errors).toContain('Removed local table must not be advertised: account_sessions');
    expect(result.errors).toContain('Removed local table must not be advertised: webhooks');
    expect(result.errors).toContain('Removed local table must not be advertised: webhook_deliveries');
  });

  it('rejects Function bundles that contain a local webhook worker', () => {
    const { root } = createFixture();
    writeFileSync(join(root, 'function/supacloud-function.js'), 'function processPendingDeliveries() {}');

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Function bundle contains removed local webhook implementation: processPendingDeliveries',
    );
  });

  it('requires the BFF signing secret to be declared as a secret', () => {
    const { root, manifest } = createFixture();
    const bffEnv = manifest.required_supacloud_env.find((entry) => entry.name === 'SUPAOAUTH_BFF_SIGNING_SECRET')!;
    bffEnv.secret = false;
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('SUPAOAUTH_BFF_SIGNING_SECRET must be marked secret');
  });

  it('requires exact Admin SSO required, optional, and secret semantics', () => {
    const { root, manifest } = createFixture();
    const issuerEnv = manifest.required_supacloud_env.find((entry) => entry.name === 'ADMIN_SSO_ISSUER')!;
    const allowlistEnv = manifest.required_supacloud_env.find((entry) => entry.name === 'ADMIN_SSO_ALLOWED_EMAILS')!;
    issuerEnv.optional = true;
    allowlistEnv.secret = false;
    manifest.admin_sso.allowlist.install_rule = 'optional';
    manifest.admin_sso.client_contract.client_type = 'confidential';
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('ADMIN_SSO_ISSUER optional flag must be false');
    expect(result.errors).toContain('ADMIN_SSO_ALLOWED_EMAILS secret flag must be true');
    expect(result.errors).toContain(
      'Admin SSO allowlist contract must require exact emails and forbid domain authorization',
    );
    expect(result.errors).toContain(
      'Admin SSO client contract must require management read-back, public PKCE S256, exact redirect, no secret, and aal2',
    );
  });

  it('requires the self-contained multi-file Admin Function deployment layout', () => {
    const { root, manifest } = createFixture();
    manifest.functions[0].deployment_bundle.files = [
      { artifact: 'function_bundle', target: 'index.ts' },
    ];
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Function deployment bundle must recursively publish text Admin assets under admin-console/build',
    );
  });
});
