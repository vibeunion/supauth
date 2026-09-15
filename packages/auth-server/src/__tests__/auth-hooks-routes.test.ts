import { strictProperty } from './helpers/strict-values.js';
import { strictRecord } from './helpers/strict-values.js';
import { createHmac, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const reconcileOrganizationJitMemberships = mock(async () => ({
  items: [{ organization_id: 'org-one', slug: 'acme', role: 'member' }],
  total: 1,
  limit: 50,
  truncated: false,
}));
type HookMessageVerification = {
  verified: boolean;
  consumed: boolean;
  reason_code: string | null;
};

const verifyAuthHookMessage = mock(async (): Promise<HookMessageVerification> => ({
  verified: true,
  consumed: true,
  reason_code: null,
}));
const getTenantConfig = mock(async (): Promise<{
  enabled: boolean; value: { invite_only?: boolean };
} | null> => null);
const verifySignupInvitation = mock(async () => ({ valid: true }));
const logAudit = mock(async () => ({}));
const getAuthHooks = mock(async () => ({
  custom_access_token_hook: {
    enabled: true,
    uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
    secrets_configured: true,
    secrets: '********',
  },
}));
const updateAuthHooks = mock(async () => ({ accepted: true }));

class MockSupaCloudApiError extends Error {
  constructor(public status: number) {
    super(`SupaCloud ${status}`);
  }
}

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: MockSupaCloudApiError,
  isSupaCloudApiError: (error: unknown, statuses?: number[]) => (
    error instanceof Error
    && 'status' in error
    && typeof error.status === 'number'
    && (!statuses || statuses.includes(error.status))
  ),
  getSupaCloudAdapter: () => ({
    verifyAuthHookMessage,
    reconcileOrganizationJitMemberships,
    verifySignupInvitation,
    getAuthHooks,
    updateAuthHooks,
    getAuthHookStatus: mock(async () => ({})),
    verifyAuthHook: mock(async () => ({})),
  }),
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));
mock.module('../repositories/tenant-config.js', () => ({ getTenantConfig }));
mock.module('../repositories/security-config.js', () => ({
  getSecurityConfig: mock(async () => null),
}));

const projectRef = 'project-one';
process.env["PROJECT_REF"] = projectRef;
process.env["SUPAUTH_PUBLIC_URL"] = 'https://auth.example.test';
process.env["SUPAUTH_API_URL"] = 'https://api.example.test';
const {
  authHookRoutes,
  authHookAdminRoutes,
  customAccessTokenHookUpdate,
} = await import('../routes/auth-hooks.js');
const { getConfig } = await import('../config/index.js');
const { adminAuthGuard } = await import('../auth/index.js');
const app = new Elysia().use(authHookRoutes);
const boundaryApp = new Elysia()
  .use(authHookRoutes)
  .use(adminAuthGuard)
  .use(authHookAdminRoutes);
const encodedSecret = Buffer.from('standard-webhooks-test-key').toString('base64');

type HookName = 'before-user-created' | 'custom-access-token';

function standardHeaders(body: string) {
  const webhookId = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(encodedSecret, 'base64'))
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest('base64');
  return {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
}

function hookRequest(
  hookName: HookName,
  payload: unknown,
) {
  const body = JSON.stringify(payload);
  const headers = standardHeaders(body);
  return app.handle(new Request(`http://localhost/v1/auth-hooks/${hookName}`, {
    method: 'POST',
    headers,
    body,
  }));
}

