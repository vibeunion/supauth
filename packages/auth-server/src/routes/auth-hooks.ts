// Supabase Auth Hooks bridge routes.
// These endpoints are intentionally registered before adminAuthGuard and use
// an independent hook secret so Supabase Auth can call them without admin API tokens.

import { Elysia } from 'elysia';
import {
  buildHookRegistrationGuide,
  handleBeforeUserCreated,
  handleCustomAccessToken,
  handleMfaVerificationAttempt,
  type SignupPolicy,
} from '../auth/hooks-bridge.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import * as auditRepo from '../repositories/audit.js';

function getHookSecret(): string {
  return process.env.SUPAOAUTH_AUTH_HOOK_SECRET || '';
}

function getHeaderValue(headers: Headers | Record<string, string | undefined>, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const direct = headers[name] || headers[name.toLowerCase()];
  if (direct) return direct;
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] || null;
}

function verifyHookSecret(headers: Headers | Record<string, string | undefined>): Response | null {
  const expected = getHookSecret();
  if (!expected) return new Response('SUPAOAUTH_AUTH_HOOK_SECRET is not configured', { status: 503 });

  const provided = getHeaderValue(headers, 'x-supaoauth-hook-secret') || getHeaderValue(headers, 'authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!provided || provided !== expected) return new Response('Unauthorized auth hook request', { status: 401 });
  return null;
}

async function getSignupPolicy(): Promise<SignupPolicy> {
  try {
    const config = await tenantConfigRepo.getTenantConfig('auth_hook', 'signup_policy');
    return (config?.enabled && typeof config.value === 'object' && config.value) ? config.value as SignupPolicy : {};
  } catch {
    return {};
  }
}

async function auditHook(eventType: string, result: Record<string, unknown>) {
  try {
    await auditRepo.logAudit({
      eventType,
      resourceType: 'auth_hook',
      resourceId: eventType,
      actorType: 'system',
      details: result,
    });
  } catch {}
}

export const authHookRoutes = new Elysia({ prefix: '/v1/auth-hooks' })
  .get('/registration-guide', ({ headers, request }) => {
    const unauthorized = verifyHookSecret(headers);
    if (unauthorized) return unauthorized;
    return buildHookRegistrationGuide(new URL(request.url).origin);
  }, {
    detail: {
      summary: 'Get Supabase Auth Hooks registration guide',
      description: 'Returns HTTP hook endpoint URLs and required secret header for wiring Supabase Auth Hooks to SupaOAuth.',
      tags: ['Auth Hooks'],
    },
  })

  .post('/before-user-created', async ({ headers, body }) => {
    const unauthorized = verifyHookSecret(headers);
    if (unauthorized) return unauthorized;
    const result = handleBeforeUserCreated(body as never, await getSignupPolicy());
    await auditHook('auth_hook.before_user_created', { denied: 'error' in result, code: 'error' in result ? result.error.code : null });
    return result;
  }, {
    detail: {
      summary: 'Supabase before-user-created hook',
      description: 'Applies tenant signup policy such as domain allow/block lists, provider allow/block lists, and invite-only mode.',
      tags: ['Auth Hooks'],
    },
  })

  .post('/custom-access-token', async ({ headers, body }) => {
    const unauthorized = verifyHookSecret(headers);
    if (unauthorized) return unauthorized;
    const result = handleCustomAccessToken(body as never);
    await auditHook('auth_hook.custom_access_token', { processed: true });
    return result;
  }, {
    detail: {
      summary: 'Supabase custom-access-token hook',
      description: 'Adds a small app_metadata.supaoauth hook marker while preserving Supabase required claims.',
      tags: ['Auth Hooks'],
    },
  })

  .post('/mfa-verification-attempt', async ({ headers, body }) => {
    const unauthorized = verifyHookSecret(headers);
    if (unauthorized) return unauthorized;
    const result = handleMfaVerificationAttempt(body as never);
    await auditHook('auth_hook.mfa_verification_attempt', { denied: 'error' in result, code: 'error' in result ? result.error.code : null });
    return result;
  }, {
    detail: {
      summary: 'Supabase MFA verification attempt hook',
      description: 'Provides a tenant risk-policy bridge for MFA verification attempts.',
      tags: ['Auth Hooks'],
    },
  });
