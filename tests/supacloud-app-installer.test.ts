import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupacloudAppManifest } from '../scripts/supacloud-app-contract.js';
import { installSupacloudApp } from '../scripts/install-supacloud-app.js';

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'supauth-installer-'));
  const artifactDir = 'artifact';
  const adminDir = 'admin-build';
  const functionBundle = 'function/supacloud-function.js';
  const openapiPath = 'artifact/openapi.json';

  mkdirSync(join(root, 'function'), { recursive: true });
  mkdirSync(join(root, adminDir), { recursive: true });
  mkdirSync(join(root, artifactDir), { recursive: true });

  writeFileSync(join(root, functionBundle), 'export default { fetch() { return new Response("ok"); } };');
  writeFileSync(join(root, adminDir, 'index.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'authorize.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'claim.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'change-password.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'account.html'), '<!doctype html>');
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
};

const isolatedEnvKeys = [
  'SUPACLOUD_GATEWAY_ADMIN_TOKEN',
  'SUPACLOUD_ADMIN_TOKEN',
  'SUPAUTH_PUBLIC_URL',
  'AUTH_PUBLIC_URL',
  'SUPAUTH_INSTALLED_BASE_URL',
  'SUPAUTH_BASE_URL',
  'SUPAUTH_API_URL',
  'AUTH_API_URL',
  'CORS_ORIGINS',
  'SUPACLOUD_DATABASE_URL',
  'SUPABASE_DB_URL',
  'SUPAOAUTH_BFF_SIGNING_SECRET',
  'RUNTIME_MODE',
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

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([
      expect.objectContaining({ name: 'artifact-verification', status: 'done' }),
      expect.objectContaining({ name: 'migration', status: 'planned' }),
      expect.objectContaining({ name: 'migration-verification', status: 'planned' }),
      expect.objectContaining({ name: 'runtime-env', status: 'planned' }),
      expect.objectContaining({ name: 'function-deploy', status: 'planned' }),
      expect.objectContaining({ name: 'gateway-routes', status: 'skipped' }),
      expect.objectContaining({ name: 'direct-function-probe', status: 'planned' }),
    ]);
  });

  it('runs SupaCloud hosted migration before secrets and function deploy', async () => {
    const { root, artifactDir } = createFixture();
    const calls: string[] = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      migrationVerifier: async (databaseUrl) => {
        calls.push(`VERIFY ${databaseUrl}`);
        return {
          reachable: true,
          authorizeExists: true,
          hasPermissionExists: true,
          hasOrgPermissionExists: true,
          currentProjectClaimsExists: true,
          authorizeGranted: true,
          hasPermissionGranted: true,
          hasOrgPermissionGranted: true,
          currentProjectClaimsGranted: true,
          legacyWebhooksAbsent: true,
          legacyWebhookDeliveriesAbsent: true,
          unsafePolicies: [],
        };
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
          expect(body).toContainEqual({ name: 'SUPACLOUD_INTERNAL_API_URL', value: requiredOptions.supacloudApiUrl });
          expect(body).toContainEqual({ name: 'SUPACLOUD_INTERNAL_TOKEN', value: requiredOptions.token });
          expect(body).toContainEqual({ name: 'SUPAOAUTH_BFF_SIGNING_SECRET', value: requiredOptions.bffSigningSecret });
          expect(body.some((entry: { name: string }) => entry.name.startsWith('EDGEFN_'))).toBe(false);
          return new Response('{}', { status: 200 });
        }

        return new Response('{}', { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(calls[0]).toBe('POST /v1/projects/project_123/database/sql');
    expect(calls).toContain(`VERIFY ${requiredOptions.databaseUrl}`);
    expect(calls).toContain('POST /v1/projects/project_123/secrets');
    expect(calls.slice(-3)).toEqual([
      'POST /v1/projects/project_123/functions/supauth/bundle',
      'PATCH /v1/projects/project_123/functions/supauth/config',
      'GET /functions/v1/supauth/api/v1/health',
    ]);
    expect(calls.indexOf('POST /v1/projects/project_123/database/sql')).toBeLessThan(
      calls.indexOf(`VERIFY ${requiredOptions.databaseUrl}`),
    );
    expect(calls.indexOf(`VERIFY ${requiredOptions.databaseUrl}`)).toBeLessThan(
      calls.indexOf('POST /v1/projects/project_123/secrets'),
    );
    expect(calls).toEqual(expect.arrayContaining([
      'POST /v1/projects/project_123/database/sql',
      `VERIFY ${requiredOptions.databaseUrl}`,
      'POST /v1/projects/project_123/secrets',
      'POST /v1/projects/project_123/functions/supauth/bundle',
      'PATCH /v1/projects/project_123/functions/supauth/config',
      'GET /functions/v1/supauth/api/v1/health',
    ]));
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

  it('injects a center IdP OAuth authorization project ref when configured', async () => {
    const { root, artifactDir } = createFixture();
    const seenSecrets: Array<{ name: string; value: string }> = [];

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
          seenSecrets.push(...JSON.parse(String(init?.body)));
        }
        return new Response('{}', { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(seenSecrets).toContainEqual({
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
    ].join('\n'));

    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://stale-local-db';
    try {
      const seenSecrets: Array<{ name: string; value: string }> = [];
      const routeIds: string[] = [];
      const result = await installSupacloudApp({
        root,
        artifactDir,
        envFile,
        skipMigration: true,
        skipFunctionDeploy: true,
        skipDirectVerify: true,
        fetchImpl: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/v1/projects/project_from_file/secrets') {
            seenSecrets.push(...JSON.parse(String(init?.body)));
          }
          if (url.pathname === '/v1/projects/project_from_file/gateway/routes') {
            routeIds.push(JSON.parse(String(init?.body)).id);
          }
          return new Response('{}', { status: 200 });
        },
      });

      expect(result.ok).toBe(true);
      expect(result.projectRef).toBe('project_from_file');
      expect(seenSecrets).toContainEqual({ name: 'SUPACLOUD_DATABASE_URL', value: 'postgres://project-db' });
      expect(seenSecrets).toContainEqual({
        name: 'SUPAOAUTH_BFF_SIGNING_SECRET',
        value: 'file-bff-signing-secret-0123456789abcdef',
      });
      expect(seenSecrets).not.toContainEqual({ name: 'SUPACLOUD_DATABASE_URL', value: 'postgres://stale-local-db' });
      expect(seenSecrets).toContainEqual({
        name: 'CORS_ORIGINS',
        value: 'https://www.from-file.test,https://auth.from-file.test,https://auth-api.from-file.test',
      });
      expect(routeIds).toEqual(['supauth-function-hosted', 'supauth-api']);
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
        fetchImpl: async () => new Response(`rejected ${requiredOptions.bffSigningSecret}`, { status: 500 }),
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failureMessage).toContain('[REDACTED]');
    expect(failureMessage).not.toContain(requiredOptions.bffSigningSecret);
  });

  it('configures hosted gateway routes when an admin token and base URL are provided', async () => {
    const { root, artifactDir } = createFixture();
    const calls: Array<{ path: string; auth: string | null; body: any }> = [];

    const result = await installSupacloudApp({
      root,
      artifactDir,
      ...requiredOptions,
      gatewayAdminToken: 'admin-token',
      baseUrl: 'https://auth.example.test',
      edgeRuntimeUpstream: '127.0.0.1:9000',
      skipMigrationVerify: true,
      skipDirectVerify: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          path: url.pathname,
          auth: new Headers(init?.headers).get('authorization'),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response('{}', { status: 200 });
      },
    });

    const gatewayCalls = calls.filter((call) => call.path === '/v1/projects/project_123/gateway/routes');
    const gatewayCall = gatewayCalls[0];
    expect(result.ok).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({ name: 'gateway-routes', status: 'done' }));
    expect(gatewayCalls).toHaveLength(1);
    expect(gatewayCall?.auth).toBe('Bearer admin-token');
    expect(gatewayCall?.body).toMatchObject({
      id: 'supauth-function-hosted',
      hosts: ['auth.example.test'],
      upstream: '127.0.0.1:9000',
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100,
      cors: expect.arrayContaining(['https://auth.example.test']),
    });
    expect(gatewayCall?.body.path).toEqual(expect.arrayContaining(['/api/*', '/oauth/*', '/login.html', '/authorize.html', '/hosted-auth.js', '/account', '/account.html', '/claim.html', '/admin/*', '/']));
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
    expect(routeBodies).toHaveLength(2);
    expect(routeBodies[0]).toMatchObject({
      id: 'supauth-function-hosted',
      hosts: ['auth.example.test'],
      cors,
    });
    expect(routeBodies[1]).toMatchObject({
      id: 'supauth-api',
      hosts: ['auth-api.example.test'],
      path: ['/api/*', '/v1/*', '/v1/public/*', '/oauth/*', '/swagger*', '/'],
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 110,
      enabled: true,
      cors,
    });
    expect(routeBodies[1].path).not.toContain('/auth/v1/*');
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
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
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
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
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
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: false,
        legacyWebhooksAbsent: true,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('supaoauth.current_project_claims() is missing');
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
        authorizeGranted: true,
        hasPermissionGranted: true,
        hasOrgPermissionGranted: true,
        currentProjectClaimsGranted: true,
        legacyWebhooksAbsent: false,
        legacyWebhookDeliveriesAbsent: true,
        unsafePolicies: [],
      }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })).rejects.toThrow('reason_code=legacy_webhook_table_present: supaoauth.webhooks must be retired');
  });
});
