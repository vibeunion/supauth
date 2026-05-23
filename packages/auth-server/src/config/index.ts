// SupaOAuth server configuration — loaded from server-side env only (no VITE_)

export interface ServerConfig {
  port: number;
  host: string;
  supacloudApiUrl: string;
  supacloudMasterToken: string;
  projectRef: string;
  oauthRuntimeUrl: string;
  runtimeMode: 'gotrue' | 'external_oidc';
  databaseUrl: string;
  corsOrigins: string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

let _config: ServerConfig | null = null;

export function loadConfig(): ServerConfig {
  _config = {
    port: parseInt(process.env.PORT || '4000', 10),
    host: process.env.HOST || '0.0.0.0',
    supacloudApiUrl: process.env.SUPACLOUD_API_URL || 'http://localhost:9090',
    supacloudMasterToken: process.env.SUPACLOUD_MASTER_TOKEN || '',
    projectRef: process.env.PROJECT_REF || '',
    oauthRuntimeUrl: process.env.OAUTH_RUNTIME_URL || 'http://localhost:9999',
    runtimeMode: (process.env.RUNTIME_MODE as ServerConfig['runtimeMode']) || 'gotrue',
    databaseUrl: process.env.DATABASE_URL || '',
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
    logLevel: (process.env.LOG_LEVEL as ServerConfig['logLevel']) || 'info',
  };
  return _config;
}

export function getConfig(): ServerConfig {
  return _config ?? loadConfig();
}

export function validateConfig(config: ServerConfig): string[] {
  const errors: string[] = [];
  if (!config.supacloudApiUrl) errors.push('SUPACLOUD_API_URL is required');
  if (!config.supacloudMasterToken) errors.push('SUPACLOUD_MASTER_TOKEN is required');
  if (!config.projectRef) errors.push('PROJECT_REF is required');
  if (!config.databaseUrl) errors.push('DATABASE_URL is required');
  if (!['gotrue', 'external_oidc'].includes(config.runtimeMode)) {
    errors.push('RUNTIME_MODE must be "gotrue" or "external_oidc"');
  }
  return errors;
}
