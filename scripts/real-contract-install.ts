import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  JsonValueSchema, Type, decodeSchema, type JsonValue, type Static, type TSchema,
} from '../packages/shared/src/schema.js';
import { HOSTED_MIGRATIONS } from '../packages/auth-server/src/db/migrate.js';
import { allocationProofDetails, type AllocationProof } from './real-contract-allocation.js';
import { SUPAUTH_CUSTOM_UI_FALLBACK_ROUTE } from './supacloud-app-contract.js';
import { verifySupacloudAppArtifact } from './verify-supacloud-app-artifact.js';

const ShaSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
const VersionSchema = Type.String({ pattern: '^[1-9][0-9]{0,18}$' });
const ActivationSchema = Type.String({
  pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
});
const LedgerRowSchema = Type.Object({
  version: VersionSchema, name: Type.String(), statements: Type.Array(Type.String()),
  checksum: ShaSchema, statement_count: Type.Integer({ minimum: 1 }),
  applied_at: Type.String({ minLength: 1 }),
});
const MigrationReceiptSchema = Type.Object({
  version: VersionSchema, name: Type.String(), statements: Type.Array(Type.String()),
  checksum: ShaSchema, stripped_transaction_statements: Type.Integer({ minimum: 0 }),
});
const ResponseSchema = Type.Object({
  status: Type.Integer({ minimum: 100, maximum: 599 }), body: JsonValueSchema,
});
const SecretSchema = Type.Object({
  name: Type.String({ pattern: '^[A-Z][A-Z0-9_]*$' }),
  value: Type.String({ maxLength: 16_384 }),
}, { additionalProperties: false });
const SecretsSchema = Type.Array(SecretSchema, { minItems: 1, maxItems: 32 });
const FunctionSchema = Type.Object({
  slug: Type.String(), version: Type.Union([
    Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), Type.Null(),
  ]),
  activation_id: Type.Optional(ActivationSchema), verify_jwt: Type.Optional(Type.Boolean()),
});
const DeployReceiptSchema = Type.Object({
  success: Type.Literal(true), project_ref: Type.String(), slug: Type.Literal('supauth'),
  version: VersionSchema, active_version: VersionSchema, activation_id: ActivationSchema,
  bundle_hash: Type.String({ pattern: '^[a-f0-9]{16}$' }), verify_jwt: Type.Literal(false),
  preheat: Type.Object({ ok: Type.Literal(true) }),
});
const VersionDetailSchema = Type.Object({
  version: VersionSchema, is_active: Type.Literal(true),
  source_code: Type.String(), bundle_code: Type.String(),
});
const RouteSchema = Type.Object({
  id: Type.String(), hosts: Type.Array(Type.String()),
  path: Type.Union([Type.String(), Type.Array(Type.String())]),
  managed_upstream: Type.Optional(Type.String()), rewrite_uri: Type.Optional(Type.String()),
  priority: Type.Optional(Type.Number()), enabled: Type.Optional(Type.Boolean()),
  cors: Type.Optional(Type.Array(Type.String())),
});
const RoutesSchema = Type.Object({ routes: Type.Array(RouteSchema) });

