// Stock GoTrue HTTP Auth Hook routes. Standard Webhooks signatures authenticate
// the two public ceremony endpoints before any policy or claim logic runs.

import { Elysia } from 'elysia';
import {
  buildHookRegistrationGuide,
  handleBeforeUserCreated,
  handleCustomAccessToken,
  type AuthHookError,
  type CustomAccessTokenPayload,
  type OrganizationMembershipClaims,
  type SignupPolicy,
} from '../auth/hooks-bridge.js';
import {
  StandardWebhookEnvelopeError,
  standardWebhookMessage,
  type GoTrueHttpHookName,
  type StandardWebhookMessage,
} from '../auth/standard-webhooks.js';
import { getConfig } from '../config/index.js';
import { standardWebhookBodyCapture } from '../middleware/standard-webhooks.js';
import { getSupaCloudAdapter, isSupaCloudApiError } from '../supacloud/adapter.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();
const MAX_ORGANIZATION_CLAIMS = 50;
const HOOK_PROBE_FIELD = 'supaoauth_hook_probe';

async function getSignupPolicy(): Promise<SignupPolicy> {
  const config = await tenantConfigRepo.getTenantConfig('auth_hook', 'signup_policy');
  return (config?.enabled && typeof config.value === 'object' && config.value) ? config.value as SignupPolicy : {};
}

async function auditHook(eventType: string, result: Record<string, unknown>) {
  await auditRepo.logAudit({
    eventType,
    resourceType: 'auth_hook',
    resourceId: eventType,
    actorType: 'system',
    details: result,
  });
}

function hookUserId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  const claims = payload.claims && typeof payload.claims === 'object' && !Array.isArray(payload.claims)
    ? payload.claims as Record<string, unknown>
    : {};
  const userId = typeof payload.user_id === 'string' ? payload.user_id.trim() : '';
  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (userId && subject && userId !== subject) return null;
  return userId || subject || null;
}

function organizationMembershipClaims(upstream: unknown): OrganizationMembershipClaims {
  if (!upstream || typeof upstream !== 'object' || Array.isArray(upstream)) throw invalidJitResponse();
  const response = upstream as Record<string, unknown>;
  if (!Array.isArray(response.items) || response.items.length > MAX_ORGANIZATION_CLAIMS) {
    throw invalidJitResponse();
  }
  const items = response.items.map(organizationMembershipClaim);
  if (!Number.isInteger(response.total) || (response.total as number) < items.length) throw invalidJitResponse();
  return {
    items,
    total: response.total as number,
    truncated: (response.total as number) > items.length,
  };
}

function organizationMembershipClaim(membership: unknown) {
  if (!membership || typeof membership !== 'object' || Array.isArray(membership)) throw invalidJitResponse();
  const record = membership as Record<string, unknown>;
  if (
    typeof record.organization_id !== 'string'
    || typeof record.slug !== 'string'
    || typeof record.role !== 'string'
  ) throw invalidJitResponse();
  return {
    organization_id: record.organization_id,
    slug: record.slug,
    role: record.role,
  };
}

function invalidJitResponse() {
  return new ApiContractError(
    502,
    'invalid_upstream_response',
    'SupaCloud organization JIT response has an invalid shape',
  );
}

function hookFailure(httpCode: number, message: string, code: string): AuthHookError {
  return { error: { http_code: httpCode, message, code } };
}

function platformVerificationFailure(status: number): Response {
  return new Response('Auth hook verification is unavailable', {
    status,
    headers: status === 503 ? { 'Retry-After': '1' } : undefined,
  });
}

async function authenticateHookRequest(
  request: Request,
  hookName: GoTrueHttpHookName,
): Promise<Response | null> {
  let message: StandardWebhookMessage;
  try {
    message = await standardWebhookMessage(request);
  } catch (error) {
    if (error instanceof StandardWebhookEnvelopeError) {
      return new Response('Unauthorized auth hook request', { status: 401 });
    }
    throw error;
  }
  try {
    const verification = await adapter.verifyAuthHookMessage(hookName, message);
    return verification.verified && verification.consumed
      ? null
      : new Response('Unauthorized auth hook request', { status: 401 });
  } catch (error) {
    if (isSupaCloudApiError(error, [404, 501, 503])) {
      return platformVerificationFailure(error.status);
    }
    return platformVerificationFailure(503);
  }
}

function syntheticProbe(body: unknown, hookName: GoTrueHttpHookName): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const probe = (body as Record<string, unknown>)[HOOK_PROBE_FIELD];
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) return false;
  const fields = probe as Record<string, unknown>;
  return fields.version === 1
    && fields.hook_name === hookName
    && fields.project_ref === getConfig().projectRef;
}

function syntheticProbeResponse(hookName: GoTrueHttpHookName) {
  return {
    [HOOK_PROBE_FIELD]: {
      verified: true,
      protocol: 'standard-webhooks-v1',
      hook_name: hookName,
      project_ref: getConfig().projectRef,
    },
  };
}

function isNetworkTypeError(error: unknown): boolean {
  return error instanceof TypeError
    && /fetch|network|connect|socket|timed?\s*out|abort/i.test(error.message);
}

function recoverableOrganizationJitError(error: unknown): boolean {
  return isSupaCloudApiError(error)
    || error instanceof ApiContractError
    || error instanceof SyntaxError
    || isNetworkTypeError(error)
    || (error instanceof DOMException && error.name === 'AbortError');
}

