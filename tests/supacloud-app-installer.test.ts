import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupacloudAppManifest } from '../scripts/supacloud-app-contract.js';
import { installSupacloudApp, SupacloudClient } from '../scripts/install-supacloud-app.js';

const REQUIRED_ADMIN_PAGES = ['index.html', 'authorize.html', 'claim.html', 'change-password.html', 'account.html', 'logout.html'];
const SYSTEM_MANAGED_SECRET_PREFIXES = ['ADMIN_SSO_', 'SUPABASE_', 'SUPACLOUD_', 'SUPAOAUTH_'] as const;

function expectNoSystemManagedProjectSecrets(secrets: Array<{ name: string }>) {
  const reservedNames = secrets
    .map(({ name }) => name)
    .filter((name) => SYSTEM_MANAGED_SECRET_PREFIXES.some((prefix) => name.startsWith(prefix)));
  expect(reservedNames).toEqual([]);
}

function writeAdminPages(directory: string) {
  mkdirSync(directory, { recursive: true });
  for (const page of REQUIRED_ADMIN_PAGES) writeFileSync(join(directory, page), '<!doctype html>');
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'supauth-installer-'));
  const artifactDir = 'artifact';
  const adminDir = 'admin-build';
  const functionBundle = 'function/supacloud-function.js';
  const openapiPath = 'artifact/openapi.json';

  mkdirSync(join(root, 'function'), { recursive: true });
  writeAdminPages(join(root, adminDir));
  mkdirSync(join(root, adminDir, '_app', 'immutable'), { recursive: true });
  mkdirSync(join(root, artifactDir), { recursive: true });

  writeFileSync(join(root, functionBundle), 'export default { fetch() { return new Response("ok"); } };');
  writeFileSync(join(root, adminDir, '_app', 'immutable', 'admin.css'), 'body { color: #111; }');
  writeFileSync(join(root, adminDir, '_app', 'immutable', 'admin.js'), 'export const admin = true;');
  writeFileSync(join(root, openapiPath), JSON.stringify({ openapi: '3.0.3', paths: {} }));

  const manifest = createSupacloudAppManifest({
    functionBundle,
    adminStaticDir: adminDir,
    openapiPath,
  });
  writeFileSync(join(root, artifactDir, 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { root, artifactDir };
}

const requiredOptions = {
  supacloudApiUrl: 'https://api.example.test',
  projectRef: 'project_123',
  token: 'secret-token',
  bffSigningSecret: 'installer-bff-signing-secret-0123456789abcdef',
  runtimeUrl: 'https://project.example.test',
  databaseUrl: 'postgres://secret-db',
  adminSsoIssuer: 'https://auth.example.test/auth/v1',
  adminSsoClientId: 'admin-client',
  adminSsoRedirectUri: 'https://auth.example.test/admin',
  adminSsoAllowedEmails: 'admin@example.test',
  adminSsoAllowedDomains: '',
  adminSsoAllowlistVerifier: async () => ({ emailCount: 0, domainCount: 0 }),
  adminSsoOAuthClientVerifier: async () => undefined,
};

function validAdminOAuthClient(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'admin-client',
    client_type: 'public',
    token_endpoint_auth_method: 'none',
    redirect_uris: ['https://auth.example.test/admin'],
    grant_types: ['authorization_code', 'refresh_token'],
    ...overrides,
  };
}

const isolatedEnvKeys = [
  'SUPACLOUD_GATEWAY_ADMIN_TOKEN',
  'SUPACLOUD_ADMIN_TOKEN',
  'SUPAUTH_PUBLIC_URL',
  'AUTH_PUBLIC_URL',
  'SUPAUTH_INSTALLED_BASE_URL',
  'SUPAUTH_BASE_URL',
  'SUPAUTH_API_URL',
  'AUTH_API_URL',
  'SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF',
  'OAUTH_AUTHORIZATION_PROJECT_REF',
  'GOTRUE_AUTHORIZATION_PROJECT_REF',
  'CORS_ORIGINS',
  'SUPACLOUD_EDGE_RUNTIME_UPSTREAM',
  'EDGE_RUNTIME_UPSTREAM',
  'SUPACLOUD_DATABASE_URL',
  'SUPABASE_DB_URL',
  'SUPACLOUD_RUNTIME_URL',
  'OAUTH_RUNTIME_URL',
  'SUPABASE_URL',
  'SUPAOAUTH_BFF_SIGNING_SECRET',
  'RUNTIME_MODE',
  'ADMIN_SSO_ISSUER',
  'ADMIN_SSO_CLIENT_ID',
  'ADMIN_SSO_JWKS_URI',
  'ADMIN_SSO_AUDIENCE',
  'ADMIN_SSO_REDIRECT_URI',
  'ADMIN_SSO_POST_LOGOUT_REDIRECT_URI',
  'ADMIN_SSO_REQUIRE_AAL2',
  'ADMIN_SSO_ALLOWED_EMAILS',
  'ADMIN_SSO_ALLOWED_DOMAINS',
] as const;

let isolatedEnv: Partial<Record<(typeof isolatedEnvKeys)[number], string>>;

