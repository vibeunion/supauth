import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonValueSchema, Type, decodeSchema, type JsonValue } from '../packages/shared/src/schema.js';
import {
  createAllocationJournal, loadAllocationProof, TEST_IDENTITY_OWNER_REF,
  type AllocationIntent, type AllocationProof,
} from '../scripts/real-contract-allocation.js';
import {
  createRealContractInstaller, installMigrationPlan, loadInstallArtifact,
  type InstallRequest, type InstallTransport,
} from '../scripts/real-contract-install.js';
import { createSupacloudAppManifest } from '../scripts/supacloud-app-contract.js';

const runId = '12345678-1234-4123-8123-123456789abc';
const projectRef = 'abcdefghijklmnopqrst';
const origin = `https://contract-${runId}.xai.xigu.team`;
const authorityOrigin = 'https://auth.xai.xigu.team';
const activation = '12345678-1234-4123-8123-123456789def';
const source = 'export default { fetch() { return new Response("fixture"); } };';
const runtimeSource = '// platform rebundle fixture\n' + source;
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
interface Fixture { proof: AllocationProof; root: string; inventorySha256: string }
async function fixture(action: (value: Fixture) => Promise<void>) {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'supauth-install-unit-')));
  try {
    await chmod(root, 0o700);
    const intent: AllocationIntent = {
      runId, name: `supauth-contract-${runId}`, managementOrigin: 'http://127.0.0.1:29190',
      projectOrigin: origin, authorityRef: TEST_IDENTITY_OWNER_REF, authorityOrigin,
      beforeInventory: { complete: true, projects: [{ ref: TEST_IDENTITY_OWNER_REF, name: 'owner' }] },
    };
    const journal = await createAllocationJournal(root, intent);
    const project = { id: 'test-only-id', created_at: '2026-09-09T00:00:00Z', ref: projectRef,
      name: intent.name, api: { url: origin }, status: 'ACTIVE_HEALTHY' };
    await journal.createOnce(async () => project);
    await journal.bind({
      projectReadback: project, authorityOrigin,
      authorityDescriptor: { project_ref: projectRef, mode: 'shared',
        authority_project_ref: TEST_IDENTITY_OWNER_REF, owner_project_ref: TEST_IDENTITY_OWNER_REF,
        local_gotrue_enabled: false, public_auth_route: 'owner_proxy',
        user_management: 'owner_only', configuration_management: 'owner_only' },
    });
    const proof = loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: join(root, runId) });
    if (!proof) throw new Error('UNIT_PROOF_MISSING');
    const bundle = 'artifacts/supacloud-app/function-bundle';
    const files: Record<string, string> = { 'index.ts': source };
    for (const name of ['index', 'authorize', 'claim', 'change-password', 'account', 'logout']) {
      files[`admin-console/build/${name}.html`] = '<!doctype html><title>fixture</title>';
    }
    for (const [path, content] of Object.entries(files)) {
      const segments = path.split('/');
      segments.pop();
      await mkdir(join(root, bundle, ...segments), { recursive: true });
      await writeFile(join(root, bundle, path), content);
    }
    const manifest = createSupacloudAppManifest({
      functionBundle: `${bundle}/index.ts`, adminStaticDir: `${bundle}/admin-console/build`,
      openapiPath: 'artifacts/supacloud-app/openapi.json',
    });
    await writeFile(join(root, 'artifacts/supacloud-app/supacloud-app-manifest.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'artifacts/supacloud-app/openapi.json'), JSON.stringify({ openapi: '3.0.3', paths: {} }));
    const inventory = Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([path, content]) => ({ path, bytes: Buffer.byteLength(content), sha256: hash(content) }));
    await action({ proof, root, inventorySha256: hash(JSON.stringify(inventory)) });
  } finally { await rm(root, { recursive: true, force: true }); }
}
function secrets() {
  const values: Record<string, string> = {
    SUPACLOUD_INTERNAL_API_URL: 'http://management.invalid:9090',
    SUPACLOUD_INTERNAL_TOKEN: 'fixture-scoped-token',
    SUPACLOUD_DATABASE_URL: `postgresql://role_${projectRef}:fixture-only@database.invalid/supa_${projectRef}`,
    SUPAOAUTH_BFF_SIGNING_SECRET: 'fixture-only-bff-secret-not-a-real-credential',
    PROJECT_REF: projectRef, SUPACLOUD_AUTH_AUTHORITY_REF: TEST_IDENTITY_OWNER_REF,
    OAUTH_RUNTIME_URL: authorityOrigin, OAUTH_RUNTIME_INTERNAL_URL: authorityOrigin,
    SUPAUTH_PUBLIC_URL: origin, ADMIN_AUTH_MODE: 'sso',
    ADMIN_SSO_ISSUER: `${authorityOrigin}/auth/v1`, ADMIN_SSO_CLIENT_ID: 'fixture-client',
    ADMIN_SSO_REDIRECT_URI: `${origin}/admin`, ADMIN_SSO_POST_LOGOUT_REDIRECT_URI: `${origin}/admin/login`,
    ADMIN_SSO_ALLOWED_EMAILS: 'fixture-admin@example.invalid', ADMIN_SSO_ALLOWED_DOMAINS: '',
    ADMIN_SSO_REQUIRE_AAL2: 'true', CORS_ORIGINS: origin,
  };
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}
const RequestMigrationSchema = Type.Object({ version: Type.String(), name: Type.String(), sql: Type.String() });
const MockRouteSchema = Type.Object({ id: Type.String() });
type ResponseValue = Awaited<ReturnType<InstallTransport>>;
type Mutation = ReturnType<typeof installMigrationPlan>[number];
function mockPlatform() {
  const requests: InstallRequest[] = [];
  const claims = new Set<string>();
  const migrations: Mutation[] = [];
  let deployed = false;
  let storedNames: string[] = [];
  const routes: JsonValue[] = [];
  const catalog = {
    database_name: `supa_${projectRef}`, database_role: `role_${projectRef}`,
    role_super: false, role_bypass_rls: true, auth_users: true, auth_jwt: true,
    overlay: true, resource_unique: true, scope_unique: true, scope_fk: true,
    claim_constraint: true, runtime_constraint: true,
  };
  const state: {
    alter?: (request: InstallRequest, response: ResponseValue) => ResponseValue;
    before?: (request: InstallRequest) => Promise<void>;
  } = {};
  const ledger = () => migrations.map(row => ({
    version: row.version, name: row.name, statements: row.statements,
    checksum: row.checksum, statement_count: 1, applied_at: '2026-09-09T00:00:00Z',
  }));
  const transport: InstallTransport = async request => {
    requests.push(request);
    await state.before?.(request);
    if (!request.path.startsWith(`/v1/projects/${projectRef}/`)) throw new Error('UNIT_WRONG_TARGET');
    const path = request.path.slice(`/v1/projects/${projectRef}`.length);
    let body: unknown;
    if (path === '/database/migrations') {
      if (request.method === 'GET') body = ledger();
      else {
        const sent = decodeSchema(RequestMigrationSchema, request.body);
        const expected = installMigrationPlan().find(row => row.version === sent.version);
        if (!expected || expected.sql !== sent.sql || expected.name !== sent.name) throw new Error('UNIT_BAD_SQL');
        migrations.push(expected);
        body = { version: expected.version, name: expected.name, statements: expected.statements,
          checksum: expected.checksum, stripped_transaction_statements: 0 };
      }
    } else if (path === '/database/sql') {
      body = { rows: [{ ...catalog }], rowCount: 1, command: 'SELECT' };
    } else if (path === '/functions/supauth/secrets') {
      if (request.method === 'POST') {
        storedNames = decodeSchema(Type.Array(Type.Object({ name: Type.String(), value: Type.String() })), request.body)
          .map(row => `EDGEFN_SUPAUTH_${row.name}`);
        body = {};
      } else body = storedNames.map(name => ({ name, value: '********' }));
    } else if (path === '/functions') {
      body = deployed ? [{ slug: 'supauth', version: 1, activation_id: activation, verify_jwt: false }] : [];
    } else if (path === '/functions/supauth/bundle') {
      deployed = true;
      body = { success: true, project_ref: projectRef, slug: 'supauth', version: '1', active_version: '1',
        activation_id: activation, bundle_hash: hash(runtimeSource).slice(0, 16), preheat: { ok: true }, verify_jwt: false };
    } else if (path === '/functions/supauth/source') {
      body = { code: source };
    } else if (path === '/functions/supauth/versions/1') {
      body = { version: '1', is_active: true, source_code: source, bundle_code: runtimeSource };
    } else if (path === '/gateway/routes') {
      if (request.method === 'POST') {
        const route = decodeSchema(JsonValueSchema, request.body);
        decodeSchema(MockRouteSchema, route);
        routes.push(route);
        body = { success: true, route };
      } else body = { routes: [...routes] };
    } else throw new Error('UNIT_UNEXPECTED_REQUEST');
    const response = { status: 200, body };
    return state.alter ? state.alter(request, response) : response;
  };
  return {
    requests, claims, migrations, catalog, state, routes, transport,
    claimMutation: async (key: string) => {
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
  };
}
function create(proof: AllocationProof, platform: ReturnType<typeof mockPlatform>) {
  return createRealContractInstaller({ allocation: proof, transport: platform.transport, claimMutation: platform.claimMutation });
}
async function prepare(installer: ReturnType<typeof create>) {
  expect((await installer.migrations()).status).toBe('passed');
  expect((await installer.catalog()).status).toBe('passed');
}
async function prepareDeploy(installer: ReturnType<typeof create>) {
  await prepare(installer);
  expect((await installer.secrets(secrets())).status).toBe('passed');
}

describe('API-only install safety with local simulated transport, not live acceptance', () => {
  test('16 explicit versions use the official normalized structured checksum', () => {
    const plan = installMigrationPlan();
    expect(plan.map(row => row.version)).toEqual(['1', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18']);
    for (const row of plan) {
      expect(row.checksum).toBe(hash(JSON.stringify({
        version: row.version, name: row.name, statements: [row.sql.replace(/\r\n?/g, '\n').trim()],
      })));
    }
  });
  test('rejects unbranded proof copies before any request', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    expect(() => create({ ...proof }, platform)).toThrow('INSTALL_ALLOCATION_INVALID');
    expect(platform.requests).toHaveLength(0);
  }));
  test('migrations/catalog verify API envelopes and honestly record BYPASSRLS', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    expect(await installer.migrations()).toMatchObject({ status: 'passed', checks: 16 });
    expect(await installer.catalog()).toMatchObject({ status: 'passed', roleBypassRls: true });
    expect(platform.claims.size).toBe(16);
    expect(platform.requests.filter(row => row.path.endsWith('/database/migrations') && row.method === 'POST')).toHaveLength(16);
    const catalog = platform.requests.find(row => row.path.endsWith('/database/sql'));
    expect(decodeSchema(Type.Object({ mode: Type.Literal('read') }), catalog?.body).mode).toBe('read');
    expect(JSON.stringify(platform.requests)).not.toContain('/auth/users');
  }));
  test('verified existing ledger resumes without replay', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    platform.migrations.push(...installMigrationPlan());
    expect((await create(proof, platform).migrations()).status).toBe('passed');
    expect(platform.claims.size).toBe(0);
    expect(platform.requests).toHaveLength(1);
  }));
  test('conflicting ledger rejects before writes', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    const first = installMigrationPlan()[0];
    if (!first) throw new Error('UNIT_NO_MIGRATION');
    platform.migrations.push({ ...first, checksum: '0'.repeat(64) });
    expect(await create(proof, platform).migrations()).toMatchObject({ status: 'failed', code: 'INSTALL_LEDGER_CONFLICT' });
    expect(platform.claims.size).toBe(0);
  }));
  test('final ledger catches an earlier migration changed during later writes', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    platform.state.before = async request => {
      if (request.method === 'GET' && platform.migrations.length === 16) {
        const first = platform.migrations[0];
        if (first) platform.migrations[0] = { ...first, checksum: '0'.repeat(64) };
      }
    };
    expect(await create(proof, platform).migrations()).toMatchObject({ status: 'unknown', code: 'INSTALL_LEDGER_MISMATCH' });
  }));
  test('credential-bearing unknown mutation is sanitized, cannot retry or advance', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    platform.state.before = async request => {
      if (request.method === 'POST') throw new Error('postgres://secret:password@private');
    };
    const installer = create(proof, platform);
    const result = await installer.migrations();
    expect(result.status).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('password');
    expect((await installer.migrations()).status).toBe('blocked');
    expect((await installer.catalog()).status).toBe('blocked');
    expect(platform.requests.filter(row => row.method === 'POST')).toHaveLength(1);
    expect((await create(proof, platform).migrations()).status).toBe('blocked');
    expect(platform.requests.filter(row => row.method === 'POST')).toHaveLength(1);
  }));
  test('invalid success receipt and HTTP conflicts never trigger write replay', async () => fixture(async ({ proof }) => {
    for (const status of [200, 409, 503]) {
      const platform = mockPlatform();
      platform.state.alter = (request, response) => request.method === 'POST'
        ? { status, body: { secret: 'must-not-leak' } } : response;
      expect((await create(proof, platform).migrations()).status).toBe('unknown');
      expect(platform.requests.filter(row => row.method === 'POST')).toHaveLength(1);
    }
  }));
  test('catalog rejects wrong role and broken constraints, gates secrets', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    platform.catalog.scope_fk = false;
    const installer = create(proof, platform);
    expect((await installer.migrations()).status).toBe('passed');
    expect((await installer.catalog()).status).toBe('failed');
    expect((await installer.secrets(secrets())).status).toBe('blocked');
    expect(platform.requests.some(row => row.path.includes('/functions'))).toBe(false);
  }));
  test('stages cannot skip prerequisites', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    expect((await installer.catalog()).status).toBe('blocked');
    expect((await installer.secrets(secrets())).status).toBe('blocked');
    expect((await installer.routes()).status).toBe('blocked');
    expect(platform.requests).toHaveLength(0);
  }));
  test('missing platform-managed runtime delivery blocks without secret POST', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    await prepare(installer);
    expect(await installer.secrets(undefined)).toMatchObject({ status: 'blocked', code: 'INSTALL_PLATFORM_SECRETS_UNAVAILABLE' });
    expect((await installer.secrets(secrets().filter(row => row.name !== 'SUPACLOUD_DATABASE_URL'))).status).toBe('blocked');
    expect(platform.requests.some(row => row.path.includes('/secrets'))).toBe(false);
  }));
  test('rejects master key, wrong DB, owner project and malformed schema before send', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    await prepare(installer);
    for (const input of [
      [...secrets(), { name: 'SUPACLOUD_MASTER_TOKEN', value: 'forbidden' }],
      secrets().map(row => row.name === 'PROJECT_REF' ? { ...row, value: TEST_IDENTITY_OWNER_REF } : row),
      secrets().map(row => row.name === 'SUPACLOUD_DATABASE_URL' ? { ...row, value: 'invalid-secret-url' } : row),
      secrets().map(row => row.name === 'ADMIN_SSO_ALLOWED_DOMAINS' ? { ...row, value: 'example.invalid' } : row),
      [{ name: 'ADMIN_SSO_CLIENT_ID', value: 1 }],
    ]) expect((await installer.secrets(input)).status).toBe('failed');
    expect(platform.requests.some(row => row.path.includes('/secrets'))).toBe(false);
  }));
  test('artifact verifier rejects incorrect hash and symlink', async () => fixture(async ({ root, inventorySha256 }) => {
    expect(() => loadInstallArtifact(root, '0'.repeat(64))).toThrow('INSTALL_ARTIFACT_INVALID');
    expect(loadInstallArtifact(root, inventorySha256).sourceSha256).toBe(hash(source));
    await symlink(join(root, 'artifacts/supacloud-app/openapi.json'), join(root, 'artifacts/supacloud-app/function-bundle/link'));
    expect(() => loadInstallArtifact(root, inventorySha256)).toThrow('INSTALL_ARTIFACT_INVALID');
  }));
  test('full staged flow binds source/runtime hashes and only new managed routes', async () => fixture(async ({ proof, root, inventorySha256 }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    await prepareDeploy(installer);
    const artifact = loadInstallArtifact(root, inventorySha256);
    expect(await installer.deploy(artifact)).toMatchObject({
      status: 'passed', sourceSha256: hash(source), runtimeSha256: hash(runtimeSource), activationId: activation,
    });
    expect(await installer.routes()).toMatchObject({ status: 'passed', checks: 4 });
    const bundle = platform.requests.find(row => row.path.endsWith('/bundle'));
    expect(bundle?.body).toMatchObject({ expected_active_version: 'absent', expected_activation_id: 'legacy', verify_jwt: false });
    const routeWrites = platform.requests.filter(row => row.path.endsWith('/gateway/routes') && row.method === 'POST');
    expect(routeWrites).toHaveLength(4);
    for (const request of routeWrites) {
      expect(request.body).toMatchObject({ hosts: [new URL(origin).hostname], managed_upstream: 'edge-functions' });
    }
    expect(platform.requests.every(row => row.path.startsWith(`/v1/projects/${projectRef}/`))).toBe(true);
    expect(JSON.stringify(platform.requests.filter(row => row.path.includes('/gateway/')))).not.toContain(authorityOrigin);
  }));
  test('loaded artifact is immutable despite subsequent disk changes', async () => fixture(async ({ proof, root, inventorySha256 }) => {
    const artifact = loadInstallArtifact(root, inventorySha256);
    await writeFile(join(root, 'artifacts/supacloud-app/function-bundle/index.ts'), 'tampered');
    const platform = mockPlatform();
    const installer = create(proof, platform);
    await prepareDeploy(installer);
    expect((await installer.deploy(artifact)).status).toBe('passed');
    expect(platform.requests.find(row => row.path.endsWith('/bundle'))?.body).toMatchObject({ files: { 'index.ts': source } });
  }));
  test('forged artifact cannot enter deploy', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    await prepareDeploy(installer);
    expect((await installer.deploy({ inventorySha256: '0'.repeat(64), sourceSha256: '0'.repeat(64), fileCount: 1 })).status).toBe('failed');
    expect(platform.requests.some(row => row.path.endsWith('/bundle'))).toBe(false);
  }));
  test('source drift, activation drift and unready preheat fail closed after one bundle', async () => fixture(async ({ proof, root, inventorySha256 }) => {
    const artifact = loadInstallArtifact(root, inventorySha256);
    for (const mode of ['source', 'activation', 'preheat']) {
      const platform = mockPlatform();
      const installer = create(proof, platform);
      await prepareDeploy(installer);
      platform.state.alter = (request, response) => {
        if (mode === 'source' && request.path.endsWith('/source')) return { status: 200, body: { code: 'wrong' } };
        if (mode === 'activation' && request.path.endsWith('/functions') && platform.requests.some(row => row.path.endsWith('/bundle'))) {
          return { status: 200, body: [{ slug: 'supauth', version: 2, activation_id: activation, verify_jwt: false }] };
        }
        if (mode === 'preheat' && request.path.endsWith('/bundle')) return { status: 200, body: { preheat: { ok: false } } };
        return response;
      };
      expect((await installer.deploy(artifact)).status).toBe('unknown');
      expect((await installer.routes()).status).toBe('blocked');
      expect(platform.requests.filter(row => row.path.endsWith('/bundle'))).toHaveLength(1);
    }
  }));
  test('route readback detects missing routes after write, no retry', async () => fixture(async ({ proof, root, inventorySha256 }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    await prepareDeploy(installer);
    expect((await installer.deploy(loadInstallArtifact(root, inventorySha256))).status).toBe('passed');
    platform.state.alter = (request, response) => request.method === 'GET' && request.path.endsWith('/gateway/routes')
      ? { status: 200, body: { routes: [] } } : response;
    expect((await installer.routes()).status).toBe('unknown');
    expect((await installer.routes()).status).toBe('blocked');
    expect(platform.requests.filter(row => row.path.endsWith('/gateway/routes') && row.method === 'POST')).toHaveLength(4);
  }));
  test('concurrent same-stage call cannot send twice', async () => fixture(async ({ proof }) => {
    const platform = mockPlatform();
    const installer = create(proof, platform);
    const results = await Promise.all([installer.migrations(), installer.migrations()]);
    expect(results.map(row => row.status).sort()).toEqual(['blocked', 'passed']);
    expect(platform.claims.size).toBe(16);
  }));
});
