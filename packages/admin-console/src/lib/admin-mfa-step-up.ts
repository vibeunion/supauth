import { GoTrueClient } from '@supabase/auth-js';
import type { SSOAuthProvider, SSOSession, TokenStorage } from '@svadmin/sso';

const SESSION_STORAGE_PREFIX = 'supaoauth.admin.sso.';

export interface AdminMfaFactor {
  id: string;
  label: string;
}

export interface AdminMfaStepUpState {
  factors: AdminMfaFactor[];
}

export interface AdminTotpEnrollment {
  factorId: string;
  qrCode: string;
}

type RefreshableSsoSession = SSOSession & { refresh_token: string };
type ExpectedSsoSession = Pick<RefreshableSsoSession, 'access_token' | 'refresh_token'>;

interface GoTrueMfaSession {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_at?: unknown;
  expires_in?: unknown;
}

interface GoTrueMfaClient {
  setSession(input: { access_token: string; refresh_token: string }): Promise<{
    data: { session: GoTrueMfaSession | null };
    error: Error | null;
  }>;
  mfa: {
    enroll(input: { factorType: 'totp'; friendlyName: string; issuer: string }): Promise<{
      data: { id?: unknown; type?: unknown; totp?: { qr_code?: unknown } } | null;
      error: Error | null;
    }>;
    listFactors(): Promise<{
      data: { totp?: Array<{ id?: string; status?: string; friendly_name?: string | null }> } | null;
      error: Error | null;
    }>;
    challengeAndVerify(input: { factorId: string; code: string }): Promise<{
      data: GoTrueMfaSession | null;
      error: Error | null;
    }>;
  };
}

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function adminAuthErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function validRefreshableSsoSession(value: unknown): value is RefreshableSsoSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return typeof session.access_token === 'string'
    && session.access_token.length > 0
    && typeof session.refresh_token === 'string'
    && session.refresh_token.length > 0
    && typeof session.token_type === 'string'
    && session.token_type.length > 0
    && (session.id_token === undefined || typeof session.id_token === 'string')
    && (session.expires_at === undefined || (typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)));
}

function parseRefreshableSsoSession(raw: string | null): RefreshableSsoSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validRefreshableSsoSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function expiresAt(session: GoTrueMfaSession): number | undefined {
  if (typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)) return session.expires_at;
  if (typeof session.expires_in === 'number' && Number.isFinite(session.expires_in)) {
    return Math.floor(Date.now() / 1000) + session.expires_in;
  }
  return undefined;
}

function mfaSessionOrThrow(session: GoTrueMfaSession | null): {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_at?: number;
} {
  if (!session || typeof session.access_token !== 'string' || !session.access_token
    || typeof session.refresh_token !== 'string' || !session.refresh_token) {
    throw new Error('认证服务未返回可用于管理员 MFA 的升级会话。');
  }
  const sessionExpiresAt = expiresAt(session);
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    ...(typeof session.token_type === 'string' && session.token_type ? { token_type: session.token_type } : {}),
    ...(sessionExpiresAt !== undefined ? { expires_at: sessionExpiresAt } : {}),
  };
}

function assertCurrentSsoSession(current: RefreshableSsoSession, expected: ExpectedSsoSession): void {
  if (current.access_token !== expected.access_token || current.refresh_token !== expected.refresh_token) {
    throw new Error('管理员 OAuth 会话在 MFA 验证期间已变化，请使用当前会话重试。');
  }
}

/**
 * 将 @svadmin/sso 限定在单标签页 sessionStorage，并只在它实际写入合法
 * 完整会话后记录 token key。这样 MFA 不依赖未公开的存储键约定。
 */
export class ObservedAdminSsoStorage implements TokenStorage {
  private observedTokenKey: string | null = null;

  constructor(private readonly storage: SessionStorageLike) {}

  getItem(key: string): string | null {
    const storedValue = this.storage.getItem(key);
    if (parseRefreshableSsoSession(storedValue)) this.observedTokenKey = key;
    return storedValue;
  }

  setItem(key: string, value: string): void {
    const session = parseRefreshableSsoSession(value);
    if (session) this.observedTokenKey = key;
    this.storage.setItem(key, value);
  }

  removeItem(key: string): void {
    if (this.observedTokenKey === key) this.observedTokenKey = null;
    this.storage.removeItem(key);
  }