beforeEach(() => {
  isolatedEnv = {};
  for (const key of isolatedEnvKeys) {
    if (process.env[key] !== undefined) isolatedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of isolatedEnvKeys) {
    const value = isolatedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('SupaCloud app installer', () => {
  it('rejects unsupported auth runtimes before any install request', async () => {
    const { root, artifactDir } = createFixture();
    let requested = false;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      runtimeMode: 'external_oidc',
      fetchImpl: async () => {
        requested = true;
        return new Response('{}');
      },
    })).rejects.toThrow('RUNTIME_MODE must be "gotrue"');
    expect(requested).toBe(false);
  });

  it('keeps migration as an explicit install step in dry-run mode', async () => {
    const { root, artifactDir } = createFixture();
    let allowlistDatabaseRead = false;

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
      adminSsoAllowlistVerifier: async () => {
        allowlistDatabaseRead = true;
        return { emailCount: 0, domainCount: 0 };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([
      expect.objectContaining({ name: 'artifact-verification', status: 'done' }),
      expect.objectContaining({ name: 'migration', status: 'planned' }),
      expect.objectContaining({ name: 'migration-verification', status: 'planned' }),
      expect.objectContaining({ name: 'admin-sso-allowlist-verification', status: 'planned' }),
      expect.objectContaining({ name: 'admin-sso-oauth-client-verification', status: 'planned' }),
      expect.objectContaining({ name: 'admin-sso-aal2-policy', status: 'planned' }),
      expect.objectContaining({ name: 'runtime-env', status: 'planned' }),
      expect.objectContaining({ name: 'function-deploy', status: 'planned' }),
      expect.objectContaining({ name: 'gateway-routes', status: 'skipped' }),
      expect.objectContaining({ name: 'direct-function-probe', status: 'planned' }),
    ]);
    expect(allowlistDatabaseRead).toBe(false);
  });

  it('requires explicit Admin SSO issuer and client id in dry-run mode', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoIssuer: undefined,
      dryRun: true,
    })).rejects.toThrow('ADMIN_SSO_ISSUER');

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoClientId: undefined,
      dryRun: true,
    })).rejects.toThrow('ADMIN_SSO_CLIENT_ID');
  });

  it('requires HTTPS for a production Admin SSO issuer', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoIssuer: 'http://auth.example.test/auth/v1',
    })).rejects.toThrow('HTTPS for production installation');
  });

  it.each([
    'https://user:password@auth.example.test/auth/v1',
    'https://auth.example.test/auth/v1?issuer=other',
    'https://auth.example.test/auth/v1#fragment',
  ])('rejects an Admin SSO issuer with unsafe URL components: %s', async (adminSsoIssuer) => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoIssuer,
      dryRun: true,
    })).rejects.toThrow('without credentials, query, or fragment');
  });

  it('uses CLI Admin SSO precedence through SupAuth Function-scoped runtime variables', async () => {
    const { root, artifactDir } = createFixture();
    const envFile = join(root, 'admin-sso.env');
    writeFileSync(envFile, [
      'ADMIN_SSO_ISSUER=http://issuer.from-file.test',
      'ADMIN_SSO_CLIENT_ID=file-client',
      'ADMIN_SSO_JWKS_URI=https://issuer.from-file.test/keys',
      'ADMIN_SSO_AUDIENCE=file-audience',
      'ADMIN_SSO_REDIRECT_URI=https://issuer.from-file.test/admin',
      'ADMIN_SSO_POST_LOGOUT_REDIRECT_URI=https://issuer.from-file.test/admin/login',
      'ADMIN_SSO_REQUIRE_AAL2=false',
      'ADMIN_SSO_ALLOWED_EMAILS=file@example.test',
    ].join('\n'));
    process.env.ADMIN_SSO_ISSUER = 'http://issuer.from-process.test';
    process.env.ADMIN_SSO_CLIENT_ID = 'process-client';

    const seenFunctionSecrets: Array<{ name: string; value: string }> = [];
    await installSupacloudApp({
      root,
      artifactDir,
      envFile,
      ...requiredOptions,
      adminSsoIssuer: 'https://issuer.from-cli.test',
      adminSsoClientId: 'cli-client',
      adminSsoAllowedEmails: 'cli@example.test',
      adminSsoAllowedDomains: undefined,
      skipMigration: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        if (new URL(String(input)).pathname.endsWith('/functions/supauth/secrets')) {
          seenFunctionSecrets.push(...JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    expect(seenFunctionSecrets).toEqual([
      { name: 'ADMIN_SSO_ISSUER', value: 'https://issuer.from-cli.test' },
      { name: 'ADMIN_SSO_CLIENT_ID', value: 'cli-client' },
      { name: 'ADMIN_SSO_JWKS_URI', value: 'https://issuer.from-file.test/keys' },
      { name: 'ADMIN_SSO_AUDIENCE', value: 'file-audience' },
      { name: 'ADMIN_SSO_REDIRECT_URI', value: 'https://auth.example.test/admin' },
      { name: 'ADMIN_SSO_POST_LOGOUT_REDIRECT_URI', value: 'https://issuer.from-file.test/admin/login' },
      { name: 'ADMIN_SSO_REQUIRE_AAL2', value: 'false' },
    ]);
  });

  it('uses CLI AAL2 policy over an env file and injects the normalized Function value', async () => {
    const { root, artifactDir } = createFixture();
    const envFile = join(root, 'admin-sso.env');
    writeFileSync(envFile, 'ADMIN_SSO_REQUIRE_AAL2=false\n');
    const seenFunctionSecrets: Array<{ name: string; value: string }> = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      envFile,
      ...requiredOptions,
      adminSsoRequireAal2: 'true',
      skipMigration: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        if (new URL(String(input)).pathname.endsWith('/functions/supauth/secrets')) {
          seenFunctionSecrets.push(...JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    expect(result.steps).toContainEqual({
      name: 'admin-sso-aal2-policy',
      status: 'done',
      detail: 'AAL2 enforcement enabled by ADMIN_SSO_REQUIRE_AAL2=true',
    });
    expect(seenFunctionSecrets).toContainEqual({ name: 'ADMIN_SSO_REQUIRE_AAL2', value: 'true' });
  });

  it('rejects an invalid AAL2 policy before making install requests', async () => {
    const { root, artifactDir } = createFixture();
    let requested = false;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoRequireAal2: 'enabled',
      dryRun: true,
      fetchImpl: async () => {
        requested = true;
        return new Response('{}', { status: 200 });
      },
    })).rejects.toThrow('ADMIN_SSO_REQUIRE_AAL2');

    expect(requested).toBe(false);
  });

  it('accepts a non-empty database allowlist when environment fallback is empty', async () => {
    const { root, artifactDir } = createFixture();

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoAllowedEmails: '',
      adminSsoAllowedDomains: '',
      adminSsoAllowlistVerifier: async () => ({ emailCount: 1, domainCount: 0 }),
      skipMigration: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });

    expect(result.ok).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({
      name: 'admin-sso-allowlist-verification',
      status: 'done',
    }));
  });

  it('fails closed when both database and environment allowlists are empty', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoAllowedEmails: '',
      adminSsoAllowedDomains: '',
      adminSsoAllowlistVerifier: async () => ({ emailCount: 0, domainCount: 0 }),
      skipMigration: true,
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('at least one exact administrator email');
  });

  it('rejects legacy domain allowlists from environment or database sources', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoAllowedDomains: 'example.test',
      dryRun: true,
    })).rejects.toThrow('forbids ADMIN_SSO_ALLOWED_DOMAINS');

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoAllowlistVerifier: async () => ({ emailCount: 1, domainCount: 1 }),
      skipMigration: true,
      skipMigrationVerify: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
    })).rejects.toThrow('forbids database domain allowlists');
  });

  it('reads back the dedicated Admin public client from the authority project and verifies PKCE S256', async () => {
    const { root, artifactDir } = createFixture();
    const requestedUrls: string[] = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      oauthAuthorizationProjectRef: 'central_idp',
      adminSsoOAuthClientVerifier: undefined,
      skipMigration: true,
      skipMigrationVerify: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes('/auth/oauth-clients/')) {
          return Response.json({ data: validAdminOAuthClient() });
        }
        return Response.json({ code_challenge_methods_supported: ['S256'] });
      },
    });

    expect(result.steps).toContainEqual(expect.objectContaining({
      name: 'admin-sso-oauth-client-verification',
      status: 'done',
    }));
    expect(requestedUrls).toEqual([
      'https://api.example.test/v1/projects/central_idp/auth/oauth-clients/admin-client',
      'https://auth.example.test/auth/v1/.well-known/openid-configuration',
    ]);
  });

  it('rejects a shared Admin client or issuer without PKCE S256', async () => {
    const { root, artifactDir } = createFixture();

    const installWith = (oauthClient: Record<string, unknown>, pkceMethods: string[]) => installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoOAuthClientVerifier: undefined,
      skipMigration: true,
      skipMigrationVerify: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => String(input).includes('/auth/oauth-clients/')
        ? Response.json(oauthClient)
        : Response.json({ code_challenge_methods_supported: pkceMethods }),
    });

    await expect(installWith(validAdminOAuthClient({
      redirect_uris: ['https://auth.example.test/admin', 'https://app.example.test/callback'],
    }), ['S256'])).rejects.toThrow('exactly the configured Admin redirect URI');

    await expect(installWith(validAdminOAuthClient(), ['plain'])).rejects.toThrow('advertise PKCE S256');
  });

  it.each([
    ['client_id mismatch', validAdminOAuthClient({ client_id: 'other-client' }), 'different client_id'],
    ['confidential client', validAdminOAuthClient({ client_type: 'confidential' }), 'client_type=public'],
    ['token endpoint authentication', validAdminOAuthClient({ token_endpoint_auth_method: 'client_secret_post' }), 'token_endpoint_auth_method=none'],
    ['non-exact grants', validAdminOAuthClient({ grant_types: ['authorization_code'] }), 'grant_types must contain only'],
  ])('rejects Admin OAuth client read-back with %s', async (_label, oauthClient, expectedError) => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      adminSsoOAuthClientVerifier: undefined,
      skipMigration: true,
      skipMigrationVerify: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => String(input).includes('/auth/oauth-clients/')
        ? Response.json(oauthClient)
        : Response.json({ code_challenge_methods_supported: ['S256'] }),
    })).rejects.toThrow(expectedError);
  });

  for (const [runtimeUrl, expectedProbeUrl] of [
    ['https://project.example.test', 'https://project.example.test/functions/v1/supauth/api/v1/health'],
    ['https://project.example.test/auth/v1', 'https://project.example.test/functions/v1/supauth/api/v1/health'],
    ['https://project.example.test/auth/v1/', 'https://project.example.test/functions/v1/supauth/api/v1/health'],
    ['https://project.example.test/runtime', 'https://project.example.test/runtime/functions/v1/supauth/api/v1/health'],
  ] as const) {
    it(`probes the Function from the project base for runtime URL ${runtimeUrl}`, async () => {
      const { root, artifactDir } = createFixture();
      const fetchedUrls: string[] = [];

      const result = await installSupacloudApp({
        root,
        artifactDir,
        ...requiredOptions,
        runtimeUrl,
        skipMigration: true,
        skipMigrationVerify: true,
        skipSecrets: true,
        skipFunctionDeploy: true,
        fetchImpl: async (input) => {
          fetchedUrls.push(String(input));
          return new Response('ok', { status: 200 });
        },
      });

      expect(fetchedUrls).toEqual([expectedProbeUrl]);
      expect(result.directFunctionProbe?.url).toBe(expectedProbeUrl);
      expect(result.directFunctionProbe?.ok).toBe(true);
    });
  }

  it('prefers the canonical Supabase project URL over a stale custom runtime URL', async () => {
    const { root, artifactDir } = createFixture();
    const envFile = join(root, 'runtime.env');
    writeFileSync(envFile, [
      'SUPACLOUD_API_URL=https://management.example.test',
      'SUPACLOUD_PROJECT_REF=project_123',
      'SUPACLOUD_API_TOKEN=secret-token',
      'SUPAOAUTH_BFF_SIGNING_SECRET=installer-bff-signing-secret-0123456789abcdef',
      'SUPACLOUD_RUNTIME_URL=https://auth.example.test',
      'SUPABASE_URL=https://api.auth.example.test',
      'SUPACLOUD_DATABASE_URL=postgres://secret-db',
      'SUPAUTH_PUBLIC_URL=https://auth.example.test',
      'ADMIN_SSO_ISSUER=https://auth.example.test/auth/v1',
      'ADMIN_SSO_CLIENT_ID=admin-client',
      'ADMIN_SSO_ALLOWED_EMAILS=admin@example.test',
    ].join('\n'));
    const fetchedUrls: string[] = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      envFile,
      skipMigration: true,
      skipMigrationVerify: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      adminSsoAllowlistVerifier: async () => ({ emailCount: 0, domainCount: 0 }),
      adminSsoOAuthClientVerifier: async () => undefined,
      fetchImpl: async (input) => {
        fetchedUrls.push(String(input));
        return new Response('ok', { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(result.runtimeUrl).toBe('https://api.auth.example.test');
    expect(fetchedUrls).toEqual(['https://api.auth.example.test/functions/v1/supauth/api/v1/health']);
  });

  for (const runtimeUrl of [
    'https://project.example.test/auth/v1?tenant=project_123',
    'https://project.example.test/auth/v1#runtime',
  ]) {
    it(`rejects query or fragment data in runtime URL ${runtimeUrl} before install requests`, async () => {
      const { root, artifactDir } = createFixture();
      let requested = false;

      await expect(installSupacloudApp({
        root,
        artifactDir,
        ...requiredOptions,
        runtimeUrl,
        fetchImpl: async () => {
          requested = true;
          return new Response('{}', { status: 200 });
        },
      })).rejects.toThrow('SUPACLOUD_RUNTIME_URL must not include a query string or fragment');

      expect(requested).toBe(false);
    });
  }

  it('runs SupaCloud hosted migration before secrets and function deploy', async () => {
    const { root, artifactDir } = createFixture();
    const calls: string[] = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      corsOrigins: 'https://app.example.test',
      migrationVerifier: async (databaseUrl) => {
        calls.push(`VERIFY ${databaseUrl}`);
        return {
          reachable: true,
          authorizeExists: true,
          hasPermissionExists: true,
          hasOrgPermissionExists: true,
          currentProjectClaimsExists: true,
          currentPermissionClaimsExists: true,
          authorizeGranted: true,
          hasPermissionGranted: true,
          hasOrgPermissionGranted: true,
          currentProjectClaimsGranted: true,
          currentPermissionClaimsGranted: true,
          currentPermissionClaimsPublicRevoked: true,
          currentPermissionClaimsAnonRevoked: true,
          currentPermissionClaimsSecurityDefiner: true,
          currentPermissionClaimsSearchPathHardened: true,
          legacyWebhooksAbsent: true,
          legacyWebhookDeliveriesAbsent: true,
          unsafePolicies: [],
        };
      },
      adminSsoAllowlistVerifier: async (databaseUrl) => {
        calls.push(`VERIFY_ADMIN_SSO ${databaseUrl}`);
        return { emailCount: 0, domainCount: 0 };
      },
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${init?.method || 'GET'} ${url.pathname}`);

        if (url.pathname === '/functions/v1/supauth/api/v1/health') {
          return new Response('ok', { status: 200 });
        }

        if (url.pathname === '/v1/projects/project_123/database/sql') {
          const body = JSON.parse(String(init?.body));
          expect(body.mode).toBe('admin');
          expect(body.admin).toBe(true);
          return new Response(JSON.stringify({ command: 'OK' }), { status: 200 });
        }

        if (url.pathname === '/v1/projects/project_123/secrets') {
          const body = JSON.parse(String(init?.body));
          expectNoSystemManagedProjectSecrets(body);
          expect(body).toEqual([{ name: 'CORS_ORIGINS', value: 'https://app.example.test' }]);
          return new Response('{}', { status: 200 });
        }

        if (url.pathname === '/v1/projects/project_123/functions/supauth/secrets') {
          const body = JSON.parse(String(init?.body));
          expect(body).toEqual(expect.arrayContaining([
            { name: 'ADMIN_SSO_ISSUER', value: 'https://auth.example.test/auth/v1' },
            { name: 'ADMIN_SSO_CLIENT_ID', value: 'admin-client' },
            { name: 'ADMIN_SSO_REDIRECT_URI', value: 'https://auth.example.test/admin' },
            { name: 'ADMIN_SSO_REQUIRE_AAL2', value: 'false' },
          ]));
          return new Response('{}', { status: 200 });
        }

        if (url.pathname === '/v1/projects/project_123/functions') {
          return Response.json([{ slug: 'supauth', version: 44 }]);
        }

        if (url.pathname === '/v1/projects/project_123/functions/supauth/bundle') {
          const body = JSON.parse(String(init?.body));
          expect(body.entrypoint).toBe('index.ts');
          expect(body.expected_active_version).toBe('44');
          expect(body.expected_activation_id).toBe('legacy');
          expect(body.verify_jwt).toBe(false);
          expect(Object.keys(body.files)).toEqual([
            'index.ts',
            'admin-console/build/_app/immutable/admin.css',
            'admin-console/build/_app/immutable/admin.js',
            'admin-console/build/account.html',
            'admin-console/build/authorize.html',
            'admin-console/build/change-password.html',
            'admin-console/build/claim.html',
            'admin-console/build/index.html',
            'admin-console/build/logout.html',
          ]);
          expect(body.files['admin-console/build/_app/immutable/admin.js']).toBe('export const admin = true;');
        }

        return new Response('{}', { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map(({ name }) => name)).toEqual([
      'artifact-verification',
      'migration',
      'migration-verification',
      'admin-sso-allowlist-verification',
      'admin-sso-oauth-client-verification',
      'admin-sso-aal2-policy',
      'runtime-env',
      'function-deploy',
      'gateway-routes',
      'direct-function-probe',
    ]);
    expect(calls[0]).toBe('POST /v1/projects/project_123/database/sql');
    expect(calls).toContain(`VERIFY ${requiredOptions.databaseUrl}`);
    expect(calls).toContain(`VERIFY_ADMIN_SSO ${requiredOptions.databaseUrl}`);
    expect(calls).toContain('POST /v1/projects/project_123/functions/supauth/secrets');
    expect(calls).toContain('POST /v1/projects/project_123/secrets');
    expect(calls.slice(-3)).toEqual([
      'GET /v1/projects/project_123/functions',
      'POST /v1/projects/project_123/functions/supauth/bundle',
      'GET /functions/v1/supauth/api/v1/health',
    ]);
    expect(calls.indexOf('POST /v1/projects/project_123/database/sql')).toBeLessThan(
      calls.indexOf(`VERIFY ${requiredOptions.databaseUrl}`),
    );
    expect(calls.indexOf(`VERIFY ${requiredOptions.databaseUrl}`)).toBeLessThan(
      calls.indexOf(`VERIFY_ADMIN_SSO ${requiredOptions.databaseUrl}`),
    );
    expect(calls.indexOf(`VERIFY_ADMIN_SSO ${requiredOptions.databaseUrl}`)).toBeLessThan(
      calls.indexOf('POST /v1/projects/project_123/functions/supauth/secrets'),
    );
    expect(calls.indexOf('POST /v1/projects/project_123/functions/supauth/secrets')).toBeLessThan(
      calls.indexOf('POST /v1/projects/project_123/secrets'),
    );
    expect(calls).toEqual(expect.arrayContaining([
      'POST /v1/projects/project_123/database/sql',
      `VERIFY ${requiredOptions.databaseUrl}`,
      `VERIFY_ADMIN_SSO ${requiredOptions.databaseUrl}`,
      'POST /v1/projects/project_123/functions/supauth/secrets',
      'POST /v1/projects/project_123/secrets',
      'GET /v1/projects/project_123/functions',
      'POST /v1/projects/project_123/functions/supauth/bundle',
      'GET /functions/v1/supauth/api/v1/health',
    ]));
  });

  it('deploys a first Function release with an atomic absent-version contract', async () => {
    const { root, artifactDir } = createFixture();
    const calls: string[] = [];
    let bundleBody: Record<string, unknown> | undefined;

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const pathname = new URL(String(input)).pathname;
        calls.push(`${init?.method || 'GET'} ${pathname}`);
        if (pathname === '/v1/projects/project_123/functions') return Response.json([]);
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') {
          bundleBody = JSON.parse(String(init?.body));
          return Response.json({ active_version: 1 });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'GET /v1/projects/project_123/functions',
      'POST /v1/projects/project_123/functions/supauth/bundle',
    ]);
    expect(bundleBody).toEqual(expect.objectContaining({
      entrypoint: 'index.ts',
      minify: false,
      expected_active_version: 'absent',
      expected_activation_id: 'legacy',
      verify_jwt: false,
    }));
  });

  it('uses the Function activation ID from the same list snapshot as the version CAS', async () => {
    const { root, artifactDir } = createFixture();
    let bundleBody: Record<string, unknown> | undefined;
    const activationId = '123e4567-e89b-42d3-a456-426614174000';

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([{ slug: 'supauth', version: 44, activation_id: activationId }]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') {
          bundleBody = JSON.parse(String(init?.body));
          return Response.json({ active_version: 45, activation_id: '223e4567-e89b-42d3-a456-426614174000' });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(bundleBody).toEqual(expect.objectContaining({
      expected_active_version: '44',
      expected_activation_id: activationId,
    }));
  });

  it('retries once without activation CAS only for an older server that explicitly rejects the new field', async () => {
    const { root, artifactDir } = createFixture();
    const bundleBodies: Array<Record<string, unknown>> = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([{ slug: 'supauth', version: 44 }]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') {
          const body = JSON.parse(String(init?.body));
          bundleBodies.push(body);
          if (bundleBodies.length === 1) {
            return Response.json(
              { message: 'unknown property expected_activation_id', code: 'VALIDATION_ERROR' },
              { status: 400 },
            );
          }
          return Response.json({ active_version: 45 });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(bundleBodies).toHaveLength(2);
    expect(bundleBodies[0]).toEqual(expect.objectContaining({
      expected_active_version: '44',
      expected_activation_id: 'legacy',
    }));
    expect(bundleBodies[1]).toEqual(expect.objectContaining({ expected_active_version: '44' }));
    expect(bundleBodies[1]).not.toHaveProperty('expected_activation_id');
  });

  it.each([
    ['an object', { slug: 'supauth', version: 44 }, 'must be an array'],
    ['a null entry', [null], 'entries must be objects'],
    ['an entry without a string slug', [{ version: 44 }], 'entry slug must be a string'],
  ])('rejects a malformed Function list containing %s before bundle upload', async (_label, payload, expectedError) => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') return Response.json(payload);
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') bundleRequests += 1;
        return Response.json({});
      },
    })).rejects.toThrow(expectedError);

    expect(bundleRequests).toBe(0);
  });

  it('rejects invalid Function list JSON before bundle upload', async () => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') return new Response('{');
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') bundleRequests += 1;
        return Response.json({});
      },
    })).rejects.toThrow('must be valid JSON');

    expect(bundleRequests).toBe(0);
  });

  it('rejects duplicate exact supauth Function entries before bundle upload', async () => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([
            { slug: 'supauth', version: 43 },
            { slug: 'unrelated', version: 7 },
            { slug: 'supauth', version: 44 },
          ]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') bundleRequests += 1;
        return Response.json({});
      },
    })).rejects.toThrow('duplicate supauth entries');

    expect(bundleRequests).toBe(0);
  });

  it.each([
    ['missing', undefined],
    ['a string', '44'],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s active Function version before bundle upload', async (_label, version) => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([{ slug: 'supauth', ...(version === undefined ? {} : { version }) }]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') bundleRequests += 1;
        return Response.json({});
      },
    })).rejects.toThrow('version must be a non-negative safe integer');

    expect(bundleRequests).toBe(0);
  });

  it.each([
    ['an empty string', ''],
    ['a non-UUID string', 'not-an-activation-id'],
    ['a UUID with an invalid variant', '123e4567-e89b-42d3-7456-426614174000'],
    ['a null value', null],
  ])('rejects %s Function activation ID before bundle upload', async (_label, activationId) => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([{ slug: 'supauth', version: 44, activation_id: activationId }]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') bundleRequests += 1;
        return Response.json({});
      },
    })).rejects.toThrow('activation_id must be a canonical UUID or legacy');

    expect(bundleRequests).toBe(0);
  });

  it('surfaces a Function version conflict without retrying the bundle request', async () => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([{ slug: 'supauth', version: 44 }]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') {
          bundleRequests += 1;
          return Response.json({ code: 'FUNCTION_ACTIVE_VERSION_CONFLICT' }, { status: 409 });
        }
        return Response.json({});
      },
    })).rejects.toThrow('failed with 409');

    expect(bundleRequests).toBe(1);
  });

  it('does not retry an activation conflict for a Function with a reported activation ID', async () => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([{
            slug: 'supauth',
            version: 44,
            activation_id: '123e4567-e89b-42d3-a456-426614174000',
          }]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') {
          bundleRequests += 1;
          return Response.json({ code: 'FUNCTION_ACTIVE_VERSION_CONFLICT' }, { status: 409 });
        }
        return Response.json({});
      },
    })).rejects.toThrow('failed with 409');

    expect(bundleRequests).toBe(1);
  });

  it('does not downgrade a reported activation ID after a validation failure', async () => {
    const { root, artifactDir } = createFixture();
    let bundleRequests = 0;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigration: true,
      skipSecrets: true,
      skipDirectVerify: true,
      fetchImpl: async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/v1/projects/project_123/functions') {
          return Response.json([{
            slug: 'supauth',
            version: 44,
            activation_id: '123e4567-e89b-42d3-a456-426614174000',
          }]);
        }
        if (pathname === '/v1/projects/project_123/functions/supauth/bundle') {
          bundleRequests += 1;
          return Response.json(
            { message: 'unknown property expected_activation_id', code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
        }
        return Response.json({});
      },
    })).rejects.toThrow('failed with 400');

    expect(bundleRequests).toBe(1);
  });

  it('rejects symlinks in the Admin static deployment tree before install requests', async () => {
    const { root, artifactDir } = createFixture();
    symlinkSync('index.html', join(root, 'admin-build', 'linked-index.html'));
    let requested = false;

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
      fetchImpl: async () => {
        requested = true;
        return new Response('{}');
      },
    })).rejects.toThrow('must not contain symlinks');
    expect(requested).toBe(false);
  });

  it('rejects binary files in the Admin static deployment tree', async () => {
    const { root, artifactDir } = createFixture();
    writeFileSync(join(root, 'admin-build', 'binary.dat'), Buffer.from([0x89, 0x50, 0x00, 0x47]));

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
    })).rejects.toThrow('Admin static artifact is binary: binary.dat');
  });

  it('rejects an Admin static path whose ancestor symlink escapes the real repository root', async () => {
    const { root, artifactDir } = createFixture();
    const outsideRoot = mkdtempSync(join(tmpdir(), 'supauth-linked-admin-'));
    writeAdminPages(join(outsideRoot, 'admin'));
    symlinkSync(outsideRoot, join(root, 'linked-static-root'), 'dir');
    const manifestPath = join(root, artifactDir, 'supacloud-app-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts.admin_static_dir = 'linked-static-root/admin';
    manifest.pages[0].source_dir = 'linked-static-root/admin';
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
    })).rejects.toThrow('Manifest artifact resolves outside the repository root: admin_static_dir');
  });

  it('rejects a symlink Function bundle even when its target stays inside the repository', async () => {
    const { root, artifactDir } = createFixture();
    const functionBundle = join(root, 'function', 'supacloud-function.js');
    writeFileSync(join(root, 'function', 'real-function.js'), 'export default { fetch() {} };');
    unlinkSync(functionBundle);
    symlinkSync('real-function.js', functionBundle);

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
    })).rejects.toThrow('function_bundle must be a regular file and must not be a symlink');
  });

  it('rejects a non-regular Function bundle before the offline verifier reads it', async () => {
    const { root, artifactDir } = createFixture();
    const functionBundle = join(root, 'function', 'supacloud-function.js');
    unlinkSync(functionBundle);
    mkdirSync(functionBundle);

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
    })).rejects.toThrow('function_bundle must be a regular file and must not be a symlink');
  });

  it('rejects an Admin static artifact outside the repository root', async () => {
    const { root, artifactDir } = createFixture();
    const outsideAdminDir = mkdtempSync(join(tmpdir(), 'supauth-outside-admin-'));
    writeAdminPages(outsideAdminDir);
    const manifestPath = join(root, artifactDir, 'supacloud-app-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts.admin_static_dir = outsideAdminDir;
    manifest.pages[0].source_dir = outsideAdminDir;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
    })).rejects.toThrow('Manifest artifact escapes the repository root: admin_static_dir');
  });

  it('applies every versioned hosted migration through the Management API', async () => {
    const { root, artifactDir } = createFixture();
    const submittedStatements: string[] = [];

    await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      skipMigrationVerify: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/v1/projects/project_123/database/sql') {
          const requestBody = JSON.parse(String(init?.body)) as { sql: string };
          submittedStatements.push(requestBody.sql);
        }
        return new Response('{}', { status: 200 });
      },
    });

    const submittedSql = submittedStatements.join('\n');
    expect(submittedSql).toContain('uq_user_consents_active');
    expect(submittedSql).toContain('uq_provisioning_records_project_step');
    expect(submittedSql).toContain('oauth_consent_decisions');
    expect(submittedSql).toContain('uq_tenant_configs_type_key');
    expect(submittedSql).toContain('supaoauth.current_project_claims()');
    const revokeIndex = submittedStatements.findIndex((statement) => statement.includes(
      'REVOKE ALL PRIVILEGES ON TABLE supaoauth.webhooks FROM PUBLIC',
    ));
    const retirementIndex = submittedStatements.findIndex((statement) => statement.includes(
      'reason_code=legacy_webhook_data_present',
    ));
    expect(revokeIndex).toBeGreaterThanOrEqual(0);
    expect(retirementIndex).toBeGreaterThan(revokeIndex);
  });

  it('does not run overlay migrations against the center IdP auth schema', async () => {
    const { root, artifactDir } = createFixture();
    const calls: string[] = [];
    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      oauthAuthorizationProjectRef: 'central_idp_project',
      skipMigrationVerify: true,
      skipSecrets: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${init?.method || 'GET'} ${url.pathname}`);
        return new Response('{}', { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toContain('POST /v1/projects/project_123/database/sql');
    expect(calls).not.toContain('POST /v1/projects/central_idp_project/database/sql');
  });

  it('posts the center IdP project ref through Function-scoped runtime variables', async () => {
    const { root, artifactDir } = createFixture();
    const seenProjectSecrets: Array<{ name: string; value: string }> = [];
    const seenFunctionSecrets: Array<{ name: string; value: string }> = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      oauthAuthorizationProjectRef: 'central_idp_project',
      skipMigration: true,
      skipMigrationVerify: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/v1/projects/project_123/secrets') {
          seenProjectSecrets.push(...JSON.parse(String(init?.body)));
        }
        if (url.pathname === '/v1/projects/project_123/functions/supauth/secrets') {
          seenFunctionSecrets.push(...JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expectNoSystemManagedProjectSecrets(seenProjectSecrets);
    expect(seenProjectSecrets).toEqual([]);
    expect(seenFunctionSecrets).toContainEqual({
      name: 'SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF',
      value: 'central_idp_project',
    });
  });

  it('prefers SupaCloud env-file values and refuses stale generic DATABASE_URL for function DB', async () => {
    const { root, artifactDir } = createFixture();
    const envFile = join(root, 'project.env');
    writeFileSync(envFile, [
      'SUPACLOUD_API_URL=https://api.from-file.test',
      'SUPACLOUD_PROJECT_REF=project_from_file',
      'SUPACLOUD_API_TOKEN=file-token',
      'SUPAOAUTH_BFF_SIGNING_SECRET=file-bff-signing-secret-0123456789abcdef',
      'SUPACLOUD_GATEWAY_ADMIN_TOKEN=file-admin-token',
      'SUPACLOUD_RUNTIME_URL=https://runtime.from-file.test',
      'SUPACLOUD_DATABASE_URL=postgres://project-db',
      'SUPAUTH_PUBLIC_URL=https://auth.from-file.test',
      'SUPAUTH_API_URL=https://auth-api.from-file.test',
      'CORS_ORIGINS=https://www.from-file.test',
      'ADMIN_SSO_ISSUER=https://issuer.from-file.test/auth/v1',
      'ADMIN_SSO_CLIENT_ID=file-client',
      'ADMIN_SSO_ALLOWED_EMAILS=admin@file.example.test',
    ].join('\n'));

    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://stale-local-db';
    try {
      const seenProjectSecrets: Array<{ name: string; value: string }> = [];
      const seenFunctionSecrets: Array<{ name: string; value: string }> = [];
      const routeIds: string[] = [];
      let verifiedDatabaseUrl = '';
      const result = await installSupacloudApp({
        root,
        artifactDir,
        envFile,
        skipMigration: true,
        skipFunctionDeploy: true,
        skipDirectVerify: true,
        adminSsoAllowlistVerifier: async (databaseUrl) => {
          verifiedDatabaseUrl = databaseUrl;
          return { emailCount: 0, domainCount: 0 };
        },
        adminSsoOAuthClientVerifier: async () => undefined,
        fetchImpl: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/v1/projects/project_from_file/secrets') {
            seenProjectSecrets.push(...JSON.parse(String(init?.body)));
          }
          if (url.pathname === '/v1/projects/project_from_file/functions/supauth/secrets') {
            seenFunctionSecrets.push(...JSON.parse(String(init?.body)));
          }
          if (url.pathname === '/v1/projects/project_from_file/gateway/routes') {
            routeIds.push(JSON.parse(String(init?.body)).id);
          }
          return new Response('{}', { status: 200 });
        },
      });

      expect(result.ok).toBe(true);
      expect(result.projectRef).toBe('project_from_file');
      expect(verifiedDatabaseUrl).toBe('postgres://project-db');
      expectNoSystemManagedProjectSecrets(seenProjectSecrets);
      expect(seenProjectSecrets).toEqual([{
        name: 'CORS_ORIGINS',
        value: 'https://www.from-file.test,https://auth.from-file.test,https://auth-api.from-file.test',
      }]);
      expect(seenFunctionSecrets).toEqual(expect.arrayContaining([
        { name: 'ADMIN_SSO_ISSUER', value: 'https://issuer.from-file.test/auth/v1' },
        { name: 'ADMIN_SSO_CLIENT_ID', value: 'file-client' },
        { name: 'SUPAUTH_PUBLIC_URL', value: 'https://auth.from-file.test' },
        { name: 'SUPAUTH_INSTALLED_BASE_URL', value: 'https://auth.from-file.test' },
        { name: 'ADMIN_SSO_REQUIRE_AAL2', value: 'false' },
      ]));
      expect(routeIds).toEqual([
        'supauth-function-hosted',
        'supauth-function-custom-ui-fallback',
        'supauth-function-logout',
        'supauth-function-admin-root',
        'supauth-api',
        expect.stringMatching(/^supauth-https-[a-f0-9]{20}$/),
        expect.stringMatching(/^supauth-https-[a-f0-9]{20}$/),
        expect.stringMatching(/^supauth-https-[a-f0-9]{20}$/),
      ]);
      expect(new Set(routeIds.slice(5)).size).toBe(3);
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('does not accept generic DATABASE_URL as the SupaCloud Function database URL', async () => {
    const { root, artifactDir } = createFixture();
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://stale-local-db';
    try {
      await expect(installSupacloudApp({
        root,
        artifactDir,
        supacloudApiUrl: requiredOptions.supacloudApiUrl,
        projectRef: requiredOptions.projectRef,
        token: requiredOptions.token,
        runtimeUrl: requiredOptions.runtimeUrl,
        dryRun: true,
      })).rejects.toThrow('SUPACLOUD_DATABASE_URL');
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('requires an explicit independent BFF signing secret without generating one', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      bffSigningSecret: undefined,
      dryRun: true,
    })).rejects.toThrow('SUPAOAUTH_BFF_SIGNING_SECRET');

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      bffSigningSecret: 'short-secret',
      dryRun: true,
    })).rejects.toThrow('SUPAOAUTH_BFF_SIGNING_SECRET must be at least 32 characters');

    const sharedSecret = 'shared-install-secret-0123456789abcdef';
    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      token: sharedSecret,
      bffSigningSecret: sharedSecret,
      dryRun: true,
    })).rejects.toThrow('SUPAOAUTH_BFF_SIGNING_SECRET must be independent from the SupaCloud token');

    const installerSource = readFileSync('scripts/install-supacloud-app.ts', 'utf8');
    expect(installerSource).toContain("bffSigningSecret: option('bff-signing-secret')");
    for (const cliOption of [
      'admin-sso-issuer',
      'admin-sso-client-id',
      'admin-sso-jwks-uri',
      'admin-sso-audience',
      'admin-sso-redirect-uri',
      'admin-sso-post-logout-redirect-uri',
      'admin-sso-require-aal2',
      'admin-sso-allowed-emails',
      'admin-sso-allowed-domains',
    ]) {
      expect(installerSource).toContain(`option('${cliOption}')`);
    }
    expect(installerSource).not.toContain('randomBytes');
  });

  it('redacts the BFF signing secret from Management API failures', async () => {
    const { root, artifactDir } = createFixture();
    let failureMessage = '';

    try {
      await installSupacloudApp({
        root,
        artifactDir,
        ...requiredOptions,
        skipMigration: true,
        skipFunctionDeploy: true,
        skipDirectVerify: true,
        fetchImpl: async () => new Response(
          `rejected ${requiredOptions.bffSigningSecret} ${requiredOptions.adminSsoAllowedEmails}`,
          { status: 500 },
        ),
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failureMessage).toContain('[REDACTED]');
    expect(failureMessage).not.toContain(requiredOptions.bffSigningSecret);
    expect(failureMessage).not.toContain(requiredOptions.adminSsoAllowedEmails);
  });

  it('redacts individual trimmed Admin email entries from partial upstream echoes', async () => {
    const { root, artifactDir } = createFixture();
    const firstEmail = 'first@example.test';
    const echoedEmail = 'second@example.test';
    let failureMessage = '';

    try {
      await installSupacloudApp({
        root,
        artifactDir,
        ...requiredOptions,
        adminSsoAllowedEmails: ` ${firstEmail} , ${echoedEmail} `,
        skipMigration: true,
        skipFunctionDeploy: true,
        skipDirectVerify: true,
        fetchImpl: async () => new Response(`rejected ${firstEmail} and ${echoedEmail}`, { status: 500 }),
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failureMessage).toContain('rejected [REDACTED] and [REDACTED]');
    expect(failureMessage).not.toContain(firstEmail);
    expect(failureMessage).not.toContain(echoedEmail);
  });

  it('redacts a full email before its shorter domain fragment', async () => {
    const { root, artifactDir } = createFixture();
    const echoedEmail = 'alice@example.test';
    let failureMessage = '';

    try {
      await installSupacloudApp({
        root,
        artifactDir,
        ...requiredOptions,
        adminSsoAllowedEmails: `example.test,${echoedEmail}`,
        skipMigration: true,
        skipFunctionDeploy: true,
        skipDirectVerify: true,
        fetchImpl: async () => new Response(`rejected ${echoedEmail}`, { status: 500 }),
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failureMessage).toContain('rejected [REDACTED]');
    expect(failureMessage).not.toContain('alice@');
    expect(failureMessage).not.toContain('example.test');
    expect(failureMessage).not.toContain(echoedEmail);
  });

  it('defaults hosted gateway routes to the Management API with a project Host header', async () => {
    const { root, artifactDir } = createFixture();
    const calls: Array<{ path: string; auth: string | null; body: any }> = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      gatewayAdminToken: 'admin-token',
      baseUrl: 'https://auth.example.test',
      skipMigrationVerify: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          path: url.pathname,
          auth: new Headers(init?.headers).get('authorization'),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url.pathname === '/v1/projects/project_123/functions') return Response.json([]);
        return new Response('{}', { status: 200 });
      },
    });

    const gatewayCalls = calls.filter((call) => call.path === '/v1/projects/project_123/gateway/routes');
    const hostedGatewayCall = gatewayCalls.find((call) => call.body?.id === 'supauth-function-hosted');
    const customUiFallbackCall = gatewayCalls.find((call) => call.body?.id === 'supauth-function-custom-ui-fallback');
    const logoutGatewayCall = gatewayCalls.find((call) => call.body?.id === 'supauth-function-logout');
    const adminRootGatewayCall = gatewayCalls.find((call) => call.body?.id === 'supauth-function-admin-root');
    const proxyGatewayCalls = gatewayCalls.filter((call) => call.body?.upstream);
    const redirectGatewayCalls = gatewayCalls.filter((call) => call.body?.protocol === 'http');
    expect(result.ok).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({ name: 'gateway-routes', status: 'done' }));
    expect(gatewayCalls).toHaveLength(6);
    expect(gatewayCalls.every((call) => call.body.path.length <= 20)).toBe(true);
    expect(proxyGatewayCalls).toHaveLength(4);
    expect(proxyGatewayCalls.every((call) => call.body.upstream === '127.0.0.1:9090')).toBe(true);
    expect(proxyGatewayCalls.every((call) => call.body.headers?.Host === 'auth.example.test')).toBe(true);
    expect(redirectGatewayCalls.map((call) => call.body.hosts[0])).toEqual([
      'auth.example.test',
      'project.example.test',
    ]);
    expect(hostedGatewayCall?.auth).toBe('Bearer admin-token');
    expect(hostedGatewayCall?.body).toMatchObject({
      id: 'supauth-function-hosted',
      hosts: ['auth.example.test'],
      upstream: '127.0.0.1:9090',
      headers: { Host: 'auth.example.test' },
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100,
      cors: expect.arrayContaining(['https://auth.example.test']),
    });
    expect(hostedGatewayCall?.body.path).toEqual(expect.arrayContaining(['/api/*', '/oauth/*', '/login.html', '/authorize.html', '/hosted-auth.js', '/account', '/account.html', '/claim.html', '/admin/*', '/']));
    expect(hostedGatewayCall?.body.path).toContain('/v1/public/*');
    expect(hostedGatewayCall?.body.path).not.toContain('/admin');
    expect(customUiFallbackCall?.body).toMatchObject({
      id: 'supauth-function-custom-ui-fallback',
      hosts: ['auth.example.test'],
      path: ['/custom-ui/*'],
      upstream: '127.0.0.1:9090',
      headers: { Host: 'auth.example.test' },
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100,
      enabled: true,
      cors: expect.arrayContaining(['https://auth.example.test']),
    });
    expect(logoutGatewayCall?.body).toMatchObject({
      id: 'supauth-function-logout',
      hosts: ['auth.example.test'],
      path: ['/logout', '/logout.html'],
      priority: 100,
    });
    expect(adminRootGatewayCall?.auth).toBe('Bearer admin-token');
    expect(adminRootGatewayCall?.body).toMatchObject({
      id: 'supauth-function-admin-root',
      hosts: ['auth.example.test'],
      path: ['/admin'],
      upstream: '127.0.0.1:9090',
      headers: { Host: 'auth.example.test' },
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100,
      enabled: true,
      cors: expect.arrayContaining(['https://auth.example.test']),
    });
  });

  it('configures a separate API route and injects deduplicated Function CORS origins', async () => {
    const { root, artifactDir } = createFixture();
    const routeBodies: any[] = [];
    const seenSecrets: Array<{ name: string; value: string }> = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      gatewayAdminToken: 'admin-token',
      baseUrl: 'https://auth.example.test/',
      apiUrl: 'https://auth-api.example.test/',
      corsOrigins: [
        'https://www.example.test',
        'https://auth.example.test/path-is-normalized',
        'https://www.example.test/',
      ],
      skipMigration: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/v1/projects/project_123/secrets') {
          seenSecrets.push(...JSON.parse(String(init?.body)));
        }
        if (url.pathname === '/v1/projects/project_123/gateway/routes') {
          routeBodies.push(JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    const cors = [
      'https://www.example.test',
      'https://auth.example.test',
      'https://auth-api.example.test',
    ];
    expect(result.ok).toBe(true);
    expect(seenSecrets).toContainEqual({ name: 'CORS_ORIGINS', value: cors.join(',') });
    expect(routeBodies).toHaveLength(8);
    expect(routeBodies.every((route) => route.path.length <= 20)).toBe(true);
    expect(routeBodies.find((route) => route.id === 'supauth-function-hosted')).toMatchObject({
      id: 'supauth-function-hosted',
      hosts: ['auth.example.test'],
      cors,
    });
    expect(routeBodies.find((route) => route.id === 'supauth-function-custom-ui-fallback')).toMatchObject({
      id: 'supauth-function-custom-ui-fallback',
      hosts: ['auth.example.test'],
      path: ['/custom-ui/*'],
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      cors,
    });
    expect(routeBodies.find((route) => route.id === 'supauth-function-logout')).toMatchObject({
      id: 'supauth-function-logout',
      hosts: ['auth.example.test'],
      path: ['/logout', '/logout.html'],
      cors,
    });
    expect(routeBodies.find((route) => route.id === 'supauth-function-admin-root')).toMatchObject({
      id: 'supauth-function-admin-root',
      hosts: ['auth.example.test'],
      path: ['/admin'],
      upstream: '127.0.0.1:9090',
      headers: { Host: 'auth.example.test' },
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100,
      enabled: true,
      cors,
    });
    expect(routeBodies.find((route) => route.id === 'supauth-api')).toMatchObject({
      id: 'supauth-api',
      hosts: ['auth-api.example.test'],
      path: ['/api/*', '/v1/*', '/v1/public/*', '/oauth/*', '/swagger*', '/'],
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 110,
      enabled: true,
      cors,
    });
    const apiRoute = routeBodies.find((route) => route.id === 'supauth-api');
    const proxyRoutes = routeBodies.filter((route) => route.upstream);
    const redirectRoutes = routeBodies.filter((route) => route.protocol === 'http');
    expect(apiRoute.path).not.toContain('/auth/v1/*');
    expect(proxyRoutes).toHaveLength(5);
    expect(proxyRoutes.every((route) => route.upstream === '127.0.0.1:9090')).toBe(true);
    expect(proxyRoutes.every((route) => route.headers?.Host === 'auth.example.test')).toBe(true);
    expect(redirectRoutes.map((route) => route.hosts[0])).toEqual([
      'auth.example.test',
      'project.example.test',
      'auth-api.example.test',
    ]);
    expect(new Set(redirectRoutes.map((route) => route.id)).size).toBe(3);
    for (const redirectRoute of redirectRoutes) {
      const hostname = redirectRoute.hosts[0];
      expect(redirectRoute).toMatchObject({
        id: expect.stringMatching(/^supauth-https-[a-f0-9]{20}$/),
        path: '/*',
        protocol: 'http',
        redirect_to: `https://${hostname}{http.request.uri}`,
        redirect_status: 308,
        priority: 1000,
        enabled: true,
      });
      expect(redirectRoute).not.toHaveProperty('headers');
      expect(redirectRoute).not.toHaveProperty('upstream_tls_insecure_skip_verify');
    }
  });

  it('upserts one stable HTTP-to-HTTPS redirect route per distinct public host', async () => {
    const { root, artifactDir } = createFixture();
    const routeBodies: any[] = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      gatewayAdminToken: 'admin-token',
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://auth.example.test/auth/v1',
      apiUrl: 'https://auth.example.test/api',
      skipMigration: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/v1/projects/project_123/gateway/routes') {
          routeBodies.push(JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    const redirects = routeBodies.filter((route) => route.protocol === 'http');
    expect(result.ok).toBe(true);
    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toMatchObject({
      id: expect.stringMatching(/^supauth-https-[a-f0-9]{20}$/),
      hosts: ['auth.example.test'],
      path: '/*',
      protocol: 'http',
      redirect_to: 'https://auth.example.test{http.request.uri}',
      redirect_status: 308,
      priority: 1000,
      enabled: true,
    });
    expect(redirects[0]).not.toHaveProperty('headers');
    expect(redirects[0]).not.toHaveProperty('upstream_tls_insecure_skip_verify');
  });

  it('preserves explicit direct Edge upstream overrides without a Management Host header', async () => {
    const { root, artifactDir } = createFixture();
    const routeBodies: any[] = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      gatewayAdminToken: 'admin-token',
      baseUrl: 'https://auth.example.test',
      edgeRuntimeUpstream: '127.0.0.1:9000',
      skipMigration: true,
      skipMigrationVerify: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/v1/projects/project_123/gateway/routes') {
          routeBodies.push(JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    const proxyRoutes = routeBodies.filter((route) => route.upstream);
    const redirectRoutes = routeBodies.filter((route) => route.protocol === 'http');
    expect(result.ok).toBe(true);
    expect(routeBodies).toHaveLength(6);
    expect(proxyRoutes).toHaveLength(4);
    expect(proxyRoutes.every((route) => route.upstream === '127.0.0.1:9000')).toBe(true);
    expect(proxyRoutes.every((route) => !('headers' in route))).toBe(true);
    expect(redirectRoutes).toHaveLength(2);
  });

  it('uses the EDGE_RUNTIME_UPSTREAM environment override for direct Edge routes', async () => {
    const { root, artifactDir } = createFixture();
    const routeBodies: any[] = [];
    process.env.EDGE_RUNTIME_UPSTREAM = '127.0.0.1:9005';

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      gatewayAdminToken: 'admin-token',
      baseUrl: 'https://auth.example.test',
      skipMigration: true,
      skipMigrationVerify: true,
      skipFunctionDeploy: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/v1/projects/project_123/gateway/routes') {
          routeBodies.push(JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    const proxyRoutes = routeBodies.filter((route) => route.upstream);
    const redirectRoutes = routeBodies.filter((route) => route.protocol === 'http');
    expect(result.ok).toBe(true);
    expect(routeBodies).toHaveLength(6);
    expect(proxyRoutes).toHaveLength(4);
    expect(proxyRoutes.every((route) => route.upstream === '127.0.0.1:9005')).toBe(true);
    expect(proxyRoutes.every((route) => !('headers' in route))).toBe(true);
    expect(redirectRoutes).toHaveLength(2);
  });

  it('rejects wildcard CORS when gateway credentials are enabled', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      baseUrl: 'https://auth.example.test',
      corsOrigins: '*',
      dryRun: true,
    })).rejects.toThrow('CORS origin must use http(s): *');
  });

  it('fails install when migration verification does not pass', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      migrationVerifier: async () => ({
        reachable: true,
        authorizeExists: true,
        hasPermissionExists: true,
        hasOrgPermissionExists: false,
        currentProjectClaimsExists: true,
        currentPermissionClaimsExists: true,
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
        currentPermissionClaimsGranted: true,
        currentPermissionClaimsPublicRevoked: true,
        currentPermissionClaimsAnonRevoked: true,
        currentPermissionClaimsSecurityDefiner: true,
        currentPermissionClaimsSearchPathHardened: true,
        legacyWebhooksAbsent: true,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('supaoauth.has_org_permission() is missing');
  });

  it('fails install when the generic RBAC permission helper alias is missing', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      migrationVerifier: async () => ({
        reachable: true,
        authorizeExists: true,
        hasPermissionExists: false,
        hasOrgPermissionExists: true,
        currentProjectClaimsExists: true,
        currentPermissionClaimsExists: true,
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
        currentPermissionClaimsGranted: true,
        currentPermissionClaimsPublicRevoked: true,
        currentPermissionClaimsAnonRevoked: true,
        currentPermissionClaimsSecurityDefiner: true,
        currentPermissionClaimsSearchPathHardened: true,
        legacyWebhooksAbsent: true,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('supaoauth.has_permission() is missing');
  });

  it('fails install when project-scoped claim resolution is missing', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      migrationVerifier: async () => ({
        reachable: true,
        authorizeExists: true,
        hasPermissionExists: true,
        hasOrgPermissionExists: true,
        currentProjectClaimsExists: false,
        currentPermissionClaimsExists: true,
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: false,
        currentPermissionClaimsGranted: true,
        currentPermissionClaimsPublicRevoked: true,
        currentPermissionClaimsAnonRevoked: true,
        currentPermissionClaimsSecurityDefiner: true,
        currentPermissionClaimsSearchPathHardened: true,
        legacyWebhooksAbsent: true,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('supaoauth.current_project_claims() is missing');
  });

  it('fails install when direct permission projection execution is unavailable', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      migrationVerifier: async () => ({
        reachable: true,
        authorizeExists: true,
        hasPermissionExists: true,
        hasOrgPermissionExists: true,
        currentProjectClaimsExists: true,
        currentPermissionClaimsExists: true,
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
        currentPermissionClaimsGranted: false,
        currentPermissionClaimsPublicRevoked: true,
        currentPermissionClaimsAnonRevoked: true,
        currentPermissionClaimsSecurityDefiner: true,
        currentPermissionClaimsSearchPathHardened: true,
        legacyWebhooksAbsent: true,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('authenticated lacks EXECUTE on supaoauth.current_permission_claims(UUID)');
  });

  it('fails install when PUBLIC can execute the permission projection', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      migrationVerifier: async () => ({
        reachable: true,
        authorizeExists: true,
        hasPermissionExists: true,
        hasOrgPermissionExists: true,
        currentProjectClaimsExists: true,
        currentPermissionClaimsExists: true,
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
        currentPermissionClaimsGranted: true,
        currentPermissionClaimsPublicRevoked: false,
        currentPermissionClaimsAnonRevoked: true,
        currentPermissionClaimsSecurityDefiner: true,
        currentPermissionClaimsSearchPathHardened: true,
        legacyWebhooksAbsent: true,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('PUBLIC can execute supaoauth.current_permission_claims(UUID)');
  });

  it('fails install verification while a retired local webhook table remains', async () => {
    const { root, artifactDir } = createFixture();

    await expect(installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      migrationVerifier: async () => ({
        reachable: true,
        authorizeExists: true,
        hasPermissionExists: true,
        hasOrgPermissionExists: true,
        currentProjectClaimsExists: true,
        currentPermissionClaimsExists: true,
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
        currentPermissionClaimsGranted: true,
        currentPermissionClaimsPublicRevoked: true,
        currentPermissionClaimsAnonRevoked: true,
        currentPermissionClaimsSecurityDefiner: true,
        currentPermissionClaimsSearchPathHardened: true,
        legacyWebhooksAbsent: false,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('reason_code=legacy_webhook_table_present: supaoauth.webhooks must be retired');
  });
});

describe('SupacloudClient rate-limit resilience', () => {
  const noSleep = async () => {};

  it('waits out a 429 window and retries the same request', async () => {
    const calls: string[] = [];
    const pastReset = String(Math.floor(Date.now() / 1000) - 1);
    const client = new SupacloudClient('http://mgmt.local', 'token', async (input) => {
      calls.push(String(input));
      if (calls.length < 3) {
        return new Response('{"message":"Too many requests"}', {
          status: 429,
          headers: { 'x-ratelimit-reset': pastReset },
        });
      }
      return new Response('{}', { status: 200 });
    }, [], noSleep);

    const response = await client.request('/v1/projects/p/database/sql', { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('gives up after the retry budget instead of looping forever', async () => {
    let calls = 0;
    const client = new SupacloudClient('http://mgmt.local', 'token', async () => {
      calls += 1;
      return new Response('{"message":"Too many requests"}', { status: 429 });
    }, [], noSleep);

    await expect(client.request('/v1/projects/p/secrets', { method: 'POST', body: '[]' }))
      .rejects.toThrow('failed with 429');
    expect(calls).toBe(7);
  });
});
