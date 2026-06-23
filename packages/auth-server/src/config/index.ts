// SupaOAuth server configuration — loaded from server-side env only (no VITE_)

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  supacloudApiUrl: string;
  supacloudMasterToken: string;
  projectRef: string;
  oauthAuthorizationProjectRef: string;
  oauthRuntimeUrl: string;
  oauthRuntimeInternalUrl: string;
  publicBaseUrl: string;
  trustProxyHeaders: boolean;
  runtimeMode: 'gotrue' | 'external_oidc';
  databaseUrl: string;
  corsOrigins: string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  // OIDC Provider (external_oidc mode only)
  oidcIssuer: string;
  oidcSigningKeyPath: string;
  oidcRsaSigningKeyPath: string;
  oidcSessionTtlSec: number;
  oidcCodeTtlSec: number;
  oidcRefreshTokenTtlSec: number;
}

let _config: ServerConfig | null = null;

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

function booleanEnv(name: string, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function loadConfig(): ServerConfig {
  const runtimeUrl = env('OAUTH_RUNTIME_URL', 'SUPACLOUD_RUNTIME_URL', 'SUPABASE_URL');

  _config = {
    port: parseInt(process.env.PORT || '4010', 10),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
    supacloudApiUrl: env(
      'SUPACLOUD_API_URL',
      'SUPACLOUD_INTERNAL_API_URL',
      'SUPACLOUD_MANAGEMENT_API_URL',
      'SUPACLOUD_INTERNAL_SUPABASE_URL',
    ),
    supacloudMasterToken: env('SUPACLOUD_MASTER_TOKEN', 'SUPACLOUD_INTERNAL_TOKEN', 'SUPACLOUD_SERVICE_TOKEN'),
    projectRef: env('PROJECT_REF', 'SUPACLOUD_PROJECT_REF', 'SUPABASE_PROJECT_REF'),
    oauthAuthorizationProjectRef: env(
      'SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF',
      'OAUTH_AUTHORIZATION_PROJECT_REF',
      'GOTRUE_AUTHORIZATION_PROJECT_REF',
    ),
    oauthRuntimeUrl: runtimeUrl,
    oauthRuntimeInternalUrl: env('SUPACLOUD_RUNTIME_INTERNAL_URL', 'OAUTH_RUNTIME_INTERNAL_URL', 'GOTRUE_INTERNAL_URL') || runtimeUrl,
    publicBaseUrl: env('SUPAUTH_PUBLIC_URL', 'AUTH_PUBLIC_URL', 'SUPAUTH_INSTALLED_BASE_URL', 'SUPAUTH_BASE_URL', 'OAUTH_PUBLIC_BASE_URL'),
    trustProxyHeaders: booleanEnv('TRUST_PROXY_HEADERS'),
    runtimeMode: (process.env.RUNTIME_MODE as ServerConfig['runtimeMode']) || 'gotrue',
    databaseUrl: env('SUPACLOUD_DATABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL'),
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
    logLevel: (process.env.LOG_LEVEL as ServerConfig['logLevel']) || 'info',
    oidcIssuer: process.env.OAUTH_ISSUER || '',
    oidcSigningKeyPath: process.env.OIDC_SIGNING_KEY_PATH || '',
    oidcRsaSigningKeyPath: process.env.OIDC_RSA_SIGNING_KEY_PATH || '',
    oidcSessionTtlSec: parseInt(process.env.OIDC_SESSION_TTL_SEC || '1209600', 10), // 14 days
    oidcCodeTtlSec: parseInt(process.env.OIDC_CODE_TTL_SEC || '300', 10), // 5 min
    oidcRefreshTokenTtlSec: parseInt(process.env.OIDC_REFRESH_TOKEN_TTL_SEC || '2592000', 10), // 30 days
  };
  return _config;
}

export function getConfig(): ServerConfig {
  return _config ?? loadConfig();
}

export function validateConfig(config: ServerConfig): string[] {
  const errors: string[] = [];
  if (!config.supacloudApiUrl) {
    errors.push('SUPACLOUD_API_URL, SUPACLOUD_INTERNAL_API_URL, or SUPACLOUD_INTERNAL_SUPABASE_URL is required');
  }
  if (!config.supacloudMasterToken) errors.push('SUPACLOUD_MASTER_TOKEN or SUPACLOUD_INTERNAL_TOKEN is required');
  if (!config.projectRef) errors.push('PROJECT_REF or SUPACLOUD_PROJECT_REF is required');
  if (!config.oauthRuntimeUrl) errors.push('OAUTH_RUNTIME_URL, SUPACLOUD_RUNTIME_URL, or SUPABASE_URL is required');
  if (config.publicBaseUrl && !isHttpUrl(config.publicBaseUrl)) {
    errors.push('SUPAUTH_PUBLIC_URL or AUTH_PUBLIC_URL must be a valid http(s) URL');
  }
  if (config.nodeEnv === 'production' && !config.publicBaseUrl) {
    errors.push('SUPAUTH_PUBLIC_URL or AUTH_PUBLIC_URL is required when NODE_ENV=production');
  }
  if (!config.databaseUrl) errors.push('DATABASE_URL or SUPACLOUD_DATABASE_URL is required');
  if (!['gotrue', 'external_oidc'].includes(config.runtimeMode)) {
    errors.push('RUNTIME_MODE must be "gotrue" or "external_oidc"');
  }
  if (config.runtimeMode === 'external_oidc') {
    if (!config.oidcIssuer) errors.push('OAUTH_ISSUER is required in external_oidc mode');
    if (!config.oidcSigningKeyPath && !config.oidcRsaSigningKeyPath) {
      errors.push('OIDC_SIGNING_KEY_PATH or OIDC_RSA_SIGNING_KEY_PATH is required in external_oidc mode');
    }
  }
  return errors;
}