export type InstallStage = 'migrations' | 'catalog' | 'secrets' | 'deploy' | 'routes';
export interface InstallResult {
  stage: InstallStage;
  status: 'passed' | 'failed' | 'blocked' | 'unknown';
  code: string;
  checks: number;
  roleBypassRls?: boolean;
  version?: string;
  activationId?: string;
  sourceSha256?: string;
  runtimeSha256?: string;
}
export interface InstallRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: JsonValue;
}
export type InstallTransport = (request: InstallRequest) => Promise<{ status: number; body: unknown }>;
export interface InstallOptions {
  allocation: AllocationProof;
  transport: InstallTransport;
  // 主线程须先持久化独占占位；跨进程重复占位返回 false，不能只使用内存 Set。
  claimMutation(key: string): Promise<boolean>;
}
class InstallError extends Error {
  constructor(readonly code: string, readonly blocked = false) { super(code); }
}
function fail(code: string): never { throw new InstallError(code); }
function parse<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try { return decodeSchema(schema, value); } catch { return fail('INSTALL_SCHEMA_INVALID'); }
}
function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function normalized(statement: string): string { return statement.replace(/\r\n?/g, '\n').trim(); }
export function installMigrationPlan() {
  if (HOSTED_MIGRATIONS.length !== 16) fail('INSTALL_MIGRATION_SOURCE_CHANGED');
  const versions = ['1', ...Array.from({ length: 15 }, (_, index) => String(index + 4))];
  return HOSTED_MIGRATIONS.map((migration, index) => {
    const version = versions[index];
    if (!version || !migration.name.endsWith(`-v${version}`)) fail('INSTALL_MIGRATION_SOURCE_CHANGED');
    const statements = [migration.sql.trim()];
    // 与平台 migration-promotion 的 JSON 字段顺序及换行规范化保持一致。
    const checksum = hash(JSON.stringify({
      version, name: migration.name.trim(), statements: statements.map(normalized),
    }));
    return { version, name: migration.name, sql: migration.sql, statements, checksum };
  });
}
type Migration = ReturnType<typeof installMigrationPlan>[number];
function matchesMigration(row: Static<typeof MigrationReceiptSchema> | Static<typeof LedgerRowSchema>, migration: Migration) {
  return row.version === migration.version && row.name === migration.name
    && row.checksum === migration.checksum
    && JSON.stringify(row.statements.map(normalized)) === JSON.stringify(migration.statements.map(normalized));
}

