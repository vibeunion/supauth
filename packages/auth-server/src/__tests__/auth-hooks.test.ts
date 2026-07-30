import { describe, expect, it } from 'bun:test';
import {
  AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS,
  buildHookRegistrationGuide,
  handleBeforeUserCreated,
  handleCustomAccessToken,
} from '../auth/hooks-bridge.js';

const noOrganizationMemberships = { items: [], total: 0, truncated: false };
const projectRef = 'project-one';

function claimsResult(result: ReturnType<typeof handleCustomAccessToken>) {
  if (!('claims' in result)) throw new Error(result.error.message);
  return result;
}

describe('Auth Hooks bridge', () => {
  it('blocks signups from blocked domains', () => {
    const result = handleBeforeUserCreated(
      { user: { email: 'user@blocked.example' } },
      { blocked_email_domains: ['blocked.example'] },
    );

    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.code).toBe('email_domain_blocked');
  });

  it('allows approved email domains and preserves empty success response', () => {
    const result = handleBeforeUserCreated(
      { user: { email: 'user@example.com' } },
      { allowed_email_domains: ['example.com'] },
    );

    expect(result).toEqual({});
  });

  it('enforces invite-only signup policy', () => {
    const result = handleBeforeUserCreated(
      { user: { email: 'user@example.com', user_metadata: {} } },
      { invite_only: true },
    );

    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.code).toBe('invitation_required');
  });

  it('adds hook marker without removing existing app metadata', () => {
    const result = handleCustomAccessToken({
      authentication_method: 'password',
      claims: {
        sub: 'user-1',
        role: 'authenticated',
        app_metadata: {
          provider: 'email',
          supaoauth: {
            schema_version: 2,
            projects: { [projectRef]: { roles: ['admin'] } },
          },
        },
      },
    }, noOrganizationMemberships, projectRef);

    const claims = claimsResult(result).claims;
    expect(claims.role).toBe('authenticated');
    expect((claims.app_metadata as any).provider).toBe('email');
    expect((claims.app_metadata as any).supaoauth.schema_version).toBe(2);
    expect((claims.app_metadata as any).supaoauth.projects[projectRef].roles).toEqual(['admin']);
    expect((claims.app_metadata as any).supaoauth.hook.version).toBe(1);
  });

  it('preserves Supabase required access token claims', () => {
    const requiredClaims = {
      iss: 'https://auth.example.test/auth/v1',
      aud: 'authenticated',
      exp: 1715690221,
      iat: 1715686621,
      sub: '8ccaa7af-909f-44e7-84cb-67cdccb56be6',
      role: 'authenticated',
      aal: 'aal2',
      session_id: '4b938a09-5372-4177-a314-cfa292099ea2',
      email: 'user@example.test',
      phone: '',
      is_anonymous: false,
    };

    const result = handleCustomAccessToken({
      authentication_method: 'oauth_provider/authorization_code',
      claims: {
        ...requiredClaims,
        app_metadata: { provider: 'email' },
        user_metadata: { name: 'Example User' },
      },
    }, noOrganizationMemberships, projectRef);

    for (const [claim, value] of Object.entries(requiredClaims)) {
      expect(claimsResult(result).claims[claim]).toEqual(value);
    }
    expect((claimsResult(result).claims.app_metadata as any).supaoauth.hook.authentication_method).toBe('oauth_provider/authorization_code');
    expect((claimsResult(result).claims.user_metadata as any).name).toBe('Example User');
  });

  it('keeps enterprise RBAC metadata under the current schema v2 project', () => {
    const result = handleCustomAccessToken({
      authentication_method: 'token_refresh',
      claims: {
        sub: 'user-1',
        role: 'authenticated',
        app_metadata: {
          supaoauth: {
            schema_version: 2,
            projects: {
              [projectRef]: {
                roles: ['xgic_admin'],
                rbac_version: 2,
                permissions_version: 3,
              },
            },
          },
        },
      },
    }, noOrganizationMemberships, projectRef);

    const claims = claimsResult(result).claims;
    expect(claims.role).toBe('authenticated');
    expect(claims.supaoauth).toBeUndefined();
    expect((claims.app_metadata as any).supaoauth.projects[projectRef].roles).toEqual(['xgic_admin']);
    expect((claims.app_metadata as any).supaoauth.projects[projectRef].permissions_version).toBe(3);
  });

  it('narrows OAuth tokens to the matching application without replacing OAuth scope', () => {
    const otherProject = { roles: ['other-project'], permissions: ['other.read'] };
    const result = handleCustomAccessToken({
      claims: {
        role: 'authenticated',
        client_id: 'app-a',
        scope: 'openid email',
        app_metadata: {
          provider: 'email',
          supaoauth: {
            schema_version: 2,
            projects: {
              [projectRef]: {
                roles: ['global'],
                permissions: ['global.read'],
                scopes: ['global-scope'],
                applications: {
                  'app-a': {
                    roles: ['app-a-role', 'global'],
                    permissions: ['app-a.read', 'global.read'],
                    scopes: ['app-a-scope', 'global-scope'],
                    organization_ids: ['org-a'],
                    organizations: {
                      'org-a': {
                        roles: ['app-a-org-role', 'app-a-role', 'global', 'org-a-role'],
                        permissions: ['app-a.org.approve', 'app-a.read', 'global.read', 'org-a.read'],
                        scopes: ['app-a-org-scope', 'app-a-scope', 'global-scope', 'org-a-scope'],
                      },
                    },
                  },
                  'app-b': {
                    roles: ['app-b-role'],
                    permissions: ['app-b.read'],
                    scopes: ['app-b-scope'],
                  },
                },
              },
              'project-two': otherProject,
            },
          },
        },
      },
    }, noOrganizationMemberships, projectRef);

    const claims = claimsResult(result).claims;
    const supaoauth = (claims.app_metadata as any).supaoauth;
    const projection = supaoauth.projects[projectRef];
    expect(claims.client_id).toBe('app-a');
    expect(claims.scope).toBe('openid email');
    expect((claims.app_metadata as any).provider).toBe('email');
    expect(supaoauth.projects['project-two']).toEqual(otherProject);
    expect(projection).toMatchObject({
      application_id: 'app-a',
      roles: ['app-a-role', 'global'],
      permissions: ['app-a.read', 'global.read'],
      scopes: ['app-a-scope', 'global-scope'],
      organization_ids: ['org-a'],
      organization_memberships: [],
    });
    expect(projection.organizations['org-a'].permissions).toEqual([
      'app-a.org.approve',
      'app-a.read',
      'global.read',
      'org-a.read',
    ]);
    expect(projection.applications).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain('app-b.read');
  });

  it('keeps only project inheritance for an unknown OAuth application', () => {
    const result = handleCustomAccessToken({
      claims: {
        role: 'authenticated',
        client_id: 'unknown-app',
        scope: 'openid',
        app_metadata: {
          supaoauth: {
            schema_version: 2,
            projects: {
              [projectRef]: {
                roles: ['global'],
                permissions: ['global.read'],
                scopes: ['global-scope'],
                organizations: {
                  'org-a': { roles: ['global', 'org-a-role'], permissions: ['global.read', 'org-a.read'] },
                },
                applications: {
                  'app-a': { roles: ['app-a-role'], permissions: ['app-a.read'] },
                },
              },
            },
          },
        },
      },
    }, noOrganizationMemberships, projectRef);

    const projection = (claimsResult(result).claims.app_metadata as any).supaoauth.projects[projectRef];
    expect(projection).toMatchObject({
      application_id: 'unknown-app',
      roles: ['global'],
      permissions: ['global.read'],
      scopes: ['global-scope'],
    });
    expect(projection.organizations['org-a'].permissions).toEqual(['global.read', 'org-a.read']);
    expect(projection.applications).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain('app-a.read');
  });

  it('preserves application namespaces for ordinary sessions and sticky empty application projections', () => {
    const applicationProjection = {
      roles: ['global'],
      permissions: ['global.read'],
      scopes: [],
      organization_ids: [],
      organizations: {},
    };
    const result = handleCustomAccessToken({
      claims: {
        role: 'authenticated',
        app_metadata: {
          supaoauth: {
            schema_version: 2,
            projects: {
              [projectRef]: {
                roles: ['global'],
                permissions: ['global.read'],
                applications: { 'app-a': applicationProjection },
              },
            },
          },
        },
      },
    }, noOrganizationMemberships, projectRef);

    const projection = (claimsResult(result).claims.app_metadata as any).supaoauth.projects[projectRef];
    expect(projection.application_id).toBeUndefined();
    expect(projection.applications).toEqual({ 'app-a': applicationProjection });
  });

  it('removes legacy top-level and root v1 SupaOAuth claims from custom access token output', () => {
    const result = handleCustomAccessToken({
      authentication_method: 'token_refresh',
      claims: {
        iss: 'https://auth.example.test/auth/v1',
        aud: 'authenticated',
        exp: 1715690221,
        iat: 1715686621,
        sub: 'user-1',
        role: 'authenticated',
        aal: 'aal1',
        session_id: 'session-1',
        email: 'user@example.test',
        phone: '',
        is_anonymous: false,
        supaoauth: { roles: ['injected'] },
        'supaoauth:roles': ['injected'],
        'supaoauth:org_id': 'org-injected',
        'supaoauth:org_role': 'owner',
        'supaoauth:scopes': ['admin'],
        'supaoauth:permissions': ['*'],
        app_metadata: {
          provider: 'email',
          supaoauth: {
            roles: ['xgic_admin'],
            permissions: ['xgic.read'],
          },
        },
        user_metadata: { name: 'Example User' },
      },
    }, noOrganizationMemberships, projectRef);

    for (const claim of AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS) {
      expect(claimsResult(result).claims[claim]).toBeUndefined();
    }

    const claims = claimsResult(result).claims;
    const appMetadata = claims.app_metadata as Record<string, unknown>;
    const supaoauth = appMetadata.supaoauth as Record<string, unknown>;
    expect(claims.role).toBe('authenticated');
    expect(claims.session_id).toBe('session-1');
    expect(supaoauth.schema_version).toBe(2);
    expect(supaoauth.roles).toBeUndefined();
    expect(supaoauth.permissions).toBeUndefined();
    expect((supaoauth.projects as Record<string, unknown>)[projectRef]).toMatchObject({
      organization_memberships: [],
      organization_memberships_total: 0,
      organization_memberships_truncated: false,
    });
    expect((claims.user_metadata as Record<string, unknown>).name).toBe('Example User');
  });

  it('updates only the current project and preserves other schema v2 projects', () => {
    const otherProject = { roles: ['other-admin'], permissions: ['other.manage'] };
    const result = handleCustomAccessToken({
      claims: {
        role: 'authenticated',
        app_metadata: {
          supaoauth: {
            schema_version: 2,
            projects: {
              [projectRef]: {
                roles: ['member'],
                organizations: {
                  'org-one': { roles: ['member'], permissions: ['documents.read'], scopes: [] },
                },
              },
              'project-two': otherProject,
            },
          },
        },
      },
    }, noOrganizationMemberships, projectRef);

    const supaoauth = (claimsResult(result).claims.app_metadata as any).supaoauth;
    expect(supaoauth.projects['project-two']).toEqual(otherProject);
    expect(supaoauth.projects[projectRef]).toMatchObject({
      roles: ['member'],
      organization_memberships: [],
    });
    expect(supaoauth.projects[projectRef].organizations).toEqual({
      'org-one': { roles: ['member'], permissions: ['documents.read'], scopes: [] },
    });
  });

  it('rejects business roles in the top-level Supabase role claim', () => {
    const result = handleCustomAccessToken({
      claims: { role: 'owner' },
    }, noOrganizationMemberships, projectRef);

    expect(result).toEqual({
      error: {
        http_code: 400,
        message: 'The top-level Supabase role claim is invalid.',
        code: 'invalid_supabase_role',
      },
    });
  });

  it('fails closed when the project claim context is missing', () => {
    const result = handleCustomAccessToken({ claims: { role: 'authenticated' } }, noOrganizationMemberships, '');

    expect(result).toMatchObject({
      error: {
        http_code: 500,
        code: 'invalid_project_claim_context',
      },
    });
  });

  it('fails closed for oversized organization membership fields or project bytes', () => {
    const oversizedMemberships = {
      items: [{ organization_id: 'o'.repeat(129), slug: 'acme', role: 'member' }],
      total: 1,
      truncated: false,
    };
    const oversizedProject = handleCustomAccessToken({
      claims: {
        role: 'authenticated',
        app_metadata: {
          supaoauth: {
            schema_version: 2,
            projects: { [projectRef]: { opaque: 'x'.repeat(16 * 1024) } },
          },
        },
      },
    }, noOrganizationMemberships, projectRef);

    expect(handleCustomAccessToken({ claims: { role: 'authenticated' } }, oversizedMemberships, projectRef))
      .toMatchObject({ error: { code: 'claim_projection_overflow' } });
    expect(oversizedProject).toMatchObject({ error: { code: 'claim_projection_overflow' } });
  });

  it('fails closed when individually bounded projects exceed the namespace budget together', () => {
    const projects = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
      `project-${index + 1}`,
      { roles: [], permissions: [], rbac_synced_at: 'x'.repeat(14_000) },
    ]));
    const result = handleCustomAccessToken({
      claims: {
        role: 'authenticated',
        app_metadata: { supaoauth: { schema_version: 2, projects } },
      },
    }, noOrganizationMemberships, projectRef);

    expect(result).toMatchObject({
      error: {
        http_code: 500,
        code: 'claim_projection_overflow',
      },
    });
    expect(result).not.toHaveProperty('claims');
  });

  it('does not re-expand a fail-closed unavailable project with JIT memberships', () => {
    const result = handleCustomAccessToken({
      claims: {
        role: 'authenticated',
        app_metadata: {
          supaoauth: {
            schema_version: 2,
            projects: {
              [projectRef]: {
                roles: [],
                permissions: [],
                scopes: [],
                organization_ids: [],
                organizations: {},
                applications: {},
                projection_unavailable: true,
              },
            },
          },
        },
      },
    }, {
      items: [{ organization_id: 'org-one', slug: 'acme', role: 'member' }],
      total: 1,
      truncated: false,
    }, projectRef);

    const projection = (claimsResult(result).claims.app_metadata as any).supaoauth.projects[projectRef];
    expect(projection.projection_unavailable).toBe(true);
    expect(projection.organization_memberships).toBeUndefined();
  });

  it('builds hook registration URLs', () => {
    const guide = buildHookRegistrationGuide('https://auth.example.com/');

    expect(guide.before_user_created).toBe('https://auth.example.com/v1/auth-hooks/before-user-created');
    expect(guide.protocol).toBe('standard-webhooks-v1');
    expect(guide.required_headers).toEqual(['webhook-id', 'webhook-timestamp', 'webhook-signature']);
  });
});
