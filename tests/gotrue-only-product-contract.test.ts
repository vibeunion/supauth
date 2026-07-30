import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createSupacloudAppManifest } from '../scripts/supacloud-app-contract.js';
import { MIGRATION_SQL, MIGRATION_V6_SQL } from '../packages/auth-server/src/db/migrate.js';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

function sourceTree(root: string, extensions = new Set(['.ts', '.js', '.svelte', '.md'])): string {
  if (!existsSync(root)) return '';
  if (/(^|\/)__tests__(\/|$)/.test(root) || /\.(test|spec)\.[^.]+$/.test(root)) return '';
  const stat = statSync(root);
  if (stat.isFile()) return extensions.has(root.slice(root.lastIndexOf('.'))) ? source(root) : '';
  return readdirSync(root).map((entry) => sourceTree(join(root, entry), extensions)).join('\n');
}

const FORBIDDEN_PRODUCT_SURFACE_FRAGMENTS = [
  'personal access token',
  'personal-access-token',
  'personal_access_token',
  'subject token',
  'subject-token',
  'subject_token',
  'token exchange',
  'token-exchange',
  'token_exchange',
  'saml application',
  'saml-application',
  'saml_application',
  'inline hook',
  'inline-hook',
  'inline_hook',
  'backup code',
  'backup-code',
  'backup_code',
  'recovery code',
  'recovery-code',
  'recovery_code',
  'external_oidc',
  'external issuer',
  'external-issuer',
];

const FORBIDDEN_ADVERTISED_SURFACE_FRAGMENTS = [
  'webauthn',
  'external oidc',
];

