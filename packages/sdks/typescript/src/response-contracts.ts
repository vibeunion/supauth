import type { RuntimeMode } from '@supauth/shared';

export type ResponseDecoder<T> = (value: unknown) => T;

export class SupaOAuthResponseContractError extends Error {
  readonly code = 'SUPAUTH_RESPONSE_CONTRACT_INVALID';

  constructor(
    readonly path: string,
    readonly status: number,
    readonly reason: 'invalid_json' | 'unexpected_no_content' | 'invalid_payload',
  ) {
    // 不保留响应正文或解码器异常，避免令牌、用户资料进入诊断。
    super(`SupaOAuth response contract failed (${reason})`);
    this.name = 'SupaOAuthResponseContractError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected string');
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected boolean');
  return value;
}

export function decodeHealth(value: unknown) {
  const data = record(value);
  if (data.runtime_mode !== 'gotrue') throw new TypeError('Unsupported runtime mode');
  const runtimeMode: RuntimeMode = data.runtime_mode;
  return { status: string(data.status), runtime_mode: runtimeMode, project_ref: string(data.project_ref) };
}

export function decodeRuntimeHealth(value: unknown) {
  return { status: string(record(value).status) };
}

export function decodeOAuthServerStatus(value: unknown) {
  const data = record(value);
  return {
    enabled: boolean(data.enabled),
    signing_alg: string(data.signing_alg),
    allow_dynamic_registration: boolean(data.allow_dynamic_registration),
    ...(data.migration_status === undefined ? {} : { migration_status: string(data.migration_status) }),
  };
}

export function decodeDiscovery(value: unknown) {
  const data = record(value);
  const result = {
    ...data,
    issuer: string(data.issuer),
    authorization_endpoint: string(data.authorization_endpoint),
    token_endpoint: string(data.token_endpoint),
    userinfo_endpoint: string(data.userinfo_endpoint),
    jwks_uri: string(data.jwks_uri),
  };
  const withMetadata: typeof result & Record<string, unknown> = result;
  return withMetadata;
}

export function decodeJWKS(value: unknown) {
  const data = record(value);
  if (!Array.isArray(data.keys)) throw new TypeError('Expected keys array');
  return { keys: data.keys.map(record) };
}
