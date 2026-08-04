/**
 * 真实 PostgreSQL/RLS 集成门禁。
 * 仅在 RUN_AUTHORIZATION_POSTGRES_TESTS=1 时运行，并要求
 * AUTHORIZATION_POSTGRES_URL 指向 loopback 上以 authorization_test 结尾的专用数据库。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { generateAuthorizationSchemaSql, generateRlsPoliciesSql } from './index.js';

const DATABASE_URL = process.env.AUTHORIZATION_POSTGRES_URL || '';
const AUTHORIZATION_SCHEMA = 'authorization_test_rbac';
const SOURCE_SCHEMA = 'authorization_test_source';
const DATA_SCHEMA = 'authorization_test_data';
const ISSUER = 'https://tenant.example.test/auth/v1';
const APPLICATION_ID = 'xigu-fa';

function isDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && loopback
      && decodeURIComponent(parsed.pathname.slice(1)).endsWith('authorization_test');
  } catch {
    return false;
  }
}

const postgresGateRequested = process.env.RUN_AUTHORIZATION_POSTGRES_TESTS === '1';
if (postgresGateRequested && !isDisposableDatabaseUrl(DATABASE_URL)) {
  throw new Error(
    'Authorization PostgreSQL tests require AUTHORIZATION_POSTGRES_URL to use a loopback disposable *authorization_test database',
  );
}
const describePostgres = postgresGateRequested ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;

const nativeClaims = {
  iss: ISSUER,
  sub: 'user-1',
  role: 'authenticated',
};

async function seedAuthorizationState(): Promise<void> {
  await sql.unsafe(`
    TRUNCATE ${SOURCE_SCHEMA}.memberships, ${SOURCE_SCHEMA}.role_assignments;

    INSERT INTO ${SOURCE_SCHEMA}.memberships (
      membership_key,
      principal_kind,
      principal_issuer,
      principal_subject,
      application_id,
      domain_type,
      domain_id,
      active
    ) VALUES
      ('membership-native', 'user', '${ISSUER}', 'user-1', '${APPLICATION_ID}', 'organization', 'org-a', TRUE),
      ('membership-cross-application', 'user', '${ISSUER}', 'user-1', 'other-application', 'organization', 'org-b', TRUE),
      ('membership-cross-issuer', 'user', 'https://other.example.test/auth/v1', 'user-1', '${APPLICATION_ID}', 'organization', 'org-c', TRUE),
      ('membership-cross-domain', 'user', '${ISSUER}', 'user-1', '${APPLICATION_ID}', 'project', 'org-b', TRUE),
      ('membership-service', 'service', '${ISSUER}', 'service-worker', '${APPLICATION_ID}', 'organization', 'org-a', TRUE);

    INSERT INTO ${SOURCE_SCHEMA}.role_assignments (membership_key, role_key, active)
    SELECT membership_key, 'invoice-reader', TRUE
    FROM ${SOURCE_SCHEMA}.memberships;
  `);
}

async function visibleInvoiceIds(claims: Record<string, unknown>): Promise<string[]> {
  return sql.begin(async transaction => {
    await transaction.unsafe('SET LOCAL ROLE authenticated');
    await transaction`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, TRUE)`;
    const rows = await transaction<{ id: string }[]>`
      SELECT id
      FROM authorization_test_data.invoices
      ORDER BY id
    `;
    return rows.map(row => row.id);
  });
}

describePostgres('@supauth/authorization-postgres real RLS', () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated' AND rolbypassrls) THEN
          RAISE EXCEPTION 'authenticated role must not bypass RLS';
        END IF;
      END $$;

      DROP SCHEMA IF EXISTS ${AUTHORIZATION_SCHEMA} CASCADE;
      DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE;
      DROP SCHEMA IF EXISTS ${DATA_SCHEMA} CASCADE;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.jwt()
      RETURNS JSONB
      LANGUAGE sql
      STABLE
      SET search_path = ''
      AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), ''), '{}')::JSONB
      $$;

      CREATE SCHEMA ${AUTHORIZATION_SCHEMA};
      CREATE SCHEMA ${SOURCE_SCHEMA};
      CREATE SCHEMA ${DATA_SCHEMA};

      CREATE TABLE ${SOURCE_SCHEMA}.memberships (
        membership_key TEXT PRIMARY KEY,
        principal_kind TEXT NOT NULL,
        principal_issuer TEXT NOT NULL,
        principal_subject TEXT NOT NULL,
        application_id TEXT NOT NULL,
        domain_type TEXT NOT NULL,
        domain_id TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE ${SOURCE_SCHEMA}.role_assignments (
        membership_key TEXT NOT NULL REFERENCES ${SOURCE_SCHEMA}.memberships(membership_key) ON DELETE CASCADE,
        role_key TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        PRIMARY KEY (membership_key, role_key)
      );
      CREATE VIEW ${AUTHORIZATION_SCHEMA}.active_memberships AS
        SELECT
          membership_key,
          principal_kind,
          principal_issuer,
          principal_subject,
          application_id,
          domain_type,
          domain_id
        FROM ${SOURCE_SCHEMA}.memberships
        WHERE active;
      CREATE VIEW ${AUTHORIZATION_SCHEMA}.active_role_assignments AS
        SELECT membership_key, role_key
        FROM ${SOURCE_SCHEMA}.role_assignments
        WHERE active;

      CREATE TABLE ${DATA_SCHEMA}.invoices (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL
      );
      INSERT INTO ${DATA_SCHEMA}.invoices (id, organization_id) VALUES
        ('invoice-a', 'org-a'),
        ('invoice-b', 'org-b'),
        ('invoice-c', 'org-c');
      GRANT USAGE ON SCHEMA ${DATA_SCHEMA} TO authenticated;
      GRANT SELECT ON ${DATA_SCHEMA}.invoices TO authenticated;
    `);

    await sql.unsafe(generateAuthorizationSchemaSql({ schema: AUTHORIZATION_SCHEMA }));
    await sql.unsafe(`
      INSERT INTO ${AUTHORIZATION_SCHEMA}.permission_catalog (permission_name, description)
      VALUES ('invoice:read', 'Read invoices');
      INSERT INTO ${AUTHORIZATION_SCHEMA}.role_permissions (role_key, permission_name)
      VALUES ('invoice-reader', 'invoice:read');
    `);
    await sql.unsafe(generateRlsPoliciesSql({
      schema: AUTHORIZATION_SCHEMA,
      tableSchema: DATA_SCHEMA,
      table: 'invoices',
      domainColumn: 'organization_id',
      domainIdType: 'text',
      domainType: 'organization',
      applicationId: APPLICATION_ID,
      policies: [{ command: 'select', permission: 'invoice:read' }],
    }));
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      DROP SCHEMA IF EXISTS ${AUTHORIZATION_SCHEMA} CASCADE;
      DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE;
      DROP SCHEMA IF EXISTS ${DATA_SCHEMA} CASCADE;
    `);
    await sql.end();
  });

  beforeEach(seedAuthorizationState);

  test('native GoTrue token without an application claim uses the policy application boundary', async () => {
    await expect(visibleInvoiceIds(nativeClaims)).resolves.toEqual(['invoice-a']);
  });

  test('matching OAuth client_id and signed app_metadata application claims are accepted', async () => {
    await expect(visibleInvoiceIds({ ...nativeClaims, client_id: APPLICATION_ID }))
      .resolves.toEqual(['invoice-a']);
    await expect(visibleInvoiceIds({
      ...nativeClaims,
      app_metadata: { authorization_context: { application_id: APPLICATION_ID } },
    })).resolves.toEqual(['invoice-a']);
  });

  test('mismatched, preferred, and empty client_id claims fail closed', async () => {
    await expect(visibleInvoiceIds({ ...nativeClaims, client_id: 'other-application' }))
      .resolves.toEqual([]);
    await expect(visibleInvoiceIds({
      ...nativeClaims,
      app_metadata: { authorization_context: { application_id: 'other-application' } },
    })).resolves.toEqual([]);
    await expect(visibleInvoiceIds({
      ...nativeClaims,
      client_id: 'other-application',
      app_metadata: { authorization_context: { application_id: APPLICATION_ID } },
    })).resolves.toEqual([]);
    await expect(visibleInvoiceIds({
      ...nativeClaims,
      client_id: '',
      app_metadata: { authorization_context: { application_id: APPLICATION_ID } },
    })).resolves.toEqual([]);
    await expect(visibleInvoiceIds({
      ...nativeClaims,
      client_id: null,
      app_metadata: { authorization_context: { application_id: APPLICATION_ID } },
    })).resolves.toEqual([]);
  });

  test('cross-issuer, cross-application, and cross-domain memberships stay denied', async () => {
    await expect(visibleInvoiceIds(nativeClaims)).resolves.toEqual(['invoice-a']);
    await expect(visibleInvoiceIds({ ...nativeClaims, iss: 'https://unknown.example.test/auth/v1' }))
      .resolves.toEqual([]);
  });

  test('revocation is visible on the next statement', async () => {
    await expect(visibleInvoiceIds(nativeClaims)).resolves.toEqual(['invoice-a']);
    await sql`
      UPDATE authorization_test_source.role_assignments
      SET active = FALSE
      WHERE membership_key = 'membership-native'
    `;
    await expect(visibleInvoiceIds(nativeClaims)).resolves.toEqual([]);
  });

  test('user_metadata cannot override signed identity or application binding', async () => {
    await expect(visibleInvoiceIds({
      ...nativeClaims,
      user_metadata: {
        authorization_context: {
          kind: 'service',
          subject: 'service-worker',
          application_id: 'other-application',
        },
      },
    })).resolves.toEqual(['invoice-a']);
  });

  test('signed service kind and subject remain supported', async () => {
    await expect(visibleInvoiceIds({
      iss: ISSUER,
      sub: 'unrelated-user-subject',
      app_metadata: {
        authorization_context: {
          kind: 'service',
          subject: 'service-worker',
          application_id: APPLICATION_ID,
        },
      },
    })).resolves.toEqual(['invoice-a']);
  });

  test('duplicate active memberships for one domain fail closed', async () => {
    await sql.unsafe(`
      INSERT INTO ${SOURCE_SCHEMA}.memberships (
        membership_key,
        principal_kind,
        principal_issuer,
        principal_subject,
        application_id,
        domain_type,
        domain_id,
        active
      ) VALUES (
        'membership-native-duplicate',
        'user',
        '${ISSUER}',
        'user-1',
        '${APPLICATION_ID}',
        'organization',
        'org-a',
        TRUE
      );
      INSERT INTO ${SOURCE_SCHEMA}.role_assignments (membership_key, role_key, active)
      VALUES ('membership-native-duplicate', 'invoice-reader', TRUE);
    `);
    await expect(visibleInvoiceIds(nativeClaims)).resolves.toEqual([]);
  });
});
