export type OAuthSessionRequirement = 'authorization-code' | 'refreshable';

export interface OAuthApplicationSessionOptions {
  sessionRequirement?: OAuthSessionRequirement;
}

export interface CreateOAuthClientInput {
  redirect_uris: string[];
  client_name?: string;
  client_type?: 'public' | 'confidential';
  token_endpoint_auth_method?: 'none' | 'client_secret_basic' | 'client_secret_post';
  grant_types?: string[];
  client_uri?: string;
  logo_uri?: string;
}

export class SupaOAuthSessionConfigurationError extends Error {
  readonly code = 'SUPAUTH_SESSION_CONFIGURATION_INVALID';

  constructor(
    readonly reason: 'invalid_requirement' | 'invalid_grant_types' | 'missing_grant',
    readonly missingGrants: readonly string[] = [],
  ) {
    super(reason === 'missing_grant'
      ? `OAuth client is missing required grants: ${missingGrants.join(', ')}`
      : 'Invalid OAuth session configuration');
    this.name = 'SupaOAuthSessionConfigurationError';
  }
}

/** 只检查声明的会话需求，不修改授权、回调、客户端类型或密钥。 */
export function assertOAuthSessionGrants(
  client: unknown,
  requirement: OAuthSessionRequirement,
): void {
  if (requirement !== 'authorization-code' && requirement !== 'refreshable') {
    throw new SupaOAuthSessionConfigurationError('invalid_requirement');
  }
  if (!client || typeof client !== 'object' || !('grant_types' in client)
    || !Array.isArray(client.grant_types)
    || client.grant_types.some((grant: unknown) => typeof grant !== 'string')) {
    throw new SupaOAuthSessionConfigurationError('invalid_grant_types');
  }
  const grants = client.grant_types;
  const required = requirement === 'refreshable'
    ? ['authorization_code', 'refresh_token']
    : ['authorization_code'];
  const missing = required.filter((grant) => !grants.includes(grant));
  if (missing.length) throw new SupaOAuthSessionConfigurationError('missing_grant', missing);
}
