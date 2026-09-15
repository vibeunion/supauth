import {
  decodeSchema, HealthSchema, RuntimeHealthSchema, OAuthServerStatusSchema,
  DiscoverySchema, JWKSSchema, UserPermissionsSchema,
} from '@supauth/shared';

export type ResponseDecoder<T> = (value: unknown) => T;

export interface RequestContract<Input, Result> {
  input: ResponseDecoder<Input>;
  result: ResponseDecoder<Result>;
  request: (input: Input) => { path: string; options?: RequestInit };
}

export class SupaOAuthRequestContractError extends TypeError {
  readonly code = 'SUPAUTH_REQUEST_CONTRACT_INVALID';

  constructor() {
    super('SupaOAuth request contract invalid');
    this.name = 'SupaOAuthRequestContractError';
  }
}

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

export const decodeHealth = (value: unknown) => decodeSchema(HealthSchema, value);
export const decodeRuntimeHealth = (value: unknown) => decodeSchema(RuntimeHealthSchema, value);
export const decodeOAuthServerStatus = (value: unknown) => decodeSchema(OAuthServerStatusSchema, value);
export const decodeDiscovery = (value: unknown) => decodeSchema(DiscoverySchema, value);
export const decodeJWKS = (value: unknown) => decodeSchema(JWKSSchema, value);
export const decodeUserPermissions = (value: unknown) => decodeSchema(UserPermissionsSchema, value);