  replaceWithMfaSession(expected: ExpectedSsoSession, upgraded: GoTrueMfaSession): void {
    if (!this.observedTokenKey) throw new Error('管理员 OAuth 会话尚未建立，请重新登录。');
    const current = parseRefreshableSsoSession(this.storage.getItem(this.observedTokenKey));
    if (!current) throw new Error('管理员 OAuth 会话已失效，请重新登录。');
    assertCurrentSsoSession(current, expected);
    const replacement = mfaSessionOrThrow(upgraded);
    const next: SSOSession = {
      ...current,
      access_token: replacement.access_token,
      refresh_token: replacement.refresh_token,
      token_type: replacement.token_type || current.token_type,
      ...(replacement.expires_at !== undefined ? { expires_at: replacement.expires_at } : {}),
    };
    // 一次写入完整 token set；autoRefresh=false 且 storage 为 sessionStorage，避免刷新竞争。
    this.storage.setItem(this.observedTokenKey, JSON.stringify(next));
  }
}

export function createAdminSsoStorage(storage: SessionStorageLike): ObservedAdminSsoStorage {
  return new ObservedAdminSsoStorage(storage);
}

function verifiedTotpFactors(factorPayload: Awaited<ReturnType<GoTrueMfaClient['mfa']['listFactors']>>['data']): AdminMfaFactor[] {
  if (!factorPayload?.totp) return [];
  return factorPayload.totp.flatMap((factor, index) => (
    factor.id && factor.status === 'verified'
      ? [{ id: factor.id, label: factor.friendly_name || `Authenticator ${index + 1}` }]
      : []
  ));
}

function enrollmentOrThrow(enrollment: Awaited<ReturnType<GoTrueMfaClient['mfa']['enroll']>>['data']): AdminTotpEnrollment {
  if (!enrollment || enrollment.type !== 'totp' || typeof enrollment.id !== 'string' || !enrollment.id) {
    throw new Error('认证服务未返回可验证的 TOTP 绑定信息。');
  }
  const qrCode = enrollment.totp?.qr_code;
  if (typeof qrCode !== 'string' || !qrCode.startsWith('data:image/svg+xml;')) {
    throw new Error('认证服务未返回安全的 TOTP 二维码，请重试。');
  }
  return { factorId: enrollment.id, qrCode };
}

export class AdminMfaStepUp {
  constructor(
    private readonly provider: Pick<SSOAuthProvider, 'getSession'>,
    private readonly storage: ObservedAdminSsoStorage,
    private readonly client: GoTrueMfaClient,
  ) {}

  private async mfaContext(): Promise<{ client: GoTrueMfaClient; expected: ExpectedSsoSession }> {
    const session = await this.provider.getSession();
    if (!session?.access_token || !session.refresh_token) {
      throw new Error('管理员 OAuth 会话缺少刷新凭据，请重新登录。');
    }
    const restored = await this.client.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (restored.error || !restored.data.session?.access_token || !restored.data.session.refresh_token) {
      throw new Error(`无法恢复管理员 MFA 会话：${adminAuthErrorMessage(restored.error, '请重新登录。')}`);
    }
    return {
      client: this.client,
      expected: { access_token: session.access_token, refresh_token: session.refresh_token },
    };
  }

  async state(): Promise<AdminMfaStepUpState> {
    const { client } = await this.mfaContext();
    const factors = await client.mfa.listFactors();
    if (factors.error) throw new Error(`无法读取 MFA 验证器：${adminAuthErrorMessage(factors.error, '请重试。')}`);
    return { factors: verifiedTotpFactors(factors.data) };
  }

  async enroll(input: { friendlyName: string; issuer: string }): Promise<AdminTotpEnrollment> {
    const { client } = await this.mfaContext();
    const enrollmentResponse = await client.mfa.enroll({
      factorType: 'totp',
      friendlyName: input.friendlyName,
      issuer: input.issuer,
    });
    if (enrollmentResponse.error) throw new Error(`无法创建 MFA 绑定：${adminAuthErrorMessage(enrollmentResponse.error, '请重试。')}`);
    return enrollmentOrThrow(enrollmentResponse.data);
  }

  async verify(factorId: string, code: string): Promise<void> {
    if (!factorId) throw new Error('请选择已验证的 Authenticator。');
    if (!/^\d{6,8}$/.test(code)) throw new Error('请输入 6 至 8 位动态码。');
    const { client, expected } = await this.mfaContext();
    const result = await client.mfa.challengeAndVerify({ factorId, code });
    if (result.error) throw new Error(`动态码验证失败：${adminAuthErrorMessage(result.error, '请重试。')}`);
    this.storage.replaceWithMfaSession(expected, result.data);
  }
}

export function createAdminMfaStepUp(
  issuer: string,
  provider: Pick<SSOAuthProvider, 'getSession'>,
  storage: ObservedAdminSsoStorage,
): AdminMfaStepUp {
  const client = new GoTrueClient({
    url: issuer.replace(/\/+$/, ''),
    storageKey: `${SESSION_STORAGE_PREFIX}ceremony`,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  return new AdminMfaStepUp(provider, storage, client);
}