async function customAccessTokenWithJit(body: unknown) {
  const userId = hookUserId(body);
  if (!userId) {
    return hookFailure(400, 'A GoTrue user_id or subject claim is required.', 'invalid_custom_access_token_payload');
  }
  try {
    const memberships = organizationMembershipClaims(await adapter.reconcileOrganizationJitMemberships(userId));
    return handleCustomAccessToken(body as CustomAccessTokenPayload, memberships, getConfig().projectRef);
  } catch (error) {
    if (!recoverableOrganizationJitError(error)) throw error;
    return hookFailure(
      503,
      'Organization membership reconciliation is unavailable.',
      'organization_jit_reconciliation_failed',
    );
  }
}

async function verifyInvitation(body: unknown) {
  const payload = body as {
    user?: {
      email?: string | null;
      app_metadata?: Record<string, unknown>;
      user_metadata?: Record<string, unknown>;
    };
    metadata?: Record<string, unknown>;
  };
  const sources = [payload.metadata, payload.user?.app_metadata, payload.user?.user_metadata];
  const invitationId = invitationField(sources, 'invitation_id');
  const invitationToken = invitationField(sources, 'invitation_token');
  if (!invitationId && !invitationToken) return false;
  const verified = await adapter.verifySignupInvitation({
    invitation_id: invitationId,
    invitation_token: invitationToken,
    email: payload.user?.email,
  });
  return Boolean(verified && typeof verified === 'object' && (verified as Record<string, unknown>).valid === true);
}

function invitationField(sources: Array<Record<string, unknown> | undefined>, field: string) {
  for (const source of sources) {
    if (typeof source?.[field] === 'string') return source[field] as string;
  }
  return undefined;
}

export const authHookRoutes = new Elysia({ prefix: '/v1/auth-hooks' })
  .use(standardWebhookBodyCapture)
  .post('/before-user-created', async ({ request, body }) => {
    const unauthorized = await authenticateHookRequest(request, 'before-user-created');
    if (unauthorized) return unauthorized;
    if (syntheticProbe(body, 'before-user-created')) return syntheticProbeResponse('before-user-created');
    const policy = await getSignupPolicy();
    const invitationVerified = policy.invite_only ? await verifyInvitation(body) : false;
    const result = handleBeforeUserCreated(body as never, policy, { invitation_verified: invitationVerified });
    await auditHook('auth_hook.before_user_created', { denied: 'error' in result, code: hookErrorCode(result) });
    return result;
  }, {
    detail: {
      summary: 'Supabase before-user-created hook',
      description: 'Applies tenant signup policy such as domain allow/block lists, provider allow/block lists, and invite-only mode.',
      tags: ['Auth Hooks'],
    },
  })

  .post('/custom-access-token', async ({ request, body }) => {
    const unauthorized = await authenticateHookRequest(request, 'custom-access-token');
    if (unauthorized) return unauthorized;
    if (syntheticProbe(body, 'custom-access-token')) return syntheticProbeResponse('custom-access-token');
    const result = await customAccessTokenWithJit(body);
    await auditHook('auth_hook.custom_access_token', {
      processed: !('error' in result),
      code: hookErrorCode(result),
    });
    return result;
  }, {
    detail: {
      summary: 'Supabase custom-access-token hook',
      description: 'Reconciles GoTrue-backed organization JIT memberships under app_metadata.supaoauth.projects[projectRef] while preserving Supabase required claims.',
      tags: ['Auth Hooks'],
    },
  });

export const authHookAdminRoutes = new Elysia({ prefix: '/v1/auth-hooks' })
  .get('/registration-guide', ({ request }) => buildHookRegistrationGuide(new URL(request.url).origin), {
    detail: {
      summary: 'Get GoTrue HTTP Auth Hook registration guide',
      tags: ['Auth Hooks'],
    },
  })
  .get('/custom-access-token/status', async () => {
    return authHookStatus('custom-access-token');
  }, {
    detail: {
      summary: 'Get GoTrue custom access-token hook registration status',
      tags: ['Auth Hooks'],
    },
  })
  .post('/custom-access-token/verify', async () => {
    return adapter.verifyAuthHook('custom-access-token');
  }, {
    detail: {
      summary: 'Run a synthetic GoTrue custom access-token hook verification',
      tags: ['Auth Hooks'],
    },
  })
  .get('/before-user-created/status', async () => {
    return authHookStatus('before-user-created');
  }, {
    detail: {
      summary: 'Get GoTrue before-user-created hook registration status',
      tags: ['Auth Hooks'],
    },
  })
  .post('/before-user-created/verify', async () => {
    return adapter.verifyAuthHook('before-user-created');
  }, {
    detail: {
      summary: 'Run a synthetic GoTrue before-user-created hook verification',
      tags: ['Auth Hooks'],
    },
  });

async function authHookStatus(hookName: GoTrueHttpHookName) {
  const status = await adapter.getAuthHookStatus(hookName);
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    throw new ApiContractError(502, 'invalid_upstream_response', 'GoTrue hook status has an invalid shape');
  }
  return status;
}

function hookErrorCode(result: unknown): string | null {
  if (!result || typeof result !== 'object' || !('error' in result)) return null;
  const error = (result as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
