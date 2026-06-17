import { describe, it, expect, beforeEach } from 'bun:test';
import { loadConfig, validateConfig } from '../config/index.js';

describe('ServerConfig', () => {
  beforeEach(() => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.NODE_ENV;
    delete process.env.SUPACLOUD_API_URL;
    delete process.env.SUPACLOUD_INTERNAL_API_URL;
    delete process.env.SUPACLOUD_MANAGEMENT_API_URL;
    delete process.env.SUPACLOUD_MASTER_TOKEN;
    delete process.env.SUPACLOUD_INTERNAL_TOKEN;
    delete process.env.SUPACLOUD_SERVICE_TOKEN;
    delete process.env.PROJECT_REF;
    delete process.env.SUPACLOUD_PROJECT_REF;
    delete process.env.SUPABASE_PROJECT_REF;
    delete process.env.OAUTH_RUNTIME_URL;
    delete process.env.SUPACLOUD_RUNTIME_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.OAUTH_RUNTIME_INTERNAL_URL;
    delete process.env.GOTRUE_INTERNAL_URL;
    delete process.env.SUPACLOUD_RUNTIME_INTERNAL_URL;
    delete process.env.SUPAUTH_PUBLIC_URL;
    delete process.env.AUTH_PUBLIC_URL;
    delete process.env.SUPAUTH_INSTALLED_BASE_URL;
    delete process.env.SUPAUTH_BASE_URL;
    delete process.env.OAUTH_PUBLIC_BASE_URL;
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.RUNTIME_MODE;
    delete process.env.CORS_ORIGINS;
    delete process.env.LOG_LEVEL;
    delete process.env.DATABASE_URL;
    delete process.env.SUPACLOUD_DATABASE_URL;
    delete process.env.SUPABASE_DB_URL;
  });

  it('returns defaults when env vars are not set', () => {
    const config = loadConfig();
    expect(config.port).toBe(4010);
    expect(config.host).toBe('0.0.0.0');
    expect(config.nodeEnv).toBe('development');
    expect(config.runtimeMode).toBe('gotrue');
    expect(config.logLevel).toBe('info');
    expect(config.trustProxyHeaders).toBe(false);
  });

  it('validates missing required config', () => {
    const config = loadConfig();
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContain('SUPACLOUD_API_URL or SUPACLOUD_INTERNAL_API_URL is required');
    expect(errors).toContain('SUPACLOUD_MASTER_TOKEN or SUPACLOUD_INTERNAL_TOKEN is required');
    expect(errors).toContain('PROJECT_REF or SUPACLOUD_PROJECT_REF is required');
    expect(errors).toContain('OAUTH_RUNTIME_URL, SUPACLOUD_RUNTIME_URL, or SUPABASE_URL is required');
    expect(errors).toContain('DATABASE_URL or SUPACLOUD_DATABASE_URL is required');
  });

  it('passes validation with all required fields', () => {
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.OAUTH_RUNTIME_URL = 'http://localhost:9999';
    process.env.DATABASE_URL = 'postgres://localhost/supaoauth';
    const config = loadConfig();
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);
  });

  it('uses SupaCloud project injected env aliases', () => {
    process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
    process.env.SUPACLOUD_INTERNAL_TOKEN = 'internal-token';
    process.env.SUPACLOUD_PROJECT_REF = 'project-from-supacloud';
    process.env.SUPACLOUD_RUNTIME_URL = 'https://runtime.example.test';
    process.env.SUPAUTH_PUBLIC_URL = 'https://auth.example.test';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://supacloud/project';
    const config = loadConfig();
    expect(config.supacloudApiUrl).toBe('http://supacloud.internal');
    expect(config.supacloudMasterToken).toBe('internal-token');
    expect(config.projectRef).toBe('project-from-supacloud');
    expect(config.oauthRuntimeUrl).toBe('https://runtime.example.test');
    expect(config.publicBaseUrl).toBe('https://auth.example.test');
    expect(config.databaseUrl).toBe('postgres://supacloud/project');
    expect(validateConfig(config)).toHaveLength(0);
  });

  it('supports legacy installed base URL while preferring neutral public URL names', () => {
    process.env.AUTH_PUBLIC_URL = 'https://auth-neutral.example.test';
    process.env.SUPAUTH_INSTALLED_BASE_URL = 'https://auth-installed.example.test';

    const config = loadConfig();

    expect(config.publicBaseUrl).toBe('https://auth-neutral.example.test');
  });

  it('rejects invalid public auth URL at config validation time', () => {
    process.env.SUPAUTH_PUBLIC_URL = 'not a url';

    const config = loadConfig();
    const errors = validateConfig(config);

    expect(errors).toContain('SUPAUTH_PUBLIC_URL or AUTH_PUBLIC_URL must be a valid http(s) URL');
  });

  it('requires explicit public auth URL in production', () => {
    process.env.NODE_ENV = 'production';

    const config = loadConfig();
    const errors = validateConfig(config);

    expect(errors).toContain('SUPAUTH_PUBLIC_URL or AUTH_PUBLIC_URL is required when NODE_ENV=production');
  });

  it('enables trusted proxy headers only when explicitly configured', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    const config = loadConfig();

    expect(config.trustProxyHeaders).toBe(true);
  });

  it('prefers the SupaCloud project database URL over a platform DATABASE_URL', () => {
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://supacloud/project';
    process.env.DATABASE_URL = 'postgres://platform/meta';
    const config = loadConfig();
    expect(config.databaseUrl).toBe('postgres://supacloud/project');
  });

  it('rejects invalid runtime mode', () => {
    process.env.RUNTIME_MODE = 'invalid';
    const config = loadConfig();
    const errors = validateConfig(config);
    expect(errors).toContain('RUNTIME_MODE must be "gotrue" or "external_oidc"');
  });

  it('uses custom port from env', () => {
    process.env.PORT = '8080';
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it('uses dedicated internal runtime URL when provided', () => {
    process.env.OAUTH_RUNTIME_URL = 'https://api.example.com/auth/v1';
    process.env.OAUTH_RUNTIME_INTERNAL_URL = 'http://127.0.0.1:3210';
    const config = loadConfig();
    expect(config.oauthRuntimeUrl).toBe('https://api.example.com/auth/v1');
    expect(config.oauthRuntimeInternalUrl).toBe('http://127.0.0.1:3210');
  });
});