describe('GoTrue-only product contract', () => {
  it('exposes GoTrue as the only supported runtime mode', () => {
    const sharedTypes = source('packages/shared/src/index.ts');
    const serverConfig = source('packages/auth-server/src/config/index.ts');

    expect(sharedTypes).toContain("export type RuntimeMode = 'gotrue'");
    expect(sharedTypes).not.toContain("'external_oidc'");
    expect(serverConfig).toContain("configuredRuntimeMode !== 'gotrue'");
    expect(serverConfig).toContain("runtimeMode: 'gotrue'");
  });

  it('does not install a parallel issuer or incompatible credential store', () => {
    const migrationSql = `${MIGRATION_SQL}\n${MIGRATION_V6_SQL}`;
    const forbiddenTables = [
      'personal_access_tokens',
      'subject_tokens',
      'recovery_codes',
      'inline_hook_configs',
      'external_oidc_sessions',
    ];

    for (const table of forbiddenTables) {
      expect(migrationSql).not.toContain(`supaoauth.${table}`);
    }
  });

  it('keeps incompatible product routes out of the server and console', () => {
    const serverEntrypoint = source('packages/auth-server/src/index.ts');
    const accountRoutes = source('packages/auth-server/src/routes/account-self-service.ts');
    const navigation = source('packages/admin-console/src/lib/navigation.js');

    for (const routeFragment of [
      'personal-access-tokens',
      'subject-tokens',
      'saml-applications',
      'inline-hooks',
    ]) {
      expect(serverEntrypoint).not.toContain(routeFragment);
      expect(navigation).not.toContain(routeFragment);
    }
    expect(accountRoutes).not.toContain(".post('/passkeys/register'");
    expect(navigation).not.toContain('Inline Hooks');
    expect(existsSync('packages/admin-console/src/routes/inline-hooks')).toBe(false);
  });

  it('does not advertise removed capabilities in OpenAPI, console, SDK, or manifest', async () => {
    const serverSource = sourceTree('packages/auth-server/src');
    const consoleSource = sourceTree('packages/admin-console/src');
    const sdkSource = [
      sourceTree('packages/sdks/typescript/src'),
      sourceTree('packages/sdks/typescript/dist'),
      source('packages/sdks/typescript/README.md'),
    ].join('\n');
    const manifestSource = source('scripts/supacloud-app-contract.ts');

    for (const fragment of FORBIDDEN_PRODUCT_SURFACE_FRAGMENTS) {
      expect(serverSource.toLowerCase()).not.toContain(fragment);
      expect(consoleSource.toLowerCase()).not.toContain(fragment);
      expect(sdkSource.toLowerCase()).not.toContain(fragment);
      expect(manifestSource.toLowerCase()).not.toContain(fragment);
    }
    for (const fragment of FORBIDDEN_ADVERTISED_SURFACE_FRAGMENTS) {
      expect(consoleSource.toLowerCase()).not.toContain(fragment);
      expect(sdkSource.toLowerCase()).not.toContain(fragment);
      expect(manifestSource.toLowerCase()).not.toContain(fragment);
    }
    expect(consoleSource.toLowerCase()).not.toContain('passkey');
    expect(sdkSource.toLowerCase()).not.toContain('passkey');
    for (const method of [
      'listApplicationSecrets',
      'createApplicationSecret',
      'disableApplicationSecret',
      'deleteApplicationSecret',
    ]) {
      expect(sdkSource).not.toContain(method);
    }

    process.env.PORT ||= '0';
    process.env.SUPACLOUD_API_URL ||= 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN ||= 'contract-test';
    process.env.PROJECT_REF ||= 'contract-test';
    process.env.DATABASE_URL ||= 'postgres://placeholder';
    process.env.HOST ||= '127.0.0.1';
    process.env.RUNTIME_MODE = 'gotrue';
    const { app } = await import('../packages/auth-server/src/index.js');
    const swaggerResponse = await app.handle(new Request('http://localhost/swagger/json'));
    expect(swaggerResponse.ok).toBe(true);
    const swagger = await swaggerResponse.json() as {
      paths?: Record<string, unknown>;
      tags?: Array<{ name?: string }>;
    };
    const openApiText = JSON.stringify(swagger).toLowerCase();
    for (const fragment of FORBIDDEN_PRODUCT_SURFACE_FRAGMENTS) {
      expect(openApiText).not.toContain(fragment);
    }
    for (const fragment of FORBIDDEN_ADVERTISED_SURFACE_FRAGMENTS) {
      expect(openApiText).not.toContain(fragment);
    }
    expect(Object.keys(swagger.paths || {}).some((path) => /passkey/i.test(path))).toBe(false);
    expect(Object.keys(swagger.paths || {}).some((path) => /\/applications\/.*\/secrets(?:\/|$)/i.test(path))).toBe(false);
    expect((swagger.tags || []).some((tag) => /passkey|inline hook|personal access|subject token/i.test(tag.name || ''))).toBe(false);
  });

  it('keeps the removed passkey compatibility window explicit and unavailable', async () => {
    const compatibilitySource = source('packages/auth-server/src/routes/passkeys.ts');
    expect(compatibilitySource.match(/capabilityUnavailable\('gotrue_passkey_ceremony'/g) || []).toHaveLength(3);
    expect(compatibilitySource.match(/detail:\s*\{\s*hide:\s*true\s*\}/g) || []).toHaveLength(3);
    const { passkeyRoutes } = await import('../packages/auth-server/src/routes/passkeys.js');
    passkeyRoutes.compile();
    for (const [method, path] of [
      ['GET', '/v1/passkeys/user-id'],
      ['PUT', '/v1/passkeys/passkey-id/rename'],
      ['DELETE', '/v1/passkeys/passkey-id'],
    ] as const) {
      const response = await passkeyRoutes.handle(new Request(`http://localhost${path}`, { method }));
      expect(response.status).toBe(501);
    }
  });

  it('preserves every stock Supabase runtime route', () => {
    const manifest = createSupacloudAppManifest({
      functionBundle: 'function.js',
      adminStaticDir: 'admin',
      openapiPath: 'openapi.json',
    });

    expect(manifest.preserved_runtime_routes).toEqual([
      '/auth/v1/*',
      '/rest/v1/*',
      '/storage/v1/*',
      '/realtime/v1/*',
      '/functions/v1/*',
    ]);
    expect(manifest.functions[0].routes.some((route) => route.path.startsWith('/auth/v1'))).toBe(false);
  });
});
