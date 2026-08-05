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

  const manifest = structuredClone(createSupacloudAppManifest({
    functionBundle,
    adminStaticDir: adminDir,
    openapiPath,
  }));
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

  it('requires the Custom UI fallback route on the Function', () => {
    const { root, manifest } = createFixture();
    manifest.functions[0].routes = manifest.functions[0].routes.filter((route) => route.path !== '/custom-ui/*');
    writeFileSync(join(root, 'artifact', 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing Function route: /custom-ui/*');
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

  it('rejects computed dynamic imports omitted by Bun import scanning', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      "const specifier = './adapter.js'; export const adapter = import(specifier);",
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Function bundle contains computed dynamic imports rejected by the multi-tenant Edge Runtime',
    );
  });

  it('accepts Edge Runtime-supported import.meta.require builtins', () => {
    for (const loaderSource of [
      'var tty = import.meta.require("tty");',
      'var __require = import.meta.require; var tty = __require("tty"); var util = __require("util");',
    ]) {
      const { root } = createFixture();
      writeFileSync(join(root, 'function/supacloud-function.js'), loaderSource);

      const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    }
  });

  it('rejects import.meta.require calls outside the tenant allowlist', () => {
    for (const [loaderSource, expectedError] of [
      [
        'var __require = import.meta.require; var http2 = __require("http2");',
        'Function bundle loads an Edge Runtime-disallowed builtin via import.meta.require: http2',
      ],
      [
        'var processModule = import.meta.require("process");',
        'Function bundle loads an Edge Runtime-disallowed builtin via import.meta.require: process',
      ],
      [
        'const __require = import.meta.require; const fileSystem = __require("fs");',
        'Function bundle loads an Edge Runtime-disallowed builtin via import.meta.require: fs',
      ],
      [
        'const http2 = import.meta.require("node:http2");',
        'Function bundle loads an Edge Runtime-disallowed builtin via import.meta.require: node:http2',
      ],
      [
        'const bunRuntime = import.meta.require("node:bun");',
        'Function bundle loads an Edge Runtime-disallowed builtin via import.meta.require: node:bun',
      ],
      [
        'const __require = import.meta.require; const name = "tty"; __require(name);',
        'Function bundle contains computed import.meta.require calls that the artifact verifier cannot prove safe',
      ],
    ]) {
      const { root } = createFixture();
      writeFileSync(join(root, 'function/supacloud-function.js'), loaderSource);

      const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(expectedError);
    }
  });

  it('accepts import.meta metadata properties without loader access', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      'export const moduleUrl = import.meta.url; export const moduleDir = import.meta.dir;',
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects indirect import.meta loader aliases that cannot be proven safe', () => {
    for (const loaderSource of [
      'const runtimeMeta = import.meta; runtimeMeta.require("fs");',
      'const { require: runtimeRequire } = import.meta; runtimeRequire("fs");',
      'const runtimeMeta = (import.meta); runtimeMeta.require("fs");',
      'const fileSystem = (import.meta).require("fs");',
    ]) {
      const { root } = createFixture();
      writeFileSync(join(root, 'function/supacloud-function.js'), loaderSource);

      const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        'Function bundle contains import.meta loader access rejected by the multi-tenant Edge Runtime',
      );
    }
  });

  it('does not treat import.meta.require text in strings or comments as a loader', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      'const text = "import.meta.require"; // import.meta.require\nexport { text };',
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('does not reject an application-defined require helper', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      'const __require = (name) => name; export const runtime = __require("tty");',
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects interpolated template dynamic imports as computed', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      'const adapter = "local"; export const loader = import(`./${adapter}.js`);',
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Function bundle contains computed dynamic imports rejected by the multi-tenant Edge Runtime',
    );
  });

  it('rejects concatenated computed dynamic imports', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      "const name = 'adapter.js'; export const adapter = import('./' + name);",
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Function bundle contains computed dynamic imports rejected by the multi-tenant Edge Runtime',
    );
  });

  it('rejects parenthesized dynamic import specifiers as computed', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      "export const pathModule = import(('node:path'));",
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Function bundle contains computed dynamic imports rejected by the multi-tenant Edge Runtime',
    );
  });

  it('rejects computed import.defer and import.source forms even when Bun cannot scan them', () => {
    for (const importSource of [
      "const specifier = 'node:path'; export const adapter = import.defer(specifier);",
      "const specifier = 'node:path'; export const adapter = import.source(specifier);",
    ]) {
      const { root } = createFixture();
      writeFileSync(join(root, 'function/supacloud-function.js'), importSource);

      const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        'Function bundle contains computed dynamic imports rejected by the multi-tenant Edge Runtime',
      );
    }
  });

  it('accepts runtime-supported literal dynamic imports with comments and import attributes', () => {
    for (const importSource of [
      "export const adapter = import(/*comment*/ 'node:path');",
      "export const adapter = import('node:path' /*comment*/);",
      "export const adapter = import('node:path', { with: { type: 'json' } });",
      "export const runtime = import('bun');",
    ]) {
      const { root } = createFixture();
      writeFileSync(join(root, 'function/supacloud-function.js'), importSource);

      const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects Edge Runtime-disabled imports', () => {
    for (const disabledModule of ['module', 'node:module', 'child_process']) {
      const { root } = createFixture();
      writeFileSync(
        join(root, 'function/supacloud-function.js'),
        `import disabled from '${disabledModule}'; export { disabled };`,
      );

      const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(`Function bundle imports Edge Runtime-disabled module: ${disabledModule}`);
    }
  });

  it('rejects runtime builtins outside the tenant allowlist', () => {
    for (const disallowedModule of ['node:http2', 'process', 'diagnostics_channel', 'node:bun']) {
      const { root } = createFixture();
      writeFileSync(
        join(root, 'function/supacloud-function.js'),
        `import runtimeModule from '${disallowedModule}'; export { runtimeModule };`,
      );

      const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(`Function bundle contains unresolved import: ${disallowedModule}`);
    }
  });

  it('rejects static imports of Edge Runtime-disabled modules', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      "import { readFile } from 'node:fs/promises'; export { readFile };",
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Function bundle imports Edge Runtime-disabled module: node:fs/promises');
  });

  it('rejects template-literal imports of Edge Runtime-disabled modules', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      'export const loader = import(`node:fs`);',
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Function bundle imports Edge Runtime-disabled module: node:fs');
  });

  it('rejects unresolved package imports in the Function bundle', () => {
    const { root } = createFixture();
    writeFileSync(
      join(root, 'function/supacloud-function.js'),
      "import unresolved from 'not-bundled-dependency'; export { unresolved };",
    );

    const result = verifySupacloudAppArtifact({ root, artifactDir: 'artifact' });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Function bundle contains unresolved import: not-bundled-dependency');
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
      'Admin SSO client contract must require management read-back, public PKCE S256, exact redirect, no secret, and the server-controlled AAL2 policy',
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