export interface InstallArtifact {
  readonly inventorySha256: string;
  readonly sourceSha256: string;
  readonly fileCount: number;
}
const artifacts = new WeakMap<InstallArtifact, Readonly<Record<string, string>>>();
export function loadInstallArtifact(root: string, expectedInventorySha256: string): InstallArtifact {
  try {
    parse(ShaSchema, expectedInventorySha256);
    if (!isAbsolute(root) || realpathSync(root) !== resolve(root)) fail('INSTALL_ARTIFACT_INVALID');
    const directory = join(root, 'artifacts/supacloud-app/function-bundle');
    for (const path of ['artifacts', 'artifacts/supacloud-app', 'artifacts/supacloud-app/function-bundle']) {
      if (lstatSync(join(root, path)).isSymbolicLink()) fail('INSTALL_ARTIFACT_INVALID');
    }
    const files: Record<string, string> = {};
    const inventory: Array<{ path: string; bytes: number; sha256: string }> = [];
    function walk(path: string): void {
      for (const name of readdirSync(path).sort()) {
        const file = join(path, name);
        const info = lstatSync(file);
        if (info.isSymbolicLink()) fail('INSTALL_ARTIFACT_INVALID');
        if (info.isDirectory()) { walk(file); continue; }
        if (!info.isFile()) fail('INSTALL_ARTIFACT_INVALID');
        const key = relative(directory, file).split('\\').join('/');
        if (key !== 'index.ts' && !key.startsWith('admin-console/build/')) fail('INSTALL_ARTIFACT_INVALID');
        const bytes = readFileSync(file);
        if (bytes.includes(0)) fail('INSTALL_ARTIFACT_INVALID');
        files[key] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        inventory.push({ path: key, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
    walk(directory);
    if (hash(JSON.stringify(inventory)) !== expectedInventorySha256
      || !verifySupacloudAppArtifact({ root }).ok) fail('INSTALL_ARTIFACT_INVALID');
    const source = files['index.ts'];
    if (!source || !files['admin-console/build/index.html']) fail('INSTALL_ARTIFACT_INVALID');
    const artifact = Object.freeze({
      inventorySha256: expectedInventorySha256, sourceSha256: hash(source), fileCount: inventory.length,
    });
    artifacts.set(artifact, Object.freeze(files));
    return artifact;
  } catch { return fail('INSTALL_ARTIFACT_INVALID'); }
}

const CatalogRowSchema = Type.Object({
  database_name: Type.String(), database_role: Type.String(),
  role_super: Type.Boolean(), role_bypass_rls: Type.Boolean(),
  auth_users: Type.Boolean(), auth_jwt: Type.Boolean(), overlay: Type.Boolean(),
  resource_unique: Type.Boolean(), scope_unique: Type.Boolean(), scope_fk: Type.Boolean(),
  claim_constraint: Type.Boolean(), runtime_constraint: Type.Boolean(),
});
// 仅目录 SELECT；安装不直连数据库，也不改变现有 overlay 的运行时数据库架构。
export const INSTALL_CATALOG_SQL = `
SELECT current_database() AS database_name, current_user AS database_role,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS role_super,
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS role_bypass_rls,
  to_regclass('auth.users') IS NOT NULL AS auth_users,
  to_regprocedure('auth.jwt()') IS NOT NULL AS auth_jwt,
  to_regclass('supaoauth.security_config') IS NOT NULL AS overlay,
  EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('supaoauth.uq_api_resources_indicator')
    AND i.indrelid = to_regclass('supaoauth.api_resources') AND i.indisunique AND i.indisvalid
    AND pg_get_indexdef(i.indexrelid, 1, true) = 'indicator' AND i.indnkeyatts = 1) AS resource_unique,
  EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('supaoauth.uq_scopes_resource_name')
    AND i.indrelid = to_regclass('supaoauth.scopes') AND i.indisunique AND i.indisvalid
    AND pg_get_indexdef(i.indexrelid, 1, true) = 'resource_id'
    AND pg_get_indexdef(i.indexrelid, 2, true) = 'name' AND i.indnkeyatts = 2) AS scope_unique,
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('supaoauth.scopes')
    AND c.confrelid = to_regclass('supaoauth.api_resources') AND c.contype = 'f'
    AND c.confdeltype = 'c' AND c.convalidated
    AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (resource_id) REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE') AS scope_fk,
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('supaoauth.account_provisioning_records')
    AND c.conname = 'account_provisioning_claim_state_check' AND c.contype = 'c' AND c.convalidated) AS claim_constraint,
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('supaoauth.connectors')
    AND c.conname = 'connectors_runtime_kind_check' AND c.contype = 'c' AND c.convalidated) AS runtime_constraint
`;

const requiredSecrets = [
  'SUPACLOUD_INTERNAL_API_URL', 'SUPACLOUD_INTERNAL_TOKEN', 'SUPACLOUD_DATABASE_URL',
  'SUPAOAUTH_BFF_SIGNING_SECRET', 'PROJECT_REF', 'SUPACLOUD_AUTH_AUTHORITY_REF',
  'OAUTH_RUNTIME_URL', 'OAUTH_RUNTIME_INTERNAL_URL', 'SUPAUTH_PUBLIC_URL',
  'ADMIN_AUTH_MODE', 'ADMIN_SSO_ISSUER', 'ADMIN_SSO_CLIENT_ID', 'ADMIN_SSO_REDIRECT_URI',
  'ADMIN_SSO_POST_LOGOUT_REDIRECT_URI', 'ADMIN_SSO_ALLOWED_EMAILS',
  'ADMIN_SSO_ALLOWED_DOMAINS', 'ADMIN_SSO_REQUIRE_AAL2', 'CORS_ORIGINS',
];
const allowedSecrets = new Set([...requiredSecrets, 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_SSO_JWKS_URI', 'ADMIN_SSO_AUDIENCE']);
function runtimeSecrets(value: unknown, allocation: AllocationProof) {
  if (value === undefined || value === null) {
    throw new InstallError('INSTALL_PLATFORM_SECRETS_UNAVAILABLE', true);
  }
  const secrets = parse(SecretsSchema, value);
  const values = new Map(secrets.map(secret => [secret.name, secret.value]));
  if (values.size !== secrets.length || secrets.some(secret => !allowedSecrets.has(secret.name))) {
    fail('INSTALL_SECRETS_INVALID');
  }
  if (requiredSecrets.some(name => !values.has(name)
    || (name !== 'ADMIN_SSO_ALLOWED_DOMAINS' && !values.get(name)?.trim()))) {
    throw new InstallError('INSTALL_PLATFORM_SECRETS_UNAVAILABLE', true);
  }
  if (values.get('PROJECT_REF') !== allocation.projectRef
    || values.get('SUPACLOUD_AUTH_AUTHORITY_REF') !== allocation.authorityRef
    || values.get('SUPAUTH_PUBLIC_URL') !== allocation.projectOrigin
    || values.get('ADMIN_AUTH_MODE') !== 'sso'
    || values.get('ADMIN_SSO_REDIRECT_URI') !== `${allocation.projectOrigin}/admin`
    || values.get('ADMIN_SSO_POST_LOGOUT_REDIRECT_URI') !== `${allocation.projectOrigin}/admin/login`
    || values.get('CORS_ORIGINS') !== allocation.projectOrigin
    || values.get('ADMIN_SSO_ALLOWED_DOMAINS') !== ''
    || !['true', 'false'].includes(values.get('ADMIN_SSO_REQUIRE_AAL2') ?? '')
    || values.get('OAUTH_RUNTIME_URL') !== allocation.authorityOrigin
    || values.get('OAUTH_RUNTIME_INTERNAL_URL') !== allocation.authorityOrigin
    || values.get('ADMIN_SSO_ISSUER') !== `${allocation.authorityOrigin}/auth/v1`) {
    fail('INSTALL_SECRETS_INVALID');
  }
  const email = values.get('ADMIN_SSO_ALLOWED_EMAILS') ?? '';
  if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email)) fail('INSTALL_SECRETS_INVALID');
  const secret = values.get('SUPAOAUTH_BFF_SIGNING_SECRET') ?? '';
  if (secret.length < 32 || secret === values.get('SUPACLOUD_INTERNAL_TOKEN')) fail('INSTALL_SECRETS_INVALID');
  for (const key of requiredSecrets) {
    if (key !== 'ADMIN_SSO_ALLOWED_DOMAINS' && !values.get(key)?.trim()) fail('INSTALL_SECRETS_INVALID');
  }
  try {
    const db = new URL(values.get('SUPACLOUD_DATABASE_URL') ?? '');
    if (!['postgres:', 'postgresql:'].includes(db.protocol)
      || db.pathname !== `/supa_${allocation.projectRef}`
      || decodeURIComponent(db.username) !== `role_${allocation.projectRef}`) fail('INSTALL_SECRETS_INVALID');
    const api = new URL(values.get('SUPACLOUD_INTERNAL_API_URL') ?? '');
    if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash) {
      fail('INSTALL_SECRETS_INVALID');
    }
    const jwks = values.get('ADMIN_SSO_JWKS_URI');
    if (jwks !== undefined && jwks !== `${allocation.authorityOrigin}/auth/v1/.well-known/jwks.json`) {
      fail('INSTALL_SECRETS_INVALID');
    }
  } catch { return fail('INSTALL_SECRETS_INVALID'); }
  return secrets.map(secret => ({ ...secret }));
}

const hostedPaths = [
  '/api/*', '/v1/*', '/v1/public/*', '/oauth/*', '/login', '/login.html', '/authorize.html',
  '/hosted-auth.js', '/account', '/account.html', '/account/*', '/change-password',
  '/change-password.html', '/claim', '/claim.html', '/favicon.ico', '/favicon.svg',
  '/admin/api/*', '/admin/*', '/',
];
function routePlan(allocation: AllocationProof) {
  return [hostedPaths, ['/logout', '/logout.html'], ['/admin'], [SUPAUTH_CUSTOM_UI_FALLBACK_ROUTE]]
    .map((path, index) => ({
      id: `contract-${allocation.runId}-${index}`, hosts: [new URL(allocation.projectOrigin).hostname],
      path: [...path], managed_upstream: 'edge-functions', rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100, enabled: true, cors: [allocation.projectOrigin],
    }));
}
function routeMatches(actual: Static<typeof RouteSchema>, expected: ReturnType<typeof routePlan>[number]) {
  return actual.id === expected.id && JSON.stringify(actual.hosts) === JSON.stringify(expected.hosts)
    && JSON.stringify(actual.path) === JSON.stringify(expected.path)
    && actual.managed_upstream === expected.managed_upstream && actual.rewrite_uri === expected.rewrite_uri
    && actual.priority === expected.priority && actual.enabled === expected.enabled
    && JSON.stringify(actual.cors) === JSON.stringify(expected.cors);
}

export function createRealContractInstaller(options: InstallOptions) {
  const allocation = allocationProofDetails(options.allocation) ?? fail('INSTALL_ALLOCATION_INVALID');
  const projectPath = `/v1/projects/${allocation.projectRef}`;
  const transport = options.transport;
  const claimMutation = options.claimMutation;
  const complete = new Set<InstallStage>();
  let busy = false;
  let halted = false;
  let sent = false;
  async function request(method: 'GET' | 'POST', suffix: string, body?: JsonValue, mutationKey?: string) {
    if (mutationKey !== undefined) {
      if (!await claimMutation(`${allocation.runId}:${allocation.projectRef}:${mutationKey}`)) {
        throw new InstallError('INSTALL_MUTATION_ALREADY_CLAIMED', true);
      }
      sent = true;
    }
    const response = parse(ResponseSchema, await transport({
      method, path: `${projectPath}${suffix}`, ...(body === undefined ? {} : { body }),
    }));
    if (response.status < 200 || response.status >= 300) fail('INSTALL_HTTP_REJECTED');
    return response.body;
  }
  async function run(stage: InstallStage, prerequisite: InstallStage | undefined, action: () => Promise<Partial<InstallResult>>) {
    if (busy || halted || complete.has(stage) || (prerequisite && !complete.has(prerequisite))) {
      return { stage, status: 'blocked', code: 'INSTALL_STAGE_BLOCKED', checks: 0 } satisfies InstallResult;
    }
    busy = true;
    sent = false;
    try {
      const evidence = await action();
      complete.add(stage);
      return { stage, status: 'passed', code: 'INSTALL_STAGE_VERIFIED', checks: 1, ...evidence } satisfies InstallResult;
    } catch (error) {
      halted = sent;
      return {
        stage, status: sent ? 'unknown' : error instanceof InstallError && error.blocked ? 'blocked' : 'failed',
        code: error instanceof InstallError ? error.code : 'INSTALL_OPERATION_FAILED', checks: 0,
      } satisfies InstallResult;
    } finally { busy = false; }
  }
  async function ledger() {
    const rows = parse(Type.Array(LedgerRowSchema), await request('GET', '/database/migrations'));
    if (new Set(rows.map(row => row.version)).size !== rows.length
      || new Set(rows.map(row => row.name)).size !== rows.length) fail('INSTALL_LEDGER_CONFLICT');
    return rows;
  }
  return {
    migrations(): Promise<InstallResult> {
      return run('migrations', undefined, async () => {
        const plan = installMigrationPlan();
        let rows = await ledger();
        for (const migration of plan) {
          const existing = rows.find(row => row.version === migration.version || row.name === migration.name);
          if (existing) {
            if (!matchesMigration(existing, migration) || existing.statement_count !== migration.statements.length) {
              fail('INSTALL_LEDGER_CONFLICT');
            }
            continue;
          }
          const receipt = parse(MigrationReceiptSchema, await request('POST', '/database/migrations', {
            version: migration.version, name: migration.name, sql: migration.sql,
          }, `migration:${migration.version}:${migration.checksum}`));
          if (!matchesMigration(receipt, migration)) fail('INSTALL_MIGRATION_RECEIPT_MISMATCH');
          rows = await ledger();
          const recorded = rows.find(row => row.version === migration.version);
          if (!recorded || !matchesMigration(recorded, migration)
            || recorded.statement_count !== migration.statements.length) fail('INSTALL_LEDGER_MISMATCH');
        }
        if (plan.some(migration => !rows.some(row => matchesMigration(row, migration)
          && row.statement_count === migration.statements.length))) fail('INSTALL_LEDGER_MISMATCH');
        return { checks: plan.length };
      });
    },
    catalog(): Promise<InstallResult> {
      return run('catalog', 'migrations', async () => {
        const result = parse(Type.Object({
          rows: Type.Array(CatalogRowSchema, { minItems: 1, maxItems: 1 }),
          rowCount: Type.Literal(1), command: Type.Literal('SELECT'),
        }), await request('POST', '/database/sql', { sql: INSTALL_CATALOG_SQL, mode: 'read' }));
        const row = result.rows[0];
        if (!row || row.database_name !== `supa_${allocation.projectRef}`
          || row.database_role !== `role_${allocation.projectRef}` || row.role_super
          || !row.auth_users || !row.auth_jwt || !row.overlay || !row.resource_unique || !row.scope_unique
          || !row.scope_fk || !row.claim_constraint || !row.runtime_constraint) fail('INSTALL_CATALOG_MISMATCH');
        return { checks: 11, roleBypassRls: row.role_bypass_rls };
      });
    },
    secrets(value: unknown): Promise<InstallResult> {
      return run('secrets', 'catalog', async () => {
        const secrets = runtimeSecrets(value, allocation);
        parse(Type.Object({}, { additionalProperties: false }),
          await request('POST', '/functions/supauth/secrets', secrets, 'function-secrets'));
        const names = parse(Type.Array(Type.Object({ name: Type.String(), value: Type.Literal('********') })),
          await request('GET', '/functions/supauth/secrets'));
        if (new Set(names.map(row => row.name)).size !== names.length
          || secrets.some(secret => !names.some(row => row.name === `EDGEFN_SUPAUTH_${secret.name}`))) {
          fail('INSTALL_SECRETS_READBACK_MISMATCH');
        }
        return { checks: secrets.length };
      });
    },
    deploy(artifact: InstallArtifact): Promise<InstallResult> {
      return run('deploy', 'secrets', async () => {
        const files = artifacts.get(artifact);
        if (!files) fail('INSTALL_ARTIFACT_INVALID');
        const existing = parse(Type.Array(FunctionSchema), await request('GET', '/functions'));
        if (existing.some(fn => fn.slug === 'supauth')) fail('INSTALL_FUNCTION_NOT_ABSENT');
        const receipt = parse(DeployReceiptSchema, await request('POST', '/functions/supauth/bundle', {
          files: { ...files }, entrypoint: 'index.ts', minify: false, verify_jwt: false,
          expected_active_version: 'absent', expected_activation_id: 'legacy',
        }, `function-bundle:${artifact.inventorySha256}`));
        if (receipt.project_ref !== allocation.projectRef || receipt.version !== receipt.active_version) {
          fail('INSTALL_ACTIVATION_MISMATCH');
        }
        const source = parse(Type.Object({ code: Type.String() }), await request('GET', '/functions/supauth/source'));
        const version = parse(VersionDetailSchema,
          await request('GET', `/functions/supauth/versions/${receipt.version}`));
        const runtimeSha256 = hash(version.bundle_code);
        if (hash(source.code) !== artifact.sourceSha256 || hash(version.source_code) !== artifact.sourceSha256
          || version.version !== receipt.version || runtimeSha256.slice(0, 16) !== receipt.bundle_hash) {
          fail('INSTALL_ARTIFACT_READBACK_MISMATCH');
        }
        const functions = parse(Type.Array(FunctionSchema), await request('GET', '/functions'));
        const active = functions.filter(fn => fn.slug === 'supauth');
        if (active.length !== 1 || String(active[0]?.version) !== receipt.version
          || active[0]?.activation_id !== receipt.activation_id || active[0]?.verify_jwt !== false) {
          fail('INSTALL_ACTIVATION_MISMATCH');
        }
        return { checks: 4, version: receipt.version, activationId: receipt.activation_id,
          sourceSha256: artifact.sourceSha256, runtimeSha256 };
      });
    },
    routes(): Promise<InstallResult> {
      return run('routes', 'deploy', async () => {
        const before = parse(RoutesSchema, await request('GET', '/gateway/routes')).routes;
        const plan = routePlan(allocation);
        if (before.some(row => plan.some(route => route.id === row.id))) fail('INSTALL_ROUTE_EXISTS');
        for (const route of plan) {
          const receipt = parse(Type.Object({ success: Type.Literal(true), route: RouteSchema }),
            await request('POST', '/gateway/routes', route, `gateway:${route.id}`));
          if (!routeMatches(receipt.route, route)) fail('INSTALL_ROUTE_MISMATCH');
        }
        const after = parse(RoutesSchema, await request('GET', '/gateway/routes')).routes;
        if (new Set(after.map(row => row.id)).size !== after.length
          || after.length !== before.length + plan.length
          || before.some(row => JSON.stringify(after.find(candidate => candidate.id === row.id)) !== JSON.stringify(row))
          || plan.some(route => !after.some(row => routeMatches(row, route)))) fail('INSTALL_ROUTE_MISMATCH');
        return { checks: plan.length };
      });
    },
  };
}
