// Supabase Auth Hooks bridge.
// HTTP endpoints call these helpers to keep hook behavior deterministic and testable.

export interface AuthHookError {
  error: {
    http_code: number;
    message: string;
    code?: string;
  };
}

export interface BeforeUserCreatedPayload {
  user?: {
    email?: string | null;
    phone?: string | null;
    app_metadata?: Record<string, unknown> | null;
    user_metadata?: Record<string, unknown> | null;
  };
  metadata?: Record<string, unknown>;
}

export interface SignupPolicy {
  allowed_email_domains?: string[];
  blocked_email_domains?: string[];
  blocked_oauth_providers?: string[];
  allowed_oauth_providers?: string[];
  invite_only?: boolean;
}

export interface CustomAccessTokenPayload {
  user_id?: string;
  claims?: Record<string, unknown>;
  authentication_method?: string;
}

export interface MfaVerificationPayload {
  user_id?: string;
  factor_id?: string;
  verification_method?: string;
  ip_address?: string;
  metadata?: Record<string, unknown>;
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^@/, '').toLowerCase();
}

function getEmailDomain(email?: string | null): string | null {
  if (!email || !email.includes('@')) return null;
  return normalizeDomain(email.split('@').pop() || '');
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getOAuthProvider(payload: BeforeUserCreatedPayload): string | null {
  const metadata = payload.user?.app_metadata || {};
  const provider = metadata.provider;
  if (typeof provider === 'string') return provider;
  const providers = asStringArray(metadata.providers);
  return providers[0] || null;
}

function hasInvitation(payload: BeforeUserCreatedPayload): boolean {
  const app = payload.user?.app_metadata || {};
  const user = payload.user?.user_metadata || {};
  return Boolean(
    app.invitation_id ||
    app.invitation_token ||
    user.invitation_id ||
    user.invitation_token ||
    payload.metadata?.invitation_id ||
    payload.metadata?.invitation_token,
  );
}

function reject(httpCode: number, message: string, code?: string): AuthHookError {
  return { error: { http_code: httpCode, message, ...(code ? { code } : {}) } };
}

export function handleBeforeUserCreated(
  payload: BeforeUserCreatedPayload,
  policy: SignupPolicy = {},
): Record<string, never> | AuthHookError {
  const emailDomain = getEmailDomain(payload.user?.email);
  const allowedDomains = (policy.allowed_email_domains || []).map(normalizeDomain).filter(Boolean);
  const blockedDomains = (policy.blocked_email_domains || []).map(normalizeDomain).filter(Boolean);

  if (emailDomain && blockedDomains.includes(emailDomain)) {
    return reject(400, 'Email domain is not allowed to sign up.', 'email_domain_blocked');
  }

  if (allowedDomains.length > 0 && (!emailDomain || !allowedDomains.includes(emailDomain))) {
    return reject(400, 'Only approved email domains are allowed to sign up.', 'email_domain_not_allowed');
  }

  const provider = getOAuthProvider(payload);
  const blockedProviders = (policy.blocked_oauth_providers || []).map(v => v.toLowerCase());
  const allowedProviders = (policy.allowed_oauth_providers || []).map(v => v.toLowerCase());

  if (provider && blockedProviders.includes(provider.toLowerCase())) {
    return reject(400, 'OAuth provider is not allowed for sign up.', 'oauth_provider_blocked');
  }

  if (provider && allowedProviders.length > 0 && !allowedProviders.includes(provider.toLowerCase())) {
    return reject(400, 'OAuth provider is not enabled for sign up.', 'oauth_provider_not_allowed');
  }

  if (policy.invite_only && !hasInvitation(payload)) {
    return reject(403, 'An invitation is required to sign up.', 'invitation_required');
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS = [
  'supaoauth',
  'supaoauth:roles',
  'supaoauth:org_id',
  'supaoauth:org_role',
  'supaoauth:scopes',
  'supaoauth:permissions',
] as const;

function removeTopLevelSupaOAuthClaims(claims: Record<string, unknown>): Record<string, unknown> {
  const next = { ...claims };
  for (const claim of AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS) {
    delete next[claim];
  }
  return next;
}

export function handleCustomAccessToken(payload: CustomAccessTokenPayload): { claims: Record<string, unknown> } {
  const claims = removeTopLevelSupaOAuthClaims(isRecord(payload.claims) ? payload.claims : {});
  const appMetadata = isRecord(claims.app_metadata) ? claims.app_metadata : {};
  const existingSupaOAuth = isRecord(appMetadata.supaoauth) ? appMetadata.supaoauth : {};

  return {
    claims: {
      ...claims,
      app_metadata: {
        ...appMetadata,
        supaoauth: {
          ...existingSupaOAuth,
          hook: {
            version: 1,
            authentication_method: payload.authentication_method || 'unknown',
            processed_at: new Date().toISOString(),
          },
        },
      },
    },
  };
}

export function handleMfaVerificationAttempt(payload: MfaVerificationPayload): Record<string, never> | AuthHookError {
  const risk = isRecord(payload.metadata) ? payload.metadata.risk : null;
  if (risk === 'blocked' || risk === 'high') {
    return reject(403, 'MFA verification attempt denied by tenant risk policy.', 'mfa_risk_denied');
  }
  return {};
}

export function buildHookRegistrationGuide(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return {
    before_user_created: `${normalized}/v1/auth-hooks/before-user-created`,
    custom_access_token: `${normalized}/v1/auth-hooks/custom-access-token`,
    mfa_verification_attempt: `${normalized}/v1/auth-hooks/mfa-verification-attempt`,
    secret_header: 'x-supaoauth-hook-secret',
    required_env: 'SUPAOAUTH_AUTH_HOOK_SECRET',
  };
}
