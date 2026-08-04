import { describe, expect, it } from 'bun:test';
import { generateAuthorizationSchemaSql, generateRlsPoliciesSql } from './index.js';

describe('@supauth/authorization-postgres', () => {
  it('generates an application-owned catalog and hardened scope helper', () => {
    const sql = generateAuthorizationSchemaSql({ schema: 'fa_authorization' });

    expect(sql).toContain('"fa_authorization".permission_catalog');
    expect(sql).toContain('"fa_authorization".role_permissions');
    expect(sql).toContain('fa_authorization.active_memberships adapter view is required');
    expect(sql).toContain('fa_authorization.active_role_assignments adapter view is required');
    expect(sql).toContain('STABLE\nSECURITY DEFINER\nSET search_path = \'\'');
    expect(sql).toContain('COUNT(*) OVER (PARTITION BY membership.domain_id) AS membership_count');
    expect(sql).toContain('WHERE membership_count = 1');
    expect(sql).toContain("current_principal.principal_kind IN ('user', 'service')");
    expect(sql).toContain("WHEN claims ? 'client_id' THEN claims ->> 'client_id'");
    expect(sql).toContain("WHEN (claims -> 'app_metadata' -> 'authorization_context') ? 'application_id'");
    expect(sql).toContain("OR COALESCE(\n          (claims -> 'app_metadata' -> 'authorization_context') ? 'application_id',\n          FALSE");
    expect(sql).toContain('AS has_token_application_claim');
    expect(sql).toContain('membership.application_id = requested_application_id');
    expect(sql).toContain('NOT current_principal.has_token_application_claim');
    expect(sql).toContain('current_principal.token_application_id = requested_application_id');
    expect(sql).not.toContain('membership.application_id = current_principal.application_id');
    expect(sql).not.toContain('user_metadata');
    expect(sql.match(/"auth"\."jwt"\(\)/g)).toHaveLength(1);
    expect(sql).toContain('REVOKE ALL ON SCHEMA "fa_authorization" FROM PUBLIC');
    expect(sql).toContain('GRANT USAGE ON SCHEMA "fa_authorization" TO authenticated');
    expect(sql).toContain('REVOKE ALL ON FUNCTION "fa_authorization".authorization_allowed_scope_ids(TEXT, TEXT, TEXT) FROM PUBLIC');
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
      applicationId: 'xigu-fa',
      policies: [
        { command: 'select', permission: 'invoice:read' },
        { command: 'update', permission: 'invoice:update' },
      ],
    });

    expect(sql).toContain('"organization_id" IN (\n    SELECT allowed_scope.scope_id::uuid');
    expect(sql).toContain('authorization_allowed_scope_ids(\'invoice:read\', \'organization\', \'xigu-fa\')');
    expect(sql).not.toMatch(/authorization_allowed_scope_ids\([^)]*"organization_id"/);
    expect(sql).toContain('USING ("organization_id" IN');
    expect(sql).toContain('WITH CHECK ("organization_id" IN');
  });

  it('rejects unsafe identifiers and non-canonical permissions', () => {
    expect(() => generateAuthorizationSchemaSql({ schema: 'public; drop schema public' })).toThrow(TypeError);
    expect(() => generateRlsPoliciesSql({
      schema: 'fa_authorization',
      tableSchema: 'public',
      table: 'invoices',
      domainColumn: 'organization_id',
      domainIdType: 'uuid',
      domainType: 'organization',
      applicationId: 'xigu-fa',
      policies: [{ command: 'select', permission: 'invoice.*' }],
    })).toThrow(TypeError);
  });
});
