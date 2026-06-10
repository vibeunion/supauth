import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
  runtimeUrl: 'https://project.example.test',
  databaseUrl: 'postgres://secret-db',
};

describe('SupaCloud app installer', () => {
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
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${init?.method || 'GET'} ${url.pathname}`);

        if (url.pathname === '/functions/v1/supauth/api/v1/health') {
          return new Response('ok', { status: 200 });
        }

        if (url.pathname === '/v1/projects/project_123/database/migrations') {
          const body = JSON.parse(String(init?.body));
          if (body.name === 'supauth-overlay-schema') {
            expect(body.sql).toContain('CREATE SCHEMA IF NOT EXISTS supaoauth');
          } else {
            expect(body.name).toBe('supauth-overlay-project-role-grants');
            expect(body.sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA supaoauth');
          }
          return new Response(JSON.stringify({ version: 123, name: body.name }), { status: 200 });
        }

        if (url.pathname === '/v1/projects/project_123/secrets') {
          const body = JSON.parse(String(init?.body));
          expect(body).toContainEqual({ name: 'SUPACLOUD_INTERNAL_API_URL', value: requiredOptions.supacloudApiUrl });
          expect(body).toContainEqual({ name: 'SUPACLOUD_INTERNAL_TOKEN', value: requiredOptions.token });
          expect(body.some((entry: { name: string }) => entry.name.startsWith('EDGEFN_'))).toBe(false);
          return new Response('{}', { status: 200 });
        }

        return new Response('{}', { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'POST /v1/projects/project_123/database/migrations',
      'POST /v1/projects/project_123/database/migrations',
      'POST /v1/projects/project_123/secrets',
      'POST /v1/projects/project_123/functions/supauth/bundle',
      'PATCH /v1/projects/project_123/functions/supauth/config',
      'GET /functions/v1/supauth/api/v1/health',
    ]);
  });

  it('prefers SupaCloud env-file values and refuses stale generic DATABASE_URL for function DB', async () => {
    const { root, artifactDir } = createFixture();
    const envFile = join(root, 'project.env');
    writeFileSync(envFile, [
      'SUPACLOUD_API_URL=https://api.from-file.test',
      'SUPACLOUD_PROJECT_REF=project_from_file',
      'SUPACLOUD_API_TOKEN=file-token',
      'SUPACLOUD_RUNTIME_URL=https://runtime.from-file.test',
      'SUPACLOUD_DATABASE_URL=postgres://project-db',
    ].join('\n'));

    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://stale-local-db';
    try {
      const seenSecrets: Array<{ name: string; value: string }> = [];
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
          return new Response('{}', { status: 200 });
        },
      });

      expect(result.ok).toBe(true);
      expect(result.projectRef).toBe('project_from_file');
      expect(seenSecrets).toContainEqual({ name: 'SUPACLOUD_DATABASE_URL', value: 'postgres://project-db' });
      expect(seenSecrets).not.toContainEqual({ name: 'SUPACLOUD_DATABASE_URL', value: 'postgres://stale-local-db' });
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

    const gatewayCall = calls.find((call) => call.path === '/v1/projects/project_123/gateway/routes');
    expect(result.ok).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({ name: 'gateway-routes', status: 'done' }));
    expect(gatewayCall?.auth).toBe('Bearer admin-token');
    expect(gatewayCall?.body).toMatchObject({
      id: 'supauth-function-hosted',
      hosts: ['auth.example.test'],
      upstream: '127.0.0.1:9000',
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100,
    });
    expect(gatewayCall?.body.path).toEqual(expect.arrayContaining(['/api/*', '/oauth/*', '/claim.html', '/']));
  });
});
