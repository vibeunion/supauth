import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { Type, decodeSchema, type Static, type TSchema } from '../../packages/shared/src/schema.js';
import { WireResourceSchema } from '../../packages/shared/src/sdk-models.js';
import { HOSTED_MIGRATIONS } from '../../packages/auth-server/src/db/migrate.js';
import { closeDb } from '../../packages/auth-server/src/db/index.js';
import {
  createResource, getResource, deleteResource, removeScope,
} from '../../packages/auth-server/src/repositories/resources.js';
import { createBinding, deleteBinding } from '../../packages/auth-server/src/repositories/bindings.js';
import { postgresDatabaseName, postgresSqlState, verifyPostgresTarget } from '../../scripts/real-contract-postgres.js';

const runId = process.env['REAL_CONTRACT_POSTGRES_RUN'];
const real = runId ? describe : describe.skip;
let sql: ReturnType<typeof postgres> | undefined;
let projectSql: ReturnType<typeof postgres> | undefined;
let applied = 0;
let projectRole = '';
const namesSchema = Type.Object({ name: Type.String() });
const countSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) });

function database(): ReturnType<typeof postgres> {
  if (!sql) throw new Error('real_database_not_initialized');
  return sql;
}

async function rows<S extends TSchema>(schema: S, statement: string): Promise<Static<S>[]> {
  const result = await database().unsafe<Record<string, unknown>[]>(statement);
  return result.map(row => decodeSchema(schema, row));
}

function wire(value: unknown): unknown {
  const decoded: unknown = JSON.parse(JSON.stringify(value));
  return decoded;
}

async function rejectsSqlState(operation: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const code = postgresSqlState(error);
    if (!code) throw new Error('missing_postgres_constraint_error');
    expect(code).toBe(expected);
    return;
  }
  throw new Error('expected_postgres_constraint_rejection');
}

