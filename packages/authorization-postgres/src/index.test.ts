import { describe, expect, it } from 'bun:test';
import {
  generateAuthorizationProjectionPreflightSql,
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
    expect(sql).not.toContain("claims ? 'azp'");
    expect(sql.match(/"auth"\."jwt"\(\)/g)).toHaveLength(1);
    expect(sql).toContain('REVOKE ALL ON SCHEMA "fa_authorization" FROM PUBLIC');
    expect(sql).toContain('GRANT USAGE ON SCHEMA "fa_authorization" TO authenticated');
    expect(sql).not.toMatch(/(^|;)\s*DO\b/i);
    expect(sql).not.toContain('pg_catalog.to_regclass');
    expect(sql).not.toContain('authorization_allowed_scope_ids(TEXT, TEXT, TEXT)');
    expect(sql).not.toContain('DROP FUNCTION IF EXISTS');
    expect(sql).toContain('REVOKE ALL ON FUNCTION "fa_authorization".authorization_allowed_scope_ids(TEXT, TEXT) FROM PUBLIC');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('TO authenticated');
  });

  it('generates opt-in strict OAuth application binding without metadata fallback', () => {
    const sql = generateAuthorizationSchemaSql({
      schema: 'fa_authorization',
      applicationId: 'xigu-fa',
      requireOAuthApplicationClaim: true,
    });

    expect(sql).toContain("claims ? 'client_id' AS has_client_id_claim");
    expect(sql).toContain("jsonb_typeof(claims -> 'client_id') AS client_id_type");
    expect(sql).toContain("claims ? 'azp' AS has_azp_claim");
    expect(sql).toContain("jsonb_typeof(claims -> 'azp') AS azp_type");
    expect(sql).toContain('(current_principal.has_client_id_claim OR current_principal.has_azp_claim)');
    expect(sql).toContain("current_principal.client_id_type = 'string'");
    expect(sql).toContain("current_principal.client_id = 'xigu-fa'");
    expect(sql).toContain("current_principal.azp_type = 'string'");
    expect(sql).toContain("current_principal.azp = 'xigu-fa'");
    expect(sql).not.toContain('token_application_id');
    expect(sql).not.toContain('has_token_application_claim');
    expect(sql).not.toContain("authorization_context') ? 'application_id'");
  });

  it('keeps explicit compatibility mode identical to the default', () => {
    const options = { schema: 'fa_authorization', applicationId: 'xigu-fa' } as const;

    expect(generateAuthorizationSchemaSql({ ...options, requireOAuthApplicationClaim: false }))
      .toBe(generateAuthorizationSchemaSql(options));
  });

  it('generates a read-only projection preflight with stable machine-readable violations', () => {
    const sql = generateAuthorizationProjectionPreflightSql({ schema: 'fa_authorization' });

    expect(sql).toStartWith('WITH projection AS');
    expect(sql).toContain('pg_catalog.to_regclass(\'"fa_authorization"."effective_permission_grants"\')');
    expect(sql).toContain("SELECT 'projection_missing'::TEXT AS rule");
    expect(sql).toContain("SELECT 'projection_kind'");
    expect(sql).toContain("SELECT 'projection_columns'");
    expect(sql).toContain("SELECT 'projection_column_types'");
    expect(sql).toContain("SELECT 'projection_privileges'");
    expect(sql).toContain('SELECT rule, message\nFROM violations\nORDER BY rule;');
    expect(sql).not.toMatch(/(^|;)\s*DO\b/i);
    expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i);
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
    expect(() => generateAuthorizationProjectionPreflightSql({
      schema: 'public; drop schema public',
    })).toThrow(TypeError);
    expect(() => generateAuthorizationSchemaSql({
      schema: 'fa_authorization',
      applicationId: 'xigu fa',
    })).toThrow(TypeError);
    expect(() => generateAuthorizationSchemaSql({
      schema: 'fa_authorization',
      applicationId: 'xigu-fa',
      requireOAuthApplicationClaim: 'yes' as unknown as boolean,
    })).toThrow('requireOAuthApplicationClaim must be a boolean');
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

  it('escapes quotes in the installed application ID', () => {
    const sql = generateAuthorizationSchemaSql({
      schema: 'fa_authorization',
      applicationId: "xigu'fa",
      requireOAuthApplicationClaim: true,
    });

    expect(sql).toContain("permission_grant.application_id = 'xigu''fa'");
    expect(sql).toContain("current_principal.client_id = 'xigu''fa'");
    expect(sql).toContain("current_principal.azp = 'xigu''fa'");
  });

  it('preserves dollar replacement patterns in the installed application ID', () => {
    const applicationIds = ['client-$&-id', 'client-$$-id', 'client-$`-id', "client-$'-id"];

    for (const applicationId of applicationIds) {
      const sql = generateAuthorizationSchemaSql({
        schema: 'fa_authorization',
        applicationId,
        requireOAuthApplicationClaim: true,
      });
      const escapedApplicationId = applicationId.replace(/'/g, "''");

      expect(sql).toContain(`permission_grant.application_id = '${escapedApplicationId}'`);
      expect(sql).toContain(`current_principal.client_id = '${escapedApplicationId}'`);
      expect(sql).toContain(`current_principal.azp = '${escapedApplicationId}'`);
      expect(sql).not.toContain('{{installedApplicationId}}');
    }
  });

  it('generates separate legacy cleanup SQL for post-policy migration', () => {
    expect(generateLegacyAuthorizationCleanupSql({ schema: 'fa_authorization' }))
      .toBe('DROP FUNCTION IF EXISTS "fa_authorization".authorization_allowed_scope_ids(TEXT, TEXT, TEXT);');
  });
});
