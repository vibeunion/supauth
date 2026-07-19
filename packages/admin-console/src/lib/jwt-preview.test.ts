// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, it } from 'bun:test';
import {
  SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT,
  SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT,
  SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT,
  SUPAOAUTH_PERMISSION_PROJECTION_LIMIT,
  SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT,
  SUPAOAUTH_ROLE_PROJECTION_LIMIT,
} from '@supauth/shared';
import { t } from './i18n.js';
import { validateExtensionDraft } from './jwt-preview.js';

const projectRef = 'project-one';

function draftForProject(projectProjection) {
  return JSON.stringify({
    app_metadata: {
      supaoauth: {
        schema_version: 2,
        projects: { [projectRef]: projectProjection },
      },
    },
  });
}

function validationCodes(rawDraft) {
  return validateExtensionDraft(rawDraft).errors.map((validationError) => validationError.code);
}

describe('Customize JWT preview validation', () => {
  it('accepts a bounded runtime projection', () => {
    const validation = validateExtensionDraft(draftForProject({
      roles: ['tenant_admin'],
      roles_count: 1,
      permissions: ['users.read'],
      permissions_count: 1,
      current_org_id: 'org-one',
      current_org_role: 'owner',
    }));

    expect(validation.errors).toEqual([]);
    expect(validation.value?.app_metadata.supaoauth.projects[projectRef].roles).toEqual(['tenant_admin']);
  });

  it('rejects protected and legacy top-level claims', () => {
    expect(validationCodes('{"role":"service_role","app_metadata":{"supaoauth":{"schema_version":2,"projects":{}}}}'))
      .toContain('blockedTopLevel');
    expect(validationCodes('{"supaoauth:roles":[],"app_metadata":{"supaoauth":{"schema_version":2,"projects":{}}}}'))
      .toContain('blockedTopLevel');
  });

  it('rejects root v1 projections without a compatibility fallback', () => {
    const rawDraft = JSON.stringify({
      app_metadata: {
        supaoauth: {
          roles: ['tenant_admin'],
          permissions: ['users.manage'],
        },
      },
    });
    const validation = validateExtensionDraft(rawDraft);
    const codes = validation.errors.map((validationError) => validationError.code);

    expect(codes).toContain('schemaVersionUnsupported');
    expect(codes).toContain('projectsObject');
    expect(codes).toContain('unknownRootField');
    for (const validationError of validation.errors) {
      const translationKey = `jwt.error.${validationError.code}`;
      expect(t(translationKey, validationError.params)).not.toBe(translationKey);
    }
  });

  it('renders user-facing labels for nested schema types', () => {
    expect(t('jwt.schemaType.record')).not.toBe('jwt.schemaType.record');
    expect(t('jwt.schemaType.organization[]')).not.toBe('jwt.schemaType.organization[]');
  });

  it('validates each project independently and accepts hook metadata at the root', () => {
    const validation = validateExtensionDraft(JSON.stringify({
      app_metadata: {
        supaoauth: {
          schema_version: 2,
          projects: {
            [projectRef]: { roles: ['admin'], permissions: ['users.read'] },
            'project-two': {
              roles: ['viewer'],
              applications: {
                'client-two': {
                  roles: ['operator'],
                  permissions: ['reports.read'],
                  scopes: ['reports'],
                  organization_ids: ['org-two'],
                  organizations: {
                    'org-two': { roles: ['member'], permissions: ['reports.read'], scopes: ['reports'] },
                  },
                },
              },
            },
          },
          hook: {
            version: 1,
            authentication_method: 'token_refresh',
            processed_at: '2026-07-20T00:00:00.000Z',
          },
        },
      },
    }));

    expect(validation.errors).toEqual([]);
  });

  it('rejects unknown or malformed root hook metadata', () => {
    const codes = validationCodes(JSON.stringify({
      app_metadata: {
        supaoauth: {
          schema_version: 2,
          projects: {},
          hook: {
            version: 2,
            authentication_method: '',
            processed_at: 'not-a-timestamp',
            injected: true,
          },
        },
      },
    }));

    expect(codes).toContain('unknownHookField');
    expect(codes).toContain('invalidHookField');
  });

  it('rejects fields that the current runtime projection does not emit', () => {
    expect(validationCodes(draftForProject({ org_ids: ['org-one'] })))
      .toContain('unsupportedOrgIds');
  });

  it('validates organization membership count and truncation markers', () => {
    const valid = validateExtensionDraft(draftForProject({
      organization_memberships: [{ organization_id: 'org-one', slug: 'acme', role: 'member' }],
      organization_memberships_total: 2,
      organization_memberships_truncated: true,
    }));
    const invalidTotalCodes = validationCodes(draftForProject({
      organization_memberships: [{ organization_id: 'org-one', slug: 'acme', role: 'member' }],
      organization_memberships_total: 0,
      organization_memberships_truncated: false,
    }));
    const invalidTruncationCodes = validationCodes(draftForProject({
      organization_memberships: [{ organization_id: 'org-one', slug: 'acme', role: 'member' }],
      organization_memberships_total: 2,
      organization_memberships_truncated: false,
    }));

    expect(valid.errors).toEqual([]);
    expect(invalidTotalCodes).toContain('organizationMembershipsTotal');
    expect(invalidTruncationCodes).toContain('organizationMembershipsTruncated');
  });

  it('rejects oversized membership fields, lists, and project bytes', () => {
    const oversizedMembership = {
      organization_id: 'o'.repeat(SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT + 1),
      slug: 'acme',
      role: 'member',
    };
    const oversizedMemberships = Array.from(
      { length: SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT + 1 },
      (_, index) => ({ organization_id: `org-${index}`, slug: `org-${index}`, role: 'member' }),
    );

    expect(validationCodes(draftForProject({
      organization_memberships: [oversizedMembership],
      organization_memberships_total: 1,
      organization_memberships_truncated: false,
    }))).toContain('invalidFieldType');
    expect(validationCodes(draftForProject({
      organization_memberships: oversizedMemberships,
      organization_memberships_total: oversizedMemberships.length,
      organization_memberships_truncated: false,
    }))).toContain('organizationMembershipsOverflow');
    expect(validationCodes(draftForProject({
      roles: [],
      rbac_synced_at: 'x'.repeat(SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT),
    }))).toContain('projectProjectionOverflow');
  });

  it('rejects multiple bounded projects that exceed the namespace budget together', () => {
    const projects = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
      `project-${index + 1}`,
      { roles: [], permissions: [], rbac_synced_at: 'x'.repeat(14_000) },
    ]));
    const codes = validationCodes(JSON.stringify({
      app_metadata: { supaoauth: { schema_version: 2, projects } },
    }));

    expect(SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT).toBe(64 * 1024);
    expect(codes).toContain('namespaceProjectionOverflow');
    expect(codes).not.toContain('projectProjectionOverflow');
  });

  it('rejects role and permission lists beyond the shared projection limits', () => {
    const roles = Array.from({ length: SUPAOAUTH_ROLE_PROJECTION_LIMIT + 1 }, (_, index) => `role-${index}`);
    const permissions = Array.from(
      { length: SUPAOAUTH_PERMISSION_PROJECTION_LIMIT + 1 },
      (_, index) => `permission-${index}`,
    );

    expect(validationCodes(draftForProject({ roles }))).toContain('projectionOverflow');
    expect(validationCodes(draftForProject({ permissions }))).toContain('projectionOverflow');
  });

  it('applies role and permission bounds inside organization and application projections', () => {
    const oversizedRoles = Array.from(
      { length: SUPAOAUTH_ROLE_PROJECTION_LIMIT + 1 },
      (_, index) => `role-${index}`,
    );
    const codes = validationCodes(draftForProject({
      organizations: { 'org-one': { roles: oversizedRoles } },
      applications: { 'client-one': { permissions: ['read', 'read'] } },
    }));

    expect(codes).toContain('projectionOverflow');
    expect(codes).toContain('projectionNormalization');
  });

  it('accepts the explicit fail-closed unavailable projection markers', () => {
    const validation = validateExtensionDraft(draftForProject({
      roles: [],
      permissions: [],
      scopes: [],
      organization_ids: [],
      organizations: {},
      applications: {},
      rbac_version: 7,
      roles_count: 70,
      permissions_count: 300,
      scopes_count: 20,
      organization_ids_count: 10,
      organizations_count: 10,
      applications_count: 5,
      truncated: true,
      projection_limit: 8192,
      projection_unavailable: true,
    }));

    expect(validation.errors).toEqual([]);
  });

  it('rejects incomplete or non-empty unavailable projections', () => {
    const codes = validationCodes(draftForProject({
      roles: ['admin'],
      permissions: [],
      scopes: [],
      organization_ids: [],
      organizations: {},
      applications: {},
      projection_unavailable: true,
    }));

    expect(codes).toContain('unavailableProjectionNotEmpty');
    expect(codes).toContain('unavailableProjectionTruncated');
    expect(codes).toContain('unavailableProjectionLimit');
    expect(codes).toContain('unavailableProjectionCount');
  });

  it('rejects list entries that runtime normalization would remove', () => {
    expect(validationCodes(draftForProject({ roles: ['admin', 'admin', ''] })))
      .toContain('projectionNormalization');
  });

  it('accepts the runtime truncation marker shape', () => {
    const validation = validateExtensionDraft(draftForProject({
      roles: [],
      roles_count: SUPAOAUTH_ROLE_PROJECTION_LIMIT + 1,
      roles_truncated: true,
      roles_projection_limit: SUPAOAUTH_ROLE_PROJECTION_LIMIT,
    }));

    expect(validation.errors).toEqual([]);
  });

  it('rejects inconsistent count and truncation markers', () => {
    expect(validationCodes(draftForProject({ roles: ['admin'], roles_count: 2 })))
      .toContain('projectionCountMismatch');
    expect(validationCodes(draftForProject({
      roles: ['admin'],
      roles_count: SUPAOAUTH_ROLE_PROJECTION_LIMIT + 1,
      roles_truncated: true,
      roles_projection_limit: SUPAOAUTH_ROLE_PROJECTION_LIMIT,
    }))).toContain('projectionTruncatedArray');
    expect(validationCodes(draftForProject({
      roles: [],
      roles_count: SUPAOAUTH_ROLE_PROJECTION_LIMIT + 1,
      roles_truncated: true,
      roles_projection_limit: SUPAOAUTH_ROLE_PROJECTION_LIMIT - 1,
    }))).toContain('projectionLimitMismatch');
  });
});