async function migratedTables(): Promise<string[]> {
  return (await rows(namesSchema,
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'supaoauth' ORDER BY tablename"))
    .map(row => row.name);
}

real('real PostgreSQL overlay migrations and repositories', () => {
  beforeAll(async () => {
    if (!runId) throw new Error('real_postgres_run_required');
    const target = verifyPostgresTarget(process.env['AUTHORIZATION_POSTGRES_URL'] ?? '', runId);
    sql = postgres(target.href, { max: 1, connect_timeout: 2, onnotice: () => {} });
    const identities = await rows(Type.Object({
      database: Type.Literal(postgresDatabaseName(runId)),
      run_id: Type.Literal(runId),
      username: Type.Literal('postgres'),
    }), `SELECT current_database() AS database, current_setting('real_contract.run_id') AS run_id, current_user AS username`);
    expect(identities).toHaveLength(1);
    const db = database();
    const roleStates = await rows(Type.Object({
      name: Type.String(), superuser: Type.Literal(false), bypass: Type.Literal(false),
    }), "SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname IN ('anon', 'authenticated')");
    expect(roleStates.map(role => role.name).sort()).toEqual(['anon', 'authenticated']);

    // 仅使用 runner 核验过的随机标识符；该临时实例由本 run 独占。
    projectRole = `role_${runId}_authorization_test`;
    const password = randomBytes(32).toString('hex');
    await db.unsafe(`CREATE ROLE "${projectRole}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
    for (const migration of HOSTED_MIGRATIONS) {
      await db.unsafe(migration.sql);
      applied += 1;
    }
    const projectUrl = new URL(target.href);
    projectUrl.username = projectRole;
    projectUrl.password = password;
    process.env['SUPACLOUD_DATABASE_URL'] = projectUrl.href;
    projectSql = postgres(projectUrl.href, { max: 1, connect_timeout: 2, onnotice: () => {} });
  }, 30_000);

  afterAll(async () => {
    try {
      await closeDb();
    } finally {
      try {
        await projectSql?.end({ timeout: 3 });
      } finally {
        await sql?.end({ timeout: 3 });
      }
    }
  });

  test('all sixteen actual hosted SQL migrations create the maintained overlay catalog', async () => {
    expect(applied).toBe(16);
    expect(applied).toBe(HOSTED_MIGRATIONS.length);
    const tables = await migratedTables();
    for (const name of [
      'api_resources', 'scopes', 'application_bindings', 'connectors', 'account_provisioning_records',
      'organization_templates', 'organization_template_instantiations', 'oauth_consent_decisions',
    ]) expect(tables).toContain(name);
    for (const retired of ['users', 'organizations', 'roles', 'webhooks', 'webhook_deliveries']) {
      expect(tables).not.toContain(retired);
    }
    const columns = await rows(Type.Object({ name: Type.String(), type: Type.String() }),
      "SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema='supaoauth' AND table_name='sign_in_experience' AND column_name='content'");
    expect(columns).toEqual([{ name: 'content', type: 'jsonb' }]);
  });

  test('reapplying the actual migration chain preserves the catalog and seeded singleton', async () => {
    const before = await migratedTables();
    for (const migration of HOSTED_MIGRATIONS) await database().unsafe(migration.sql);
    expect(await migratedTables()).toEqual(before);
    expect(await rows(countSchema,
      'SELECT count(*)::integer AS count FROM supaoauth.organization_templates WHERE is_default'))
      .toEqual([{ count: 1 }]);
  });

  test('PostgreSQL enforces unique, foreign-key, not-null and check constraints', async () => {
    const db = database();
    const indicator = `urn:real:${randomUUID()}`;
    await db`INSERT INTO supaoauth.api_resources (name, indicator) VALUES ('constraint', ${indicator})`;
    await rejectsSqlState(async () => db`INSERT INTO supaoauth.api_resources (name, indicator) VALUES ('duplicate', ${indicator})`, '23505');
    await rejectsSqlState(async () => db`INSERT INTO supaoauth.api_resources (name, indicator) VALUES (NULL, ${randomUUID()})`, '23502');
    await rejectsSqlState(async () => db`INSERT INTO supaoauth.scopes (name, resource_id) VALUES ('missing-parent', ${randomUUID()})`, '23503');
    await rejectsSqlState(async () => db`
      INSERT INTO supaoauth.oauth_consent_decisions (user_id, application_id, decision)
      VALUES (${randomUUID()}, 'test-app', 'invalid')
    `, '23514');
  });

  test('actual Drizzle resource repository writes and reads validated schema results', async () => {
    const created = decodeSchema(WireResourceSchema, wire(await createResource({
      name: 'real resource', indicator: `urn:real:${randomUUID()}`, scopes: [{ name: 'read' }],
    })));
    expect(created.scopes).toHaveLength(1);
    const readback = decodeSchema(WireResourceSchema, wire(await getResource(created.id)));
    expect(readback.id).toBe(created.id);
    expect(readback.scopes.map(scope => scope.name)).toEqual(['read']);
    expect(readback.name).toBe('real resource');
  });

  test('duplicate scopes roll back the entire real repository transaction', async () => {
    const indicator = `urn:rollback:${randomUUID()}`;
    await rejectsSqlState(async () => createResource({
      name: 'must roll back', indicator, scopes: [{ name: 'same' }, { name: 'same' }],
    }), '23505');
    const remaining = await database()<Record<string, unknown>[]>`
      SELECT count(*)::integer AS count FROM supaoauth.api_resources WHERE indicator = ${indicator}
    `;
    expect(remaining.map(row => decodeSchema(countSchema, row))).toEqual([{ count: 0 }]);
  });

  test('bound scope deletion is denied until its actual application binding is removed', async () => {
    const created = decodeSchema(WireResourceSchema, wire(await createResource({
      name: 'bound', indicator: `urn:bound:${randomUUID()}`, scopes: [{ name: 'read' }],
    })));
    const scope = created.scopes[0];
    if (!scope) throw new Error('missing_scope');
    const binding = decodeSchema(Type.Object({ id: Type.String() }), wire(await createBinding({
      applicationId: 'app-a', resourceId: created.id, scopeId: scope.id,
    })));
    expect(await removeScope(created.id, scope.id)).toBe('in_use');
    expect(await deleteBinding('app-a', binding.id)).toBe(true);
    expect(await removeScope(created.id, scope.id)).toBe('deleted');
    expect(await removeScope(created.id, scope.id)).toBe('not_found');
  });

  test('resource deletion cascades through real scopes and bindings', async () => {
    const created = decodeSchema(WireResourceSchema, wire(await createResource({
      name: 'cascade', indicator: `urn:cascade:${randomUUID()}`, scopes: [{ name: 'read' }],
    })));
    const scope = created.scopes[0];
    if (!scope) throw new Error('missing_scope');
    await createBinding({ applicationId: 'app-cascade', resourceId: created.id, scopeId: scope.id });
    await deleteResource(created.id);
    expect(await getResource(created.id)).toBeNull();
    for (const result of [
      await database()<Record<string, unknown>[]>`SELECT count(*)::integer AS count FROM supaoauth.scopes WHERE resource_id = ${created.id}`,
      await database()<Record<string, unknown>[]>`SELECT count(*)::integer AS count FROM supaoauth.application_bindings WHERE resource_id = ${created.id}`,
    ]) expect(result.map(row => decodeSchema(countSchema, row))).toEqual([{ count: 0 }]);
  });

  test('application binding deletion cannot delete another application binding', async () => {
    const created = decodeSchema(WireResourceSchema, wire(await createResource({
      name: 'ownership', indicator: `urn:ownership:${randomUUID()}`,
    })));
    const binding = decodeSchema(Type.Object({ id: Type.String() }), wire(await createBinding({
      applicationId: 'owner-app', resourceId: created.id,
    })));
    expect(await deleteBinding('other-app', binding.id)).toBe(false);
    expect(await deleteBinding('owner-app', binding.id)).toBe(true);
  });

  test('Function login has explicit overlay rights without superuser or RLS bypass', async () => {
    if (!projectSql) throw new Error('missing_function_connection');
    const result = await projectSql<Record<string, unknown>[]>`
      SELECT current_user AS username, rolsuper AS superuser, rolbypassrls AS bypass,
        has_table_privilege(current_user, 'supaoauth.api_resources', 'INSERT') AS can_insert,
        has_table_privilege(current_user, 'supaoauth.oauth_consent_decisions', 'SELECT') AS can_read_receipts
      FROM pg_roles WHERE rolname = current_user
    `;
    expect(result.map(row => decodeSchema(Type.Object({
      username: Type.Literal(projectRole), superuser: Type.Literal(false), bypass: Type.Literal(false),
      can_insert: Type.Literal(true), can_read_receipts: Type.Literal(false),
    }), row))).toHaveLength(1);
  });

  test('anonymous table access and permission-helper execution fail with actual PostgreSQL denials', async () => {
    await rejectsSqlState(async () => database().begin(async transaction => {
      await transaction.unsafe('SET LOCAL ROLE anon');
      await transaction`SELECT * FROM supaoauth.api_resources`;
    }), '42501');
    await rejectsSqlState(async () => database().begin(async transaction => {
      await transaction.unsafe('SET LOCAL ROLE anon');
      await transaction`SELECT supaoauth.current_permission_claims(NULL)`;
    }), '42501');
  });
});
