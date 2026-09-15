import type { Browser, BrowserContext, Page, Response as BrowserResponse } from 'playwright';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { Type, decodeSchema } from '../packages/shared/src/schema.js';
import {
  AdminIdentitySchema, AdminSsoConfigSchema, AdminOidcDiscoverySchema,
} from '../packages/shared/src/admin-auth-contracts.js';
import { sdkEndpoints } from '../packages/shared/src/sdk-endpoints.js';
import { SupaOAuthClient } from '../packages/sdks/typescript/src/index.js';
import {
  parseAcceptanceTarget, validateAcceptanceTarget, acceptanceAllocationDetails,
  type AcceptanceTarget, type PhaseResult,
} from './real-contract-acceptance-contract.js';
import { ServiceAcceptanceError, runOwnedWebhook } from './real-contract-services.js';
import { decodeTokenReply } from './compat-session-contract.js';
import {
  OAuthAuthorizationDetailsSchema, OAuthRedirectResultSchema,
} from '../packages/shared/src/server-configuration.js';

const TIMEOUT = 30_000;
const ToggleSchema = Type.Object({ enabled: Type.Literal(true) }, { additionalProperties: false });
const PausedResponseSchema = Type.Object({
  requestId: Type.String(),
  request: Type.Object({ url: Type.String(), method: Type.String() }),
  responseStatusCode: Type.Optional(Type.Number()),
  responseHeaders: Type.Optional(Type.Array(Type.Object({ name: Type.String(), value: Type.String() }))),
});
const UuidSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
});
const MfaUserSchema = Type.Object({
  id: UuidSchema,
  email: Type.String(),
  factors: Type.Array(Type.Object({
    id: UuidSchema, factor_type: Type.String(), status: Type.String(),
  })),
});
const ChallengeSchema = Type.Object({
  id: UuidSchema, type: Type.Literal('totp'),
  expires_at: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
});
const MfaVerificationSchema = Type.Object({ user: MfaUserSchema });
const ChallengeBodySchema = Type.Object({ factorId: UuidSchema }, { additionalProperties: false });
const VerifyBodySchema = Type.Object({
  challenge_id: UuidSchema, code: Type.String({ pattern: '^[0-9]{6}$' }),
}, { additionalProperties: false });
const PasswordBodySchema = Type.Object({
  email: Type.String(), password: Type.String(),
  gotrue_meta_security: Type.Optional(Type.Object({
    captcha_token: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
const ConsentBodySchema = Type.Object({ action: Type.Literal('approve') }, { additionalProperties: false });
const PasswordSessionSchema = Type.Object({
  access_token: Type.String({ minLength: 1 }),
  user: Type.Object({ id: UuidSchema, email: Type.String() }),
});
const OAuthCodeBodySchema = Type.Object({
  grant_type: Type.Literal('authorization_code'),
  client_id: Type.String({ minLength: 1 }), redirect_uri: Type.String({ minLength: 1 }),
  code: Type.String({ minLength: 1 }),
  code_verifier: Type.String({ pattern: '^[A-Za-z0-9._~-]{43,128}$' }),
}, { additionalProperties: false });
const AuthorizeQuerySchema = Type.Object({
  response_type: Type.Literal('code'), client_id: Type.String({ minLength: 1 }),
  redirect_uri: Type.String({ minLength: 1 }), scope: Type.Literal('openid profile email'),
  state: Type.String({ minLength: 16, maxLength: 256, pattern: '^[A-Za-z0-9_-]+$' }),
  code_challenge: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }),
  code_challenge_method: Type.Literal('S256'),
}, { additionalProperties: false });
const CallbackQuerySchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 4096, pattern: '^[^\\s\\u0000-\\u001f\\u007f]+$' }),
  state: Type.String({ minLength: 1 }),
  iss: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export interface BrowserOAuthAttempt {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}
export type BrowserAuthPost =
  | { kind: 'password'; email: string; password: string }
  | { kind: 'oauth-code'; clientId: string; redirectUri: string; code: string; codeChallenge: string }
  | { kind: 'consent'; authorizationId: string; bearer: string }
  | { kind: 'mfa-challenge'; factorId: string; bearer: string }
  | { kind: 'mfa-verify'; factorId: string; challengeId: string; code: string; bearer: string };
interface BrowserMfaIdentity {
  userId: string;
  email: string;
  factorId: string;
}
const TimestampSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$',
});
const ReceiptUserSchema = Type.Object({
  id: UuidSchema, email: Type.String(), createdAt: TimestampSchema,
}, { additionalProperties: false });
const ReceiptClientSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' }),
  name: Type.String(), redirectUri: Type.String(),
}, { additionalProperties: false });
const ReceiptFactorSchema = Type.Object({
  id: UuidSchema, userId: UuidSchema, factorType: Type.Literal('totp'),
}, { additionalProperties: false });
export const BrowserIdentityReceiptSchema = Type.Object({
  version: Type.Literal(1),
  runId: UuidSchema, projectRef: Type.String(), authorityRef: Type.String(),
  intent: Type.Object({
    email: Type.String(), clientName: Type.String(), redirectUri: Type.String(), recordedAt: TimestampSchema,
  }, { additionalProperties: false }),
  before: Type.Object({
    matchingUserIds: Type.Array(UuidSchema, { maxItems: 0 }),
    matchingClientIds: Type.Array(Type.String(), { maxItems: 0 }),
  }, { additionalProperties: false }),
  user: Type.Object({
    creation: ReceiptUserSchema, readback: ReceiptUserSchema,
  }, { additionalProperties: false }),
  client: Type.Object({
    creation: ReceiptClientSchema, readback: ReceiptClientSchema,
  }, { additionalProperties: false }),
  factor: Type.Object({
    creation: ReceiptFactorSchema,
    readback: Type.Object({
      ...ReceiptFactorSchema.properties, status: Type.Literal('verified'),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

type BrowserCode =
  | 'BROWSER_CONFIG_REQUIRED' | 'BROWSER_CONFIG_INVALID' | 'BROWSER_DEBUG_FORBIDDEN'
  | 'BROWSER_UNAVAILABLE' | 'BROWSER_NETWORK_BLOCKED' | 'BROWSER_GUARD_FAILED'
  | 'BROWSER_SSO_REQUIRED' | 'BROWSER_MFA_UNSUPPORTED' | 'BROWSER_LOGIN_BLOCKED'
  | 'BROWSER_MFA_FAILED'
  | 'BROWSER_IDENTITY_MISMATCH' | 'BROWSER_PROJECT_MISMATCH' | 'BROWSER_CONTRACT_INVALID'
  | 'BROWSER_DOM_MISMATCH' | 'BROWSER_WRITE_UNCONFIRMED' | 'BROWSER_PAGE_ERRORS'
  | 'BROWSER_CLEANUP_FAILED' | 'BROWSER_EXECUTION_FAILED' | 'BROWSER_SCOPED_PASSED';

class BrowserAcceptanceError extends Error {
  constructor(readonly code: BrowserCode) {
    super(code);
  }
}

function fail(code: BrowserCode): never {
  throw new BrowserAcceptanceError(code);
}

/** 不执行环境对象的访问器，不将原始值或异常带入报告。 */
function ownString(env: Record<string, string | undefined>, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(env, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
  const value: unknown = descriptor.value;
  return typeof value === 'string' ? value : undefined;
}

export function browserChannel(env: Record<string, string | undefined>): 'chrome' | undefined {
  const key = 'REAL_ACCEPTANCE_BROWSER_CHANNEL';
  const descriptor = Object.getOwnPropertyDescriptor(env, key);
  if (!descriptor) return undefined;
  const value = ownString(env, key);
  if (value !== 'chrome') fail('BROWSER_CONFIG_INVALID');
  return value;
}

/** 与既有兼容测试使用同一 RFC 6238 参数；不导入会注册 live 测试的模块。 */
export async function browserTotpCode(secret: string, now = Date.now()): Promise<string> {
  if (!/^[A-Z2-7]{32}$/.test(secret) || !Number.isSafeInteger(now) || now < 0) {
    fail('BROWSER_CONFIG_INVALID');
  }
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of secret) {
    buffer = (buffer << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(now / 30_000)));
  const key = await crypto.subtle.importKey(
    'raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const last = digest[digest.length - 1];
  if (last === undefined) fail('BROWSER_CONFIG_INVALID');
  const offset = last & 0x0f;
  if (offset + 4 > digest.byteLength) fail('BROWSER_CONFIG_INVALID');
  const binary = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

export function sameBrowserOrigin(value: string, origin: string): boolean {
  try {
    if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username && !url.password && url.origin === origin;
  } catch {
    return false;
  }
}

type BrowserOrigins = string | ReadonlySet<string>;

function allowedBrowserOrigin(value: string, origins: BrowserOrigins): boolean {
  return typeof origins === 'string'
    ? sameBrowserOrigin(value, origins)
    : [...origins].some((origin) => sameBrowserOrigin(value, origin));
}

export function validateBrowserIdentityReceipt(value: unknown, target: AcceptanceTarget) {
  try {
    const allocation = acceptanceAllocationDetails(target);
    const receipt = decodeSchema(BrowserIdentityReceiptSchema, value);
    if (!allocation || receipt.runId !== allocation.runId || receipt.projectRef !== allocation.projectRef
      || receipt.authorityRef !== allocation.authorityRef
      || receipt.intent.email !== `admin-${allocation.runId}@xai.xigu.team`
      || receipt.intent.clientName !== `supauth-contract-${allocation.runId}`
      || receipt.intent.redirectUri !== `${allocation.projectOrigin}/admin`) fail('BROWSER_CONFIG_INVALID');
    const { creation: user, readback } = receipt.user;
    const { creation: client, readback: clientReadback } = receipt.client;
    const { creation: factor, readback: factorReadback } = receipt.factor;
    const recordedAt = Date.parse(receipt.intent.recordedAt);
    const createdAt = Date.parse(user.createdAt);
    if (!Number.isFinite(recordedAt) || !Number.isFinite(createdAt) || createdAt < recordedAt
      || user.id !== readback.id || user.email !== readback.email || user.createdAt !== readback.createdAt
      || user.email !== receipt.intent.email
      || client.id !== clientReadback.id || client.name !== clientReadback.name
      || client.redirectUri !== clientReadback.redirectUri
      || client.name !== receipt.intent.clientName || client.redirectUri !== receipt.intent.redirectUri
      || factor.id !== factorReadback.id || factor.userId !== user.id
      || factorReadback.userId !== user.id) fail('BROWSER_CONFIG_INVALID');
    return receipt;
  } catch {
    return fail('BROWSER_CONFIG_INVALID');
  }
}

/** 只读 main 写入的私有回执；不跟随符号链接，不将路径或原始异常带入报告。 */
export function loadBrowserIdentityReceipt(env: Record<string, string | undefined>, target: AcceptanceTarget) {
  let fd: number | undefined;
  try {
    const path = ownString(env, 'REAL_ACCEPTANCE_BROWSER_IDENTITY_RECEIPT');
    if (!path || !isAbsolute(path)) fail('BROWSER_CONFIG_INVALID');
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1
      || stat.uid !== process.getuid?.() || stat.size < 1 || stat.size > 65_536) fail('BROWSER_CONFIG_INVALID');
    const value: unknown = JSON.parse(readFileSync(fd, 'utf8'));
    return validateBrowserIdentityReceipt(value, target);
  } catch {
    return fail('BROWSER_CONFIG_INVALID');
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { fail('BROWSER_CONFIG_INVALID'); }
    }
  }
}

export function browserConfiguration(target: AcceptanceTarget, env: Record<string, string | undefined>) {
  const channel = browserChannel(env);
  const email = ownString(env, 'REAL_ACCEPTANCE_BROWSER_EMAIL');
  const password = ownString(env, 'REAL_ACCEPTANCE_BROWSER_PASSWORD');
  if (!email || !password) fail('BROWSER_CONFIG_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(password)) {
    fail('BROWSER_CONFIG_INVALID');
  }
  if (ownString(env, 'DEBUG') || ownString(env, 'PWDEBUG')
    || process.env['DEBUG'] || process.env['PWDEBUG']) fail('BROWSER_DEBUG_FORBIDDEN');
  try {
    const verified = validateAcceptanceTarget(target);
    const configured = parseAcceptanceTarget(env);
    const keys = ['baseUrl', 'runtimeUrl', 'projectRef', 'adminToken', 'userToken'] as const;
    if (keys.some((key) => configured[key] !== verified[key])) fail('BROWSER_CONFIG_INVALID');
    const origin = new URL(verified.baseUrl).origin;
    const authorityOrigin = new URL(verified.runtimeUrl).origin;
    const allocation = acceptanceAllocationDetails(verified);
    const identity = allocation ? loadBrowserIdentityReceipt(env, verified) : undefined;
    const secret = ownString(env, 'REAL_ACCEPTANCE_BROWSER_MFA_SECRET');
    const factorId = ownString(env, 'REAL_ACCEPTANCE_BROWSER_MFA_FACTOR_ID');
    const userId = ownString(env, 'REAL_ACCEPTANCE_BROWSER_USER_ID');
    if (identity || secret !== undefined || factorId !== undefined || userId !== undefined) {
      if (!identity || !secret || !/^[A-Z2-7]{32}$/.test(secret)
        || factorId !== identity.factor.readback.id || userId !== identity.user.readback.id
        || email !== identity.user.readback.email) fail('BROWSER_CONFIG_INVALID');
    }
    const mfa = identity && secret
      ? { secret, userId: identity.user.readback.id, factorId: identity.factor.readback.id, email }
      : undefined;
    return {
      email, password, channel, origin, authorityOrigin, identity, mfa,
      origins: new Set([origin, authorityOrigin]), target: verified,
    };
  } catch {
    return fail('BROWSER_CONFIG_INVALID');
  }
}

export function browserMfaUser(value: unknown, expected: BrowserMfaIdentity): boolean {
  try {
    const user = decodeSchema(MfaUserSchema, value);
    return user.id === expected.userId && user.email.toLowerCase() === expected.email.toLowerCase()
      && new Set(user.factors.map((factor) => factor.id)).size === user.factors.length
      && user.factors.some((factor) => factor.id === expected.factorId
        && factor.factor_type === 'totp' && factor.status === 'verified');
  } catch {
    return false;
  }
}

export function browserMfaVerification(value: unknown, expected: BrowserMfaIdentity): string {
  try {
    const token = decodeTokenReply(value);
    const verification = decodeSchema(MfaVerificationSchema, value);
    if (!token?.access_token || !token.refresh_token || token.error
      || !browserMfaUser(verification.user, expected)) fail('BROWSER_MFA_FAILED');
    return token.access_token;
  } catch {
    return fail('BROWSER_MFA_FAILED');
  }
}

export function permittedBrowserMfaBody(
  action: 'challenge' | 'verify', body: string | null,
  factorId: string, challengeId: string | null, code: string | null,
): boolean {
  try {
    if (body === null) return false;
    const value: unknown = JSON.parse(body);
    if (action === 'challenge') return decodeSchema(ChallengeBodySchema, value).factorId === factorId;
    const payload = decodeSchema(VerifyBodySchema, value);
    return challengeId !== null && code !== null
      && payload.challenge_id === challengeId && payload.code === code;
  } catch {
    return false;
  }
}

export function permittedToggle(body: string | null): boolean {
  try {
    if (body === null) return false;
    const value: unknown = JSON.parse(body);
    decodeSchema(ToggleSchema, value);
    return true;
  } catch {
    return false;
  }
}

function uniqueParameters(value: string): Record<string, string> {
  if (/%(?![0-9a-f]{2})/i.test(value)) fail('BROWSER_CONTRACT_INVALID');
  const entries = [...new URLSearchParams(value)];
  if (new Set(entries.map(([key]) => key)).size !== entries.length
    || entries.some(([key, entry]) => key.includes('\ufffd') || entry.includes('\ufffd'))) {
    fail('BROWSER_CONTRACT_INVALID');
  }
  return Object.fromEntries(entries);
}

export function browserAuthorizationRequest(
  url: string, authorizationEndpoint: string, clientId: string, redirectUri: string,
): BrowserOAuthAttempt {
  try {
    const parsed = new URL(url);
    if (parsed.hash || parsed.username || parsed.password
      || `${parsed.origin}${parsed.pathname}` !== authorizationEndpoint) fail('BROWSER_SSO_REQUIRED');
    const query = decodeSchema(AuthorizeQuerySchema, uniqueParameters(parsed.search));
    if (query.client_id !== clientId || query.redirect_uri !== redirectUri) fail('BROWSER_SSO_REQUIRED');
    return {
      authorizationUrl: url, clientId, redirectUri, state: query.state, codeChallenge: query.code_challenge,
    };
  } catch {
    return fail('BROWSER_SSO_REQUIRED');
  }
}

export function browserAuthorizationDetails(
  value: unknown, attempt: BrowserOAuthAttempt, authorizationId: string, userId: string,
): boolean {
  try {
    const details = decodeSchema(OAuthAuthorizationDetailsSchema, value);
    return details.authorization_id === authorizationId && details.client.id === attempt.clientId
      && details.user.id === userId && details.redirect_uri === attempt.redirectUri
      && details.scope === 'openid profile email';
  } catch {
    return false;
  }
}

export function browserOAuthCallback(
  value: unknown, attempt: BrowserOAuthAttempt, issuer: string,
): { code: string; url: string } {
  try {
    const { redirect_url: url } = decodeSchema(OAuthRedirectResultSchema, value);
    const parsed = new URL(url);
    if (parsed.hash || parsed.username || parsed.password
      || `${parsed.origin}${parsed.pathname}` !== attempt.redirectUri) fail('BROWSER_LOGIN_BLOCKED');
    const query = decodeSchema(CallbackQuerySchema, uniqueParameters(parsed.search));
    if (query.state !== attempt.state || (query.iss !== undefined && query.iss !== issuer)) {
      fail('BROWSER_LOGIN_BLOCKED');
    }
    return { code: query.code, url };
  } catch {
    return fail('BROWSER_LOGIN_BLOCKED');
  }
}

function permittedAuthPost(
  url: string, capability: BrowserAuthPost, body: string | null,
  contentType: string | null, authorization: string | null,
): boolean {
  try {
    if (body === null || body.length > 16_384) return false;
    const parsed = new URL(url);
    if (parsed.hash || (capability.kind !== 'password' && parsed.search)) return false;
    const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
    if (capability.kind === 'oauth-code') {
      if (!parsed.pathname.endsWith('/oauth/token')
        || mediaType !== 'application/x-www-form-urlencoded' || authorization !== null) return false;
      const value = decodeSchema(OAuthCodeBodySchema, uniqueParameters(body));
      return value.client_id === capability.clientId && value.redirect_uri === capability.redirectUri
        && value.code === capability.code
        && createHash('sha256').update(value.code_verifier).digest('base64url') === capability.codeChallenge;
    }
    if (mediaType !== 'application/json') return false;
    const value: unknown = JSON.parse(body);
    // 现有 SDK/页面发送 JSON.stringify 结果；拒绝重复键及非规范序列化歧义。
    if (JSON.stringify(value) !== body) return false;
    switch (capability.kind) {
      case 'password': {
        const password = decodeSchema(PasswordBodySchema, value);
        return parsed.pathname.endsWith('/token') && !parsed.pathname.endsWith('/oauth/token')
          && parsed.search === '?grant_type=password'
          && password.email === capability.email && password.password === capability.password;
      }
      case 'consent':
        return authorization === capability.bearer
          && new URL(url).pathname.endsWith(`/oauth/authorizations/${capability.authorizationId}/consent`)
          && decodeSchema(ConsentBodySchema, value).action === 'approve';
      case 'mfa-challenge':
        return authorization === capability.bearer
          && new URL(url).pathname.endsWith(`/factors/${capability.factorId}/challenge`)
          && permittedBrowserMfaBody('challenge', body, capability.factorId, null, null);
      case 'mfa-verify':
        return authorization === capability.bearer
          && new URL(url).pathname.endsWith(`/factors/${capability.factorId}/verify`)
          && permittedBrowserMfaBody('verify', body, capability.factorId, capability.challengeId, capability.code);
      default: {
        const exhaustive: never = capability;
        return exhaustive;
      }
    }
  } catch {
    return false;
  }
}

export function permittedBrowserRequest(
  url: string,
  method: string,
  origin: BrowserOrigins,
  authPosts: ReadonlyMap<string, BrowserAuthPost>,
  ownedWriteUrl: string | null,
  body: string | null,
  contentType: string | null = null,
  authorization: string | null = null,
): boolean {
  if (!allowedBrowserOrigin(url, origin)) return false;
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST') {
    const capability = authPosts.get(url);
    return capability !== undefined && permittedAuthPost(url, capability, body, contentType, authorization);
  }
  return method === 'PUT' && url === ownedWriteUrl && permittedToggle(body);
}

export function permittedBrowserRedirect(
  location: string, from: string, method: string, origin: BrowserOrigins,
): boolean {
  try {
    // 写入重定向也可能重放；本验收只允许读取导航的同源重定向。
    if (method !== 'GET' && method !== 'HEAD') return false;
    if (/[\u0000-\u0020\u007f\\]/.test(location)) return false;
    return allowedBrowserOrigin(from, origin) && allowedBrowserOrigin(new URL(location, from).href, origin);
  } catch {
    return false;
  }
}

export function permittedBrowserSdkRead(
  url: string, method: string, target: AcceptanceTarget, ownedId: string | null,
): boolean {
  if (method !== 'GET' || !sameBrowserOrigin(url, new URL(target.baseUrl).origin)) return false;
  return url === endpoint(target, '/v1/project') || url === endpoint(target, '/v1/webhooks')
    || (ownedId !== null && url === endpoint(target, `/v1/webhooks/${encodeURIComponent(ownedId)}`));
}

export function browserDiscovery(value: unknown, target: AcceptanceTarget) {
  target = validateAcceptanceTarget(target);
  const discovery = decodeSchema(AdminOidcDiscoverySchema, value);
  const origin = new URL(target.runtimeUrl).origin;
  if ([discovery.authorization_endpoint, discovery.token_endpoint, discovery.userinfo_endpoint]
    .some((url) => !sameBrowserOrigin(url, origin))
    || discovery.authorization_endpoint !== `${target.runtimeUrl}/oauth/authorize`
    || discovery.token_endpoint !== `${target.runtimeUrl}/oauth/token`) {
    fail('BROWSER_SSO_REQUIRED');
  }
  return discovery;
}

export function browserConsentUrl(pageUrl: string, target: AcceptanceTarget): string {
  target = validateAcceptanceTarget(target);
  const parsed = new URL(pageUrl);
  const appOrigin = new URL(target.baseUrl).origin;
  const authorityOrigin = new URL(target.runtimeUrl).origin;
  const ids = parsed.searchParams.getAll('authorization_id');
  const id = ids[0];
  if (ids.length !== 1 || !id || !/^[A-Za-z0-9_-]+$/.test(id)
    || !allowedBrowserOrigin(pageUrl, new Set([appOrigin, authorityOrigin]))) {
    fail('BROWSER_LOGIN_BLOCKED');
  }
  if (parsed.origin === authorityOrigin && parsed.pathname === '/authorize.html'
    && parsed.hostname.startsWith('auth.')) {
    return `${authorityOrigin}/v1/public/oauth/authorizations/${id}/consent`;
  }
  if (parsed.origin === appOrigin && ['/oauth/authorize', '/authorize.html'].includes(parsed.pathname)) {
    return endpoint(target, `/v1/public/oauth/authorizations/${id}/consent`);
  }
  return fail('BROWSER_LOGIN_BLOCKED');
}

export function completeBrowserWebhookList(value: unknown) {
  const list = decodeSchema(sdkEndpoints.listWebhooks.result, value);
  if (list.total !== list.items.length || (list.page !== undefined && list.page !== 1)
    || (list.limit !== undefined && (!Number.isInteger(list.limit) || list.limit < Math.max(1, list.total)))
    || list.items.some((item) => !item.id)
    || new Set(list.items.map((item) => item.id)).size !== list.items.length) {
    fail('BROWSER_CONTRACT_INVALID');
  }
  return list.items;
}

function endpoint(target: AcceptanceTarget, path: string): string {
  return `${target.baseUrl}${path}`;
}

function responseAt(response: BrowserResponse, url: string): boolean {
  const actual = new URL(response.url());
  return `${actual.origin}${actual.pathname}` === url && response.request().method() === 'GET';
}

async function readBrowserList(response: BrowserResponse) {
  if (!response.ok()) fail('BROWSER_CONTRACT_INVALID');
  const payload: unknown = await response.json();
  return completeBrowserWebhookList(payload);
}

async function waitUntil(
  page: Page, condition: () => Promise<boolean>, code: BrowserCode, mfa?: () => Promise<void>,
) {
  const deadline = Date.now() + (mfa ? TIMEOUT * 2 : TIMEOUT);
  while (Date.now() < deadline) {
    if (await condition()) return;
    if (await page.locator('#admin-mfa-enrollment-code').isVisible()
      || await page.getByRole('heading', { name: /需要双因素认证|绑定管理员 MFA/ }).isVisible()) {
      fail('BROWSER_MFA_UNSUPPORTED');
    }
    if (await page.locator('#admin-mfa-code').isVisible()) {
      if (!mfa) fail('BROWSER_MFA_UNSUPPORTED');
      await mfa();
    }
    await page.waitForTimeout(100);
  }
  fail(code);
}

function safeCode(error: unknown): BrowserCode {
  return error instanceof BrowserAcceptanceError ? error.code : 'BROWSER_EXECUTION_FAILED';
}

export async function runBrowserAcceptance(
  target: AcceptanceTarget,
  env: Record<string, string | undefined>,
): Promise<PhaseResult> {
  let checks = 0;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let result: PhaseResult = { phase: 'browser', status: 'blocked', checks, code: 'BROWSER_CONFIG_REQUIRED' };
  let pageErrors = 0;
  let consoleErrors = 0;
  let blockedRequests = 0;
  let guardFailed = false;
  let writeRequests = 0;
  let listRequests = 0;
  let sdkReads = 0;
  let blockedSockets = 0;
  let mfaChallenges = 0;
  let mfaVerifications = 0;
  try {
    const config = browserConfiguration(target, env);
    target = config.target;
    checks++;
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({
        headless: true, ...(config.channel === undefined ? {} : { channel: config.channel }),
      });
    } catch {
      fail('BROWSER_UNAVAILABLE');
    }
    context = await browser.newContext({
      serviceWorkers: 'block', acceptDownloads: false, locale: 'en-US',
      viewport: { width: 1440, height: 1000 },
    });
    context.setDefaultTimeout(TIMEOUT);
    context.setDefaultNavigationTimeout(TIMEOUT);
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors++; });
    page.on('pageerror', () => { pageErrors++; });
    page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => { guardFailed = true; }); });
    const authPosts = new Map<string, BrowserAuthPost>();
    const passwordUrl = `${target.runtimeUrl}/token?grant_type=password`;
    let ssoClientId: string | null = null;
    let authorizationEndpoint: string | null = null;
    let oauthTokenUrl: string | null = null;
    let attempt: BrowserOAuthAttempt | null = null;
    let authorizationId: string | null = null;
    let consentUrl: string | null = null;
    let authorizationReady = false;
    let passwordBearer: string | null = null;
    let passwordUserId: string | null = null;
    let expectedCallback: string | null = null;
    let callbackObserved = false;
    let ownedWriteUrl: string | null = null;
    const listUrl = endpoint(target, '/v1/webhooks');
    const identityUrl = endpoint(target, '/v1/auth/identity');
    let ssoReady = false;
    let identityToken: string | null = null;
    let identityInvalid = false;
    let responseInvalid = false;
    let mfaBearer: string | null = null;
    let mfaChallengeId: string | null = null;
    let mfaCode: string | null = null;
    let mfaSubmitted = false;
    let mfaVerified = false;
    let mfaVerifiedToken: string | null = null;
    const factorBase = config.mfa ? `${target.runtimeUrl}/factors/${config.mfa.factorId}` : null;
    const pending = new Set<Promise<void>>();
    const monitorResponse = async (response: BrowserResponse) => {
      if (responseAt(response, endpoint(target, '/v1/public/admin-sso-config')) && response.ok()) {
        const payload: unknown = await response.json();
        const sso = decodeSchema(AdminSsoConfigSchema, payload);
        if (!sso.enabled || !sso.client_id || sso.issuer !== target.runtimeUrl
          || sso.redirect_uri !== `${config.origin}/admin`
          || (config.identity && sso.client_id !== config.identity.client.readback.id)) fail('BROWSER_SSO_REQUIRED');
        ssoClientId = sso.client_id;
        ssoReady = true;
      }
      if (responseAt(response, `${target.runtimeUrl}/.well-known/openid-configuration`) && response.ok()) {
        const payload: unknown = await response.json();
        const discovery = browserDiscovery(payload, target);
        authorizationEndpoint = discovery.authorization_endpoint;
        oauthTokenUrl = discovery.token_endpoint;
      }
      if (response.url() === passwordUrl && response.request().method() === 'POST') {
        if (!response.ok()) fail('BROWSER_LOGIN_BLOCKED');
        const payload: unknown = await response.json();
        const session = decodeSchema(PasswordSessionSchema, payload);
        if (session.user.email !== config.email
          || (config.identity && session.user.id !== config.identity.user.readback.id)) {
          fail('BROWSER_IDENTITY_MISMATCH');
        }
        passwordBearer = `Bearer ${session.access_token}`;
        passwordUserId = session.user.id;
      }
      if (consentUrl && responseAt(response, consentUrl.slice(0, -'/consent'.length)) && response.ok()) {
        const payload: unknown = await response.json();
        if (!attempt || !authorizationId || !passwordUserId || !passwordBearer
          || await response.request().headerValue('authorization') !== passwordBearer
          || !browserAuthorizationDetails(payload, attempt, authorizationId, passwordUserId)) {
          fail('BROWSER_IDENTITY_MISMATCH');
        }
        authorizationReady = true;
      }
      if (consentUrl && response.url() === consentUrl && response.request().method() === 'POST') {
        if (!response.ok() || !authorizationReady || !attempt || !oauthTokenUrl) fail('BROWSER_LOGIN_BLOCKED');
        const payload: unknown = await response.json();
        const callback = browserOAuthCallback(payload, attempt, target.runtimeUrl);
        expectedCallback = callback.url;
        authPosts.set(oauthTokenUrl, {
          kind: 'oauth-code', clientId: attempt.clientId, redirectUri: attempt.redirectUri,
          code: callback.code, codeChallenge: attempt.codeChallenge,
        });
      }
      if (config.mfa && responseAt(response, `${target.runtimeUrl}/user`) && response.ok()) {
        const payload: unknown = await response.json();
        const bearer = await response.request().headerValue('authorization');
        if (!browserMfaUser(payload, config.mfa) || !bearer?.startsWith('Bearer ') || bearer.length <= 7) {
          fail('BROWSER_IDENTITY_MISMATCH');
        }
        mfaBearer = bearer;
      }
      if (factorBase && response.url() === `${factorBase}/challenge`
        && response.request().method() === 'POST') {
        if (!response.ok() || mfaChallenges !== 1) fail('BROWSER_MFA_FAILED');
        const payload: unknown = await response.json();
        const challenge = decodeSchema(ChallengeSchema, payload);
        if (challenge.expires_at * 1_000 <= Date.now()) fail('BROWSER_MFA_FAILED');
        mfaChallengeId = challenge.id;
        if (!config.mfa || !mfaBearer || !mfaCode) fail('BROWSER_MFA_FAILED');
        authPosts.set(`${factorBase}/verify`, {
          kind: 'mfa-verify', factorId: config.mfa.factorId, bearer: mfaBearer,
          challengeId: mfaChallengeId, code: mfaCode,
        });
      }
      if (factorBase && config.mfa && response.url() === `${factorBase}/verify`
        && response.request().method() === 'POST') {
        if (!response.ok() || mfaVerifications !== 1) fail('BROWSER_MFA_FAILED');
        const payload: unknown = await response.json();
        mfaVerifiedToken = browserMfaVerification(payload, config.mfa);
        // 会话仅由真实 UI/SDK 应用；runner 只将令牌用于核对之后的真实身份请求。
        mfaVerified = true;
      }
      if (responseAt(response, identityUrl) && response.ok()) {
        const payload: unknown = await response.json();
        const identity = decodeSchema(AdminIdentitySchema, payload);
        if (!identity.id || identity.email.toLowerCase() !== config.email.toLowerCase()
          || (config.identity && identity.id !== config.identity.user.readback.id)
          || identity.authorization_source === 'development_token'
          || !identity.roles.length) {
          identityInvalid = true;
          return;
        }
        const authorization = await response.request().headerValue('authorization');
        if (!authorization?.startsWith('Bearer ') || authorization.length <= 7) {
          identityInvalid = true;
          return;
        }
        const token = authorization.slice(7);
        if (config.mfa && (!mfaVerifiedToken || token !== mfaVerifiedToken)) return;
        identityToken = token;
      }
    };
    page.on('response', (response) => {
      const task = monitorResponse(response).catch(() => { responseInvalid = true; });
      pending.add(task);
      void task.finally(() => { pending.delete(task); });
    });
    await context.routeWebSocket('**/*', (socket) => {
      blockedSockets++;
      const destination = new URL(socket.url());
      destination.protocol = destination.protocol === 'wss:' ? 'https:' : 'http:';
      if (!allowedBrowserOrigin(destination.href, config.origins)) blockedRequests++;
      socket.close();
    });
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        await Promise.all(pending);
        let permittedPage = false;
        try { permittedPage = request.frame().page() === page; } catch { /* 无主页面的请求不放行。 */ }
        const url = new URL(request.url());
        if (request.method() === 'GET'
          && `${url.origin}${url.pathname}` === `${target.runtimeUrl}/oauth/authorize`) {
          if (!ssoClientId || !authorizationEndpoint || attempt || !permittedPage || !request.isNavigationRequest()) {
            fail('BROWSER_SSO_REQUIRED');
          }
          attempt = browserAuthorizationRequest(
            request.url(), authorizationEndpoint, ssoClientId, `${config.origin}/admin`,
          );
        }
        if (request.method() === 'GET' && url.origin === config.origin && url.pathname === '/admin'
          && (url.searchParams.has('code') || url.searchParams.has('error'))) {
          if (!permittedPage || !request.isNavigationRequest()
            || expectedCallback === null || request.url() !== expectedCallback) fail('BROWSER_LOGIN_BLOCKED');
          callbackObserved = true;
        }
        const contentType = await request.headerValue('content-type');
        const authorization = await request.headerValue('authorization');
        let permitted = permittedPage && blockedRequests === 0
          && !responseInvalid && !identityInvalid && !guardFailed && permittedBrowserRequest(
          request.url(), request.method(), config.origins, authPosts, ownedWriteUrl, request.postData(),
          contentType, authorization,
        );
        if (request.method() === 'POST' && request.url() === oauthTokenUrl && !callbackObserved) permitted = false;
        if (factorBase && config.mfa && request.method() === 'POST'
          && (request.url() === `${factorBase}/challenge` || request.url() === `${factorBase}/verify`)) {
          const action = request.url() === `${factorBase}/challenge` ? 'challenge' : 'verify';
          permitted = permitted && mfaSubmitted && mfaBearer !== null && authorization === mfaBearer
            && (action === 'challenge' ? mfaChallenges === 0 : mfaVerifications === 0);
          if (permitted) {
            if (action === 'challenge') mfaChallenges++;
            else mfaVerifications++;
          }
        }
        if (request.method() === 'POST') authPosts.delete(request.url());
        if (!permitted || (request.method() === 'PUT' && writeRequests !== 0)) {
          blockedRequests++;
          await route.abort('blockedbyclient');
          return;
        }
        if (request.method() === 'PUT') writeRequests++;
        if (request.method() === 'GET' && new URL(request.url()).pathname === new URL(listUrl).pathname) {
          listRequests++;
        }
        await route.continue();
      } catch {
        guardFailed = true;
        await route.abort('blockedbyclient').catch(() => { guardFailed = true; });
      }
    });
    // Playwright route 不覆盖重定向的后续跳；在真实响应继续前检查 Location。
    const cdp = await context.newCDPSession(page);
    cdp.on('Fetch.requestPaused', (input: unknown) => {
      const handle = async () => {
        const paused = decodeSchema(PausedResponseSchema, input);
        const locations = (paused.responseHeaders ?? [])
          .filter((header) => header.name.toLowerCase() === 'location');
        const redirect = paused.responseStatusCode !== undefined
          && [301, 302, 303, 307, 308].includes(paused.responseStatusCode);
        if (!allowedBrowserOrigin(paused.request.url, config.origins)
          || (redirect && (locations.length !== 1 || !locations.every((header) =>
            permittedBrowserRedirect(header.value, paused.request.url, paused.request.method, config.origins))))) {
          blockedRequests++;
          await cdp.send('Fetch.failRequest', { requestId: paused.requestId, errorReason: 'BlockedByClient' });
          return;
        }
        if (attempt && redirect && paused.request.url === attempt.authorizationUrl) {
          const location = locations[0]?.value;
          if (!location || authorizationId !== null) fail('BROWSER_SSO_REQUIRED');
          const hostedUrl = new URL(location, paused.request.url).href;
          consentUrl = browserConsentUrl(hostedUrl, target);
          authorizationId = new URL(hostedUrl).searchParams.get('authorization_id');
          if (!authorizationId) fail('BROWSER_SSO_REQUIRED');
        }
        await cdp.send('Fetch.continueRequest', { requestId: paused.requestId });
      };
      void handle().catch(() => {
        guardFailed = true;
        void page.close().catch(() => { guardFailed = true; });
      });
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
    const ensureGuards = () => {
      if (guardFailed) fail('BROWSER_GUARD_FAILED');
      if (blockedRequests) fail('BROWSER_NETWORK_BLOCKED');
      if (responseInvalid) fail('BROWSER_CONTRACT_INVALID');
      if (identityInvalid) fail('BROWSER_IDENTITY_MISMATCH');
      if (pageErrors) fail('BROWSER_PAGE_ERRORS');
    };
    await page.goto(`${config.origin}/admin/webhooks`, { waitUntil: 'domcontentloaded' });
    await waitUntil(page, async () => {
      ensureGuards();
      return ssoReady && await page.locator('#login-form').isVisible();
    }, 'BROWSER_SSO_REQUIRED');
    if (!attempt || !authorizationId || !consentUrl || browserConsentUrl(page.url(), target) !== consentUrl) {
      fail('BROWSER_SSO_REQUIRED');
    }
    await page.locator('#email').fill(config.email);
    await page.locator('#password').fill(config.password);
    authPosts.set(passwordUrl, { kind: 'password', email: config.email, password: config.password });
    await page.locator('#submit').click();
    let consentClicked = false;
    await waitUntil(page, async () => {
      ensureGuards();
      if (!consentClicked && await page.locator('#consent-approve').isVisible()) {
        await Promise.all(pending);
        ensureGuards();
        if (!authorizationReady || !passwordBearer || !authorizationId || !consentUrl
          || browserConsentUrl(page.url(), target) !== consentUrl) fail('BROWSER_LOGIN_BLOCKED');
        authPosts.set(consentUrl, { kind: 'consent', authorizationId, bearer: passwordBearer });
        consentClicked = true;
        await page.locator('#consent-approve').click();
      }
      return identityToken !== null && (!config.mfa || mfaVerified);
    }, 'BROWSER_LOGIN_BLOCKED', async () => {
      if (!config.mfa || !factorBase) fail('BROWSER_MFA_UNSUPPORTED');
      if (mfaSubmitted) {
        if (await page.getByRole('alert').isVisible()) fail('BROWSER_MFA_FAILED');
        return;
      }
      await Promise.all(pending);
      ensureGuards();
      if (!mfaBearer || !sameBrowserOrigin(page.url(), config.origin)) fail('BROWSER_IDENTITY_MISMATCH');
      await page.locator('#admin-mfa-factor').selectOption(config.mfa.factorId);
      if (await page.locator('#admin-mfa-factor').inputValue() !== config.mfa.factorId) {
        fail('BROWSER_IDENTITY_MISMATCH');
      }
      // 避免复用 main 的 enrollment 验证码，并为网络留出完整时间窗口。
      await page.waitForTimeout(30_000 - Date.now() % 30_000 + 50);
      mfaCode = await browserTotpCode(config.mfa.secret);
      await page.locator('#admin-mfa-code').fill(mfaCode);
      authPosts.set(`${factorBase}/challenge`, {
        kind: 'mfa-challenge', factorId: config.mfa.factorId, bearer: mfaBearer,
      });
      mfaSubmitted = true;
      await page.getByRole('button', { name: '验证并继续', exact: true }).click();
    });
    if (!identityToken) fail('BROWSER_IDENTITY_MISMATCH');
    checks += 2;
    let sdkOwnedId: string | null = null;
    const sdk = new SupaOAuthClient({
      baseUrl: target.baseUrl, accessToken: identityToken,
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (!permittedBrowserSdkRead(url, method, target, sdkOwnedId)) {
          fail('BROWSER_NETWORK_BLOCKED');
        }
        sdkReads++;
        return fetch(input, {
          ...init, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT),
        });
      },
    });
    const project = await sdk.getProject();
    if ((project.ref ?? project.project_ref) !== target.projectRef
      || (project.ref !== undefined && project.project_ref !== undefined && project.ref !== project.project_ref)) {
      fail('BROWSER_PROJECT_MISMATCH');
    }
    checks++;
    const refreshList = async () => {
      const responsePromise = page.waitForResponse((response) => responseAt(response, listUrl));
      // 提前附加失败处理，导航失败时不留下未处理的等待异常。
      void responsePromise.catch(() => undefined);
      await page.goto(`${config.origin}/admin/webhooks`, { waitUntil: 'domcontentloaded' });
      const items = await readBrowserList(await responsePromise);
      await page.getByRole('heading', { name: 'Webhooks', exact: true }).waitFor();
      ensureGuards();
      return items;
    };
    const listed = await refreshList();
    const sdkListed = completeBrowserWebhookList(await sdk.listWebhooks());
    if (JSON.stringify(listed.map((item) => item.id).sort())
      !== JSON.stringify(sdkListed.map((item) => item.id).sort())) fail('BROWSER_DOM_MISMATCH');
    checks += 2;
    await runOwnedWebhook(target, async (owned) => {
      sdkOwnedId = owned.id;
      const before = (await refreshList()).filter((item) => item.id === owned.id && item.url === owned.marker);
      if (before.length !== 1 || before[0]?.enabled !== false || before[0].events.length !== 0) {
        fail('BROWSER_CONTRACT_INVALID');
      }
      const link = page.getByRole('link', { name: owned.marker, exact: true });
      if (await link.count() !== 1
        || await link.getAttribute('href') !== `/admin/webhooks/${encodeURIComponent(owned.id)}/settings`) {
        fail('BROWSER_DOM_MISMATCH');
      }
      const row = page.locator('div.rounded-xl').filter({ has: link });
      const toggle = row.getByRole('button', { name: 'Enable', exact: true });
      await toggle.waitFor();
      ownedWriteUrl = `${listUrl}/${encodeURIComponent(owned.id)}`;
      const afterPromise = page.waitForResponse((response) => writeRequests === 1 && responseAt(response, listUrl));
      void afterPromise.catch(() => undefined);
      try {
        await toggle.click();
        const after = (await readBrowserList(await afterPromise)).filter((item) => item.id === owned.id);
        if (after.length !== 1 || after[0]?.url !== owned.marker
          || !after[0].enabled || after[0].events.length !== 0) fail('BROWSER_WRITE_UNCONFIRMED');
        await row.getByRole('button', { name: 'Disable', exact: true }).waitFor();
        await waitUntil(page, () => row.getByRole('button', { name: 'Disable', exact: true }).isEnabled(),
          'BROWSER_WRITE_UNCONFIRMED');
        const readback = await sdk.getWebhook(owned.id);
        if (readback.id !== owned.id || readback.url !== owned.marker
          || !readback.enabled || readback.events.length !== 0 || writeRequests !== 1) {
          fail('BROWSER_WRITE_UNCONFIRMED');
        }
        ensureGuards();
        checks += 4;
      } finally {
        ownedWriteUrl = null;
        sdkOwnedId = null;
      }
    });
    checks++;
    await Promise.all(pending);
    ensureGuards();
    result = { phase: 'browser', status: 'passed', checks, code: 'BROWSER_SCOPED_PASSED' };
  } catch (error) {
    const code = safeCode(error);
    const blocked: readonly BrowserCode[] = [
      'BROWSER_CONFIG_REQUIRED', 'BROWSER_CONFIG_INVALID', 'BROWSER_DEBUG_FORBIDDEN',
      'BROWSER_UNAVAILABLE', 'BROWSER_SSO_REQUIRED', 'BROWSER_MFA_UNSUPPORTED', 'BROWSER_LOGIN_BLOCKED',
    ];
    result = {
      phase: 'browser', status: blocked.includes(code) ? 'blocked' : 'failed', checks,
      code: error instanceof ServiceAcceptanceError ? error.code : code,
    };
  } finally {
    let cleanupFailed = false;
    try { await context?.close(); } catch { cleanupFailed = true; }
    try { await browser?.close(); } catch { cleanupFailed = true; }
    if (cleanupFailed) result = {
      phase: 'browser', status: 'failed', checks,
      code: `BROWSER_CLEANUP_FAILED:prior=${result.code}`,
    };
  }
  // 只输出计数，不输出页面错误、请求地址、凭据、trace 或截图。
  return { ...result, code: `${result.code}:pageErrors=${pageErrors}:consoleErrors=${consoleErrors}:blockedRequests=${blockedRequests}:uiPuts=${writeRequests}:uiListGets=${listRequests}:sdkReads=${sdkReads}:blockedSockets=${blockedSockets}:mfaChallenges=${mfaChallenges}:mfaVerifications=${mfaVerifications}` };
}
