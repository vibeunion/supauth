import { describe, expect, it } from 'bun:test';
import {
  generateAuthorizationSchemaSql,
  generateLegacyAuthorizationCleanupSql,
  generateRlsPoliciesSql,
} from './index.js';

describe('@supauth/authorization-postgres', () => {
  it('consumes the application effective-grant projection and generates a hardened scope helper', () => {
    const sql = generateAuthorizationSchemaSql({ schema: 'fa_authorization', applicationId: 'xigu-fa' });

    expect(sql).not.toContain('CREATE TABLE');
    expect(sql).not.toContain('"fa_authorization".permission_catalog');
    expect(sql).not.toContain('"fa_authorization".role_permissions');
    expect(sql).toContain('fa_authorization.effective_permission_grants projection view is required');
    expect(sql).toContain('FROM "fa_authorization".effective_permission_grants AS permission_grant');
    expect(sql).toContain('STABLE\nSECURITY DEFINER\nSET search_path = \'\'');
    expect(sql).toContain('SELECT DISTINCT permission_grant.domain_id AS scope_id');
    expect(sql).not.toContain('membership_key');
    expect(sql).toContain("current_principal.principal_kind IN ('user', 'service')");
    expect(sql).toContain("current_principal.principal_issuer ~ '^[^[:space:]]+$'");
    expect(sql).toContain("current_principal.principal_subject ~ '^[^[:space:]]+$'");
    expect(sql).toContain("requested_permission ~ '^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$'");
    expect(sql).toContain("requested_domain_type ~ '^[^[:space:]]+$'");
    expect(sql).toContain("permission_grant.domain_id ~ '^[^[:space:]]+$'");
    expect(sql).toContain("WHEN claims ? 'client_id' THEN claims ->> 'client_id'");
    expect(sql).toContain("WHEN (claims -> 'app_metadata' -> 'authorization_context') ? 'application_id'");
    expect(sql).toContain("OR COALESCE(\n          (claims -> 'app_metadata' -> 'authorization_context') ? 'application_id',\n          FALSE");
    expect(sql).toContain('AS has_token_application_claim');
    expect(sql).toContain("WHEN claims -> 'app_metadata' -> 'authorization_context' ->> 'kind' = 'service'");
    expect(sql).toContain("ELSE claims ->> 'sub'");
    expect(sql).not.toContain("COALESCE(\n        claims -> 'app_metadata' -> 'authorization_context' ->> 'subject'");
    expect(sql).toContain("permission_grant.application_id = 'xigu-fa'");
    expect(sql).toContain('NOT current_principal.has_token_application_claim');
    expect(sql).toContain("current_principal.token_application_id = 'xigu-fa'");
    expect(sql).not.toContain('requested_application_id');
    expect(sql).not.toContain('permission_grant.application_id = current_principal.application_id');
    expect(sql).not.toContain('user_metadata');
    expect(sql.match(/"auth"\."jwt"\(\)/g)).toHaveLength(1);
    expect(sql).toContain('REVOKE ALL ON SCHEMA "fa_authorization" FROM PUBLIC');
    expect(sql).toContain('GRANT USAGE ON SCHEMA "fa_authorization" TO authenticated');
    expect(sql).toContain("pg_catalog.to_regprocedure('fa_authorization.authorization_allowed_scope_ids(text,text,text)')");
    expect(sql).not.toContain('DROP FUNCTION IF EXISTS');
    expect(sql).toContain('must be an ordinary view');
    expect(sql).toContain("'principal_kind', 'principal_issuer', 'principal_subject', 'application_id'");
    expect(sql).toContain("attribute.atttypid <> 'pg_catalog.text'::pg_catalog.regtype");
    expect(sql).toContain("has_table_privilege('authenticated', projection_oid, 'SELECT')");
    expect(sql).toContain('REVOKE ALL ON FUNCTION "fa_authorization".authorization_allowed_scope_ids(TEXT, TEXT) FROM PUBLIC');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('TO authenticated');
  });

  it('generates one-time scope-set RLS without passing a row ID to a helper', () => {
    const sql = generateRlsPoliciesSql({
      schema: 'fa_authorization',
      tableSchema: 'public',
      table: 'invoices',
      domainColumn: 'organization_id',
      domainIdType: 'uuid',
      domainType: 'organization',
      policies: [
        { command: 'select', usingPermission: 'invoice:read' },
        { command: 'update', usingPermission: 'invoice:read', checkPermission: 'invoice:update' },
      ],
    });

    expect(sql).toContain('"organization_id" IN (\n    SELECT allowed_scope.scope_id::uuid');
    expect(sql).toContain('authorization_allowed_scope_ids(\'invoice:read\', \'organization\')');
    expect(sql).toContain('authorization_allowed_scope_ids(\'invoice:update\', \'organization\')');
    expect(sql).not.toMatch(/authorization_allowed_scope_ids\([^)]*"organization_id"/);
    expect(sql).toContain('DROP POLICY IF EXISTS "authorization_select"');
    expect(sql).toContain('USING ("organization_id" IN');
    expect(sql).toContain('WITH CHECK ("organization_id" IN');
  });

  it('rejects unsafe identifiers and non-canonical permissions', () => {
    expect(() => generateAuthorizationSchemaSql({
      schema: 'public; drop schema public',
      applicationId: 'xigu-fa',
    })).toThrow(TypeError);
    expect(() => generateAuthorizationSchemaSql({
      schema: 'fa_authorization',
      applicationId: 'xigu fa',
    })).toThrow(TypeError);
    expect(() => generateRlsPoliciesSql({
      schema: 'fa_authorization',
      tableSchema: 'public',
      table: 'invoices',
      domainColumn: 'organization_id',
      domainIdType: 'uuid',
      domainType: 'organization',
      policies: [{ command: 'select', usingPermission: 'invoice.*' }],
    })).toThrow(TypeError);
    expect(() => generateRlsPoliciesSql({
      schema: 'fa_authorization',
      tableSchema: 'public',
      table: 'invoices',
      domainColumn: 'organization_id',
      domainIdType: 'integer' as 'text',
      domainType: 'organization',
      policies: [{ command: 'select', usingPermission: 'invoice:read' }],
    })).toThrow(TypeError);
    expect(() => generateRlsPoliciesSql({
      schema: 'fa_authorization',
      tableSchema: 'public',
      table: 'invoices',
      domainColumn: 'organization_id',
      domainIdType: 'uuid',
      domainType: 'organization',
      policies: [{ command: 'truncate' as 'select', usingPermission: 'invoice:read' }],
    })).toThrow(TypeError);
  });

  it('generates separate legacy cleanup SQL for post-policy migration', () => {
    expect(generateLegacyAuthorizationCleanupSql({ schema: 'fa_authorization' }))
      .toBe('DROP FUNCTION IF EXISTS "fa_authorization".authorization_allowed_scope_ids(TEXT, TEXT, TEXT);');
  });
});