describe('stock GoTrue HTTP Auth Hook routes', () => {
  beforeEach(() => {
    verifyAuthHookMessage.mockClear();
    verifyAuthHookMessage.mockResolvedValue({ verified: true, consumed: true, reason_code: null });
    reconcileOrganizationJitMemberships.mockClear();
    reconcileOrganizationJitMemberships.mockResolvedValue({
      items: [{ organization_id: 'org-one', slug: 'acme', role: 'member' }],
      total: 1,
      limit: 50,
      truncated: false,
    });
    getTenantConfig.mockClear();
    verifySignupInvitation.mockClear();
    logAudit.mockClear();
    getAuthHooks.mockClear();
    updateAuthHooks.mockClear();
  });

  it.each([{ metadata: null }, { metadata: [] }, []].map(payload => ({ payload })))(
    'preserves verified legacy signup containers without changing the signed bytes: %j',
    async ({ payload }) => {
      const events: string[] = [];
      verifyAuthHookMessage.mockImplementationOnce(async () => {
        events.push('signature');
        return { verified: true, consumed: true, reason_code: null };
      });
      getTenantConfig.mockImplementationOnce(async () => { events.push('policy'); return null; });
      logAudit.mockImplementationOnce(async () => { events.push('audit'); return {}; });
      const response = await hookRequest('before-user-created', payload);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(verifyAuthHookMessage).toHaveBeenCalledWith('before-user-created', expect.objectContaining({
        body_base64: Buffer.from(JSON.stringify(payload)).toString('base64'),
      }));
      expect(events).toEqual(['signature', 'policy', 'audit']);
      expect(reconcileOrganizationJitMemberships).not.toHaveBeenCalled();
    },
  );

  it.each([{ metadata: null }, { metadata: [] }, []].map(payload => ({ payload })))(
    'does not turn ignored signup metadata into an invitation: %j',
    async ({ payload }) => {
      getTenantConfig.mockResolvedValueOnce({ enabled: true, value: { invite_only: true } });
      const response = await hookRequest('before-user-created', payload);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ error: { http_code: 403, code: 'invitation_required' } });
      expect(verifySignupInvitation).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledTimes(1);
    },
  );

  it('normalizes signed null app_metadata only after JIT and preserves the claims projection', async () => {
    const events: string[] = [];
    verifyAuthHookMessage.mockImplementationOnce(async () => {
      events.push('signature');
      return { verified: true, consumed: true, reason_code: null };
    });
    reconcileOrganizationJitMemberships.mockImplementationOnce(async () => {
      events.push('jit');
      return { items: [], total: 0, limit: 50, truncated: false };
    });
    logAudit.mockImplementationOnce(async () => { events.push('audit'); return {}; });
    const response = await hookRequest('custom-access-token', {
      user_id: 'gotrue-user',
      claims: { sub: 'gotrue-user', role: 'authenticated', app_metadata: null, custom: { kept: true } },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claims: {
        sub: 'gotrue-user', role: 'authenticated', custom: { kept: true },
        app_metadata: { supaoauth: { schema_version: 2, projects: { [projectRef]: {
          organization_memberships: [], organization_memberships_total: 0,
        } } } },
      },
    });
    expect(events).toEqual(['signature', 'jit', 'audit']);
    expect(reconcileOrganizationJitMemberships).toHaveBeenCalledTimes(1);
  });

  it('retains invitation proofs in user metadata while normalizing empty top-level metadata', async () => {
    getTenantConfig.mockResolvedValueOnce({ enabled: true, value: { invite_only: true } });
    const response = await hookRequest('before-user-created', {
      metadata: null,
      user: { email: 'user@example.test', app_metadata: { invitation_id: 'invitation-fixture' } },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(verifySignupInvitation).toHaveBeenCalledWith({
      invitation_id: 'invitation-fixture', email: 'user@example.test',
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('still reports invalid claims after the existing JIT call when app_metadata is null', async () => {
    const response = await hookRequest('custom-access-token', {
      user_id: 'gotrue-user',
      claims: { sub: 'gotrue-user', role: 'project_admin', app_metadata: null },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ error: { http_code: 400, code: 'invalid_supabase_role' } });
    expect(reconcileOrganizationJitMemberships).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('rejects unverified legacy containers before policy, JIT or audit', async () => {
    for (const hook of ['before-user-created', 'custom-access-token'] as const) {
      verifyAuthHookMessage.mockResolvedValueOnce({ verified: false, consumed: false, reason_code: 'invalid' });
      const response = await hookRequest(hook, { user_id: 'gotrue-user', metadata: null, claims: { app_metadata: null } });
      expect(response.status).toBe(401);
    }
    expect(getTenantConfig).not.toHaveBeenCalled();
    expect(reconcileOrganizationJitMemberships).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('retains signed payload role and OAuth client validation error codes', async () => {
    for (const [claims, code] of [
      [{ sub: 'gotrue-user', role: 'project_admin' }, 'invalid_supabase_role'],
      [{ sub: 'gotrue-user', role: 'authenticated', client_id: 17 }, 'invalid_oauth_client_id'],
    ] as const) {
      const response = await hookRequest('custom-access-token', { user_id: 'gotrue-user', claims });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ error: { http_code: 400, code } });
      expect(verifyAuthHookMessage).toHaveBeenCalled();
    }
  });

  it('reconciles the signed GoTrue subject and preserves required Supabase claims', async () => {
    const requiredClaims = {
      iss: 'https://auth.example.test/auth/v1',
      aud: 'authenticated',
      exp: 1715690221,
      iat: 1715686621,
      sub: 'gotrue-user',
      role: 'authenticated',
      aal: 'aal2',
      session_id: 'session-one',
      email: 'user@example.test',
      phone: '',
      is_anonymous: false,
    };
    const response = await hookRequest('custom-access-token', {
      user_id: 'gotrue-user',
      authentication_method: 'token_refresh',
      claims: {
        ...requiredClaims,
        app_metadata: {
          provider: 'email',
          supaoauth: {
            schema_version: 2,
            projects: { [projectRef]: { roles: ['admin'] } },
          },
        },
      },
    });

    expect(response.status).toBe(200);
    const body = strictRecord(await response.json());
    for (const [claim, value] of Object.entries(requiredClaims)) {
      expect(strictProperty(body["claims"], claim)).toEqual(value);
    }
    expect(strictProperty(body["claims"], "app_metadata", "supaoauth", "schema_version")).toBe(2);
    expect(strictProperty(body["claims"], "app_metadata", "supaoauth", "projects", projectRef)).toMatchObject({
      roles: ['admin'],
      organization_memberships: [{ organization_id: 'org-one', slug: 'acme', role: 'member' }],
      organization_memberships_total: 1,
      organization_memberships_truncated: false,
    });
    expect(reconcileOrganizationJitMemberships).toHaveBeenCalledWith('gotrue-user');
    expect(verifyAuthHookMessage).toHaveBeenCalledTimes(1);
  });

  it('fails closed with an explicit hook error when JIT reconciliation fails', async () => {
    reconcileOrganizationJitMemberships.mockRejectedValueOnce(new MockSupaCloudApiError(503));
    const response = await hookRequest('custom-access-token', {
      user_id: 'gotrue-user',
      claims: { sub: 'gotrue-user', role: 'authenticated' },
    });
    const body = strictRecord(await response.json());

    expect(body["error"]).toMatchObject({
      http_code: 503,
      code: 'organization_jit_reconciliation_failed',
    });
    expect(body).not.toHaveProperty('claims');
  });

  it('maps network failures to the recoverable JIT hook error', async () => {
    reconcileOrganizationJitMemberships.mockRejectedValueOnce(new TypeError('fetch failed'));
    const response = await hookRequest('custom-access-token', {
      user_id: 'gotrue-user',
      claims: { sub: 'gotrue-user', role: 'authenticated' },
    });
    const body = strictRecord(await response.json());

    expect(body["error"]).toMatchObject({
      http_code: 503,
      code: 'organization_jit_reconciliation_failed',
    });
  });

  it('does not disguise unknown programming errors as recoverable JIT failures', async () => {
    reconcileOrganizationJitMemberships.mockRejectedValueOnce(new Error('programming bug'));
    const response = await hookRequest('custom-access-token', {
      user_id: 'gotrue-user',
      claims: { sub: 'gotrue-user', role: 'authenticated' },
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('organization_jit_reconciliation_failed');
  });

  it('forwards exact raw body bytes and stops when the platform rejects tampering', async () => {
    const payload = { claims: { sub: 'gotrue-user', role: 'authenticated' } };
    verifyAuthHookMessage.mockResolvedValueOnce({
      verified: false,
      consumed: false,
      reason_code: 'standard_webhook_signature_invalid',
    });
    const response = await hookRequest('custom-access-token', payload);

    expect(response.status).toBe(401);
    expect(verifyAuthHookMessage).toHaveBeenCalledWith('custom-access-token', expect.objectContaining({
      body_base64: Buffer.from(JSON.stringify(payload)).toString('base64'),
    }));
    expect(reconcileOrganizationJitMemberships).not.toHaveBeenCalled();
  });

  it('rejects replayed webhook IDs after a valid signature', async () => {
    verifyAuthHookMessage.mockResolvedValueOnce({
      verified: true,
      consumed: false,
      reason_code: 'standard_webhook_replay_detected',
    });
    const response = await hookRequest('custom-access-token', {
      claims: { sub: 'gotrue-user', role: 'authenticated' },
    });

    expect(response.status).toBe(401);
    expect(reconcileOrganizationJitMemberships).not.toHaveBeenCalled();
  });

  it('preserves platform 404, 501, and 503 verification failures', async () => {
    for (const status of [404, 501, 503]) {
      verifyAuthHookMessage.mockRejectedValueOnce(new MockSupaCloudApiError(status));
      const response = await hookRequest('custom-access-token', {
        claims: { sub: 'gotrue-user', role: 'authenticated' },
      });
      expect(response.status).toBe(status);
      expect(reconcileOrganizationJitMemberships).not.toHaveBeenCalled();
    }
  });

  it('does not accept the removed custom secret header', async () => {
    const response = await app.handle(new Request('http://localhost/v1/auth-hooks/custom-access-token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-supaoauth-hook-secret': 'removed-header',
      },
      body: JSON.stringify({ claims: { sub: 'gotrue-user', role: 'authenticated' } }),
    }));

    expect(response.status).toBe(401);
    expect(verifyAuthHookMessage).not.toHaveBeenCalled();
  });

  it('leaves only the two exact ceremony POST paths outside the Admin guard', async () => {
    const beforeUserCreated = await boundaryApp.handle(new Request(
      'http://localhost/v1/auth-hooks/before-user-created',
      { method: 'POST', headers: standardHeaders('{}'), body: '{}' },
    ));
    const customAccessTokenBody = JSON.stringify({
      claims: { sub: 'gotrue-user', role: 'authenticated' },
    });
    const customAccessToken = await boundaryApp.handle(new Request(
      'http://localhost/v1/auth-hooks/custom-access-token',
      { method: 'POST', headers: standardHeaders(customAccessTokenBody), body: customAccessTokenBody },
    ));

    expect(beforeUserCreated.status).toBe(200);
    expect(customAccessToken.status).toBe(200);
    for (const path of [
      '/v1/auth-hooks/registration-guide',
      '/v1/auth-hooks/custom-access-token/config',
      '/v1/auth-hooks/custom-access-token/status',
      '/v1/auth-hooks/before-user-created/status',
    ]) {
      const response = await boundaryApp.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(401);
    }
    const removedMfaHook = await boundaryApp.handle(new Request(
      'http://localhost/v1/auth-hooks/mfa-verification-attempt',
      { method: 'POST' },
    ));
    expect(removedMfaHook.status).toBe(404);
  });

  it('reads and updates the authoritative hook config without returning a secret', async () => {
    const adminApp = new Elysia().use(authHookAdminRoutes);
    const readResponse = await adminApp.handle(new Request(
      'http://localhost/v1/auth-hooks/custom-access-token/config',
    ));
    const updateResponse = await adminApp.handle(new Request(
      'http://localhost/v1/auth-hooks/custom-access-token/config',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
          secret: `v1,whsec_${encodedSecret}`,
        }),
      },
    ));

    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toEqual({
      enabled: true,
      uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
      secret_configured: true,
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({
      enabled: true,
      uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
      secret_configured: true,
    });
    expect(getAuthHooks).toHaveBeenCalledTimes(3);
    expect(updateAuthHooks).toHaveBeenCalledWith({
      custom_access_token_hook: {
        enabled: true,
        uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
        secrets: `v1,whsec_${encodedSecret}`,
      },
    });
  });

  it('rejects the configured API host when it differs from the public hook origin', async () => {
    const adminApp = new Elysia().use(authHookAdminRoutes);
    const response = await adminApp.handle(new Request(
      'http://localhost/v1/auth-hooks/custom-access-token/config',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          uri: 'https://api.example.test/api/v1/auth-hooks/custom-access-token',
        }),
      },
    ));

    expect(response.status).toBe(400);
    expect(updateAuthHooks).not.toHaveBeenCalled();
  });

  it('rejects unsafe hook URLs, masked secrets, and extra fields at the boundary', () => {
    const hookUri = 'https://auth.example.test/api/v1/auth-hooks/custom-access-token';
    const authoritativeBaseUrl = 'https://auth.example.test';
    for (const invalidConfig of [
      { enabled: true, uri: 'http://auth.example.test/api/v1/auth-hooks/custom-access-token' },
      { enabled: true, uri: 'https://other.example.test/api/v1/auth-hooks/custom-access-token' },
      { enabled: true, uri: 'https://auth.example.test/v1/auth-hooks/custom-access-token' },
      { enabled: true, uri: `${hookUri}?probe=true` },
      { enabled: true, uri: `${hookUri}#probe` },
      { enabled: true, uri: 'https://user:secret@auth.example.test/api/v1/auth-hooks/custom-access-token' },
      { enabled: true, uri: hookUri, secret: '********' },
      { enabled: true, uri: hookUri, secret: 42 },
      { enabled: true, uri: hookUri, project_ref: 'other' },
      { enabled: true, uri: hookUri },
      { enabled: true, uri: hookUri, secret: 'v1,whsec_AA==' },
      { enabled: true, uri: hookUri, secret: `v1,whsec_${Buffer.alloc(23, 1).toString('base64')}` },
      { enabled: true, uri: hookUri, secret: `v1,whsec_${Buffer.alloc(65, 1).toString('base64')}` },
      { enabled: true, uri: hookUri, secret: `v1,whsec_${Buffer.alloc(24, 1).toString('base64').slice(0, -1)}` },
    ]) expect(() => customAccessTokenHookUpdate(invalidConfig, false, authoritativeBaseUrl)).toThrow();
    expect(customAccessTokenHookUpdate({ enabled: false, uri: '' }, false, authoritativeBaseUrl)).toEqual({
      custom_access_token_hook: { enabled: false, uri: '' },
    });
    expect(customAccessTokenHookUpdate({
      enabled: true,
      uri: hookUri,
    }, true, authoritativeBaseUrl)).toEqual({
      custom_access_token_hook: {
        enabled: true,
        uri: hookUri,
      },
    });
    for (const keyLength of [24, 64]) {
      const secret = `v1,whsec_${Buffer.alloc(keyLength, 1).toString('base64')}`;
      expect(customAccessTokenHookUpdate({
        enabled: true,
        uri: hookUri,
        secret,
      }, false, authoritativeBaseUrl))
        .toEqual({
          custom_access_token_hook: { enabled: true, uri: hookUri, secrets: secret },
        });
    }
  });

  it('answers a signed capability probe without running business side effects', async () => {
    const response = await hookRequest('before-user-created', {
      supaoauth_hook_probe: {
        version: 1,
        hook_name: 'before-user-created',
        project_ref: getConfig().projectRef,
      },
    });
    const body = strictRecord(await response.json());

    expect(response.status).toBe(200);
    expect(body["supaoauth_hook_probe"]).toMatchObject({
      verified: true,
      protocol: 'standard-webhooks-v1',
      hook_name: 'before-user-created',
    });
    expect(getTenantConfig).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('keeps the organization claim list bounded and reports truncation', async () => {
    reconcileOrganizationJitMemberships.mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({
        organization_id: `org-${index}`,
        slug: `organization-${index}`,
        role: 'member',
      })),
      total: 60,
      limit: 50,
      truncated: true,
    });
    const response = await hookRequest('custom-access-token', {
      claims: { sub: 'gotrue-user', role: 'authenticated' },
    });
    const body = strictRecord(await response.json());

    const projection = strictProperty(body["claims"], "app_metadata", "supaoauth", "projects", projectRef);
    expect(strictProperty(projection, 'organization_memberships')).toHaveLength(50);
    expect(strictProperty(projection, 'organization_memberships_total')).toBe(60);
    expect(strictProperty(projection, 'organization_memberships_truncated')).toBe(true);
  });

  it('fails closed when JIT membership fields exceed the token projection budget', async () => {
    reconcileOrganizationJitMemberships.mockResolvedValueOnce({
      items: [{ organization_id: 'o'.repeat(129), slug: 'acme', role: 'member' }],
      total: 1,
      limit: 50,
      truncated: false,
    });
    const response = await hookRequest('custom-access-token', {
      claims: { sub: 'gotrue-user', role: 'authenticated' },
    });
    const body = strictRecord(await response.json());

    expect(body["error"]).toMatchObject({
      http_code: 500,
      code: 'claim_projection_overflow',
    });
    expect(body).not.toHaveProperty('claims');
  });
});
