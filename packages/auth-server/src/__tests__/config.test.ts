import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { enforceStartupConfig, loadConfig, validateConfig } from '../config/index.js';

const REQUIRED_CONFIG_ENV_NAMES = [
  'SUPACLOUD_API_URL',
  'SUPACLOUD_INTERNAL_API_URL',
  'SUPACLOUD_MANAGEMENT_API_URL',
  'SUPACLOUD_INTERNAL_SUPABASE_URL',
  'SUPACLOUD_MASTER_TOKEN',
  'SUPACLOUD_INTERNAL_TOKEN',
  'SUPACLOUD_SERVICE_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPAOAUTH_BFF_SIGNING_SECRET',
  'PROJECT_REF',
  'SUPACLOUD_PROJECT_REF',
  'SUPABASE_PROJECT_REF',
  'OAUTH_RUNTIME_URL',
  'SUPACLOUD_RUNTIME_URL',
  'SUPABASE_URL',
  'SUPAUTH_PUBLIC_URL',
  'AUTH_PUBLIC_URL',
  'SUPAUTH_INSTALLED_BASE_URL',
  'SUPAUTH_BASE_URL',
  'OAUTH_PUBLIC_BASE_URL',
  'DATABASE_URL',
  'SUPACLOUD_DATABASE_URL',
  'SUPABASE_DB_URL',
] as const;

function productionEnvWithoutRequiredConfig(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: 'production' };
  for (const name of REQUIRED_CONFIG_ENV_NAMES) {
    env[name] = '';
    env[`EDGEFN_SUPAUTH_${name}`] = '';
  }
  return env;
}

describe('ServerConfig', () => {
  beforeEach(() => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.NODE_ENV;
    delete process.env.SUPACLOUD_API_URL;
    delete process.env.SUPACLOUD_INTERNAL_API_URL;
    delete process.env.SUPACLOUD_MANAGEMENT_API_URL;
    delete process.env.SUPACLOUD_INTERNAL_SUPABASE_URL;
    delete process.env.SUPACLOUD_MASTER_TOKEN;
    delete process.env.SUPACLOUD_INTERNAL_TOKEN;
    delete process.env.SUPACLOUD_SERVICE_TOKEN;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPAOAUTH_BFF_SIGNING_SECRET;
    delete process.env.PROJECT_REF;
    delete process.env.SUPACLOUD_PROJECT_REF;
    delete process.env.SUPABASE_PROJECT_REF;
    delete process.env.SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF;
    delete process.env.OAUTH_AUTHORIZATION_PROJECT_REF;
    delete process.env.GOTRUE_AUTHORIZATION_PROJECT_REF;
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
    expect(errors).toContain('SUPACLOUD_API_URL, SUPACLOUD_INTERNAL_API_URL, or SUPACLOUD_INTERNAL_SUPABASE_URL is required');
    expect(errors).toContain('SUPACLOUD_MASTER_TOKEN or SUPACLOUD_INTERNAL_TOKEN is required');
    expect(errors).toContain('SUPABASE_SERVICE_ROLE_KEY is required');
    expect(errors).toContain('PROJECT_REF or SUPACLOUD_PROJECT_REF is required');
    expect(errors).toContain('OAUTH_RUNTIME_URL, SUPACLOUD_RUNTIME_URL, or SUPABASE_URL is required');
    expect(errors).toContain('DATABASE_URL or SUPACLOUD_DATABASE_URL is required');
  });

  it('passes validation with all required fields', () => {
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-storage-token';
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'test-bff-signing-secret-0123456789abcdef';
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
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-storage-token';
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'internal-bff-signing-secret-0123456789abcdef';
    process.env.SUPACLOUD_PROJECT_REF = 'project-from-supacloud';
    process.env.SUPACLOUD_RUNTIME_URL = 'https://runtime.example.test';
    process.env.SUPAUTH_PUBLIC_URL = 'https://auth.example.test';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://supacloud/project';
    const config = loadConfig();
    expect(config.supacloudApiUrl).toBe('http://supacloud.internal');
    expect(config.supacloudMasterToken).toBe('internal-token');
    expect(config.supabaseServiceRoleKey).toBe('test-storage-token');
    expect(config.projectRef).toBe('project-from-supacloud');
    expect(config.oauthRuntimeUrl).toBe('https://runtime.example.test');
    expect(config.publicBaseUrl).toBe('https://auth.example.test');
    expect(config.databaseUrl).toBe('postgres://supacloud/project');
    expect(validateConfig(config)).toHaveLength(0);
  });

  it('accepts the SupaCloud edge-runtime internal management URL alias', () => {
    process.env.SUPACLOUD_INTERNAL_SUPABASE_URL = 'http://127.0.0.1:9090';
    process.env.SUPACLOUD_INTERNAL_TOKEN = 'internal-token';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-storage-token';
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'edge-bff-signing-secret-0123456789abcdef';
    process.env.SUPACLOUD_PROJECT_REF = 'project-from-supacloud';
    process.env.SUPACLOUD_RUNTIME_URL = 'https://runtime.example.test';
    process.env.SUPAUTH_PUBLIC_URL = 'https://auth.example.test';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://supacloud/project';

    const config = loadConfig();

    expect(config.supacloudApiUrl).toBe('http://127.0.0.1:9090');
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

  it('refuses to register the app when production config is incomplete', () => {
    const projectRoot = fileURLToPath(new URL('../../../..', import.meta.url));
    const entrypointImport = Bun.spawnSync({
      cmd: [process.execPath, '-e', "await import('./packages/auth-server/src/index.ts')"],
      cwd: projectRoot,
      env: productionEnvWithoutRequiredConfig(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = new TextDecoder().decode(entrypointImport.stderr);

    expect(entrypointImport.exitCode).not.toBe(0);
    expect(stderr).toContain('SupaOAuth configuration is invalid:');
    expect(stderr).toContain('SUPACLOUD_MASTER_TOKEN or SUPACLOUD_INTERNAL_TOKEN is required');
    expect(stderr).toContain('SUPABASE_SERVICE_ROLE_KEY is required');
    expect(stderr).toContain('PROJECT_REF or SUPACLOUD_PROJECT_REF is required');
    expect(stderr).toContain('OAUTH_RUNTIME_URL, SUPACLOUD_RUNTIME_URL, or SUPABASE_URL is required');
    expect(stderr).toContain('DATABASE_URL or SUPACLOUD_DATABASE_URL is required');
    expect(stderr).toContain('SUPAOAUTH_BFF_SIGNING_SECRET is required');
    expect(stderr).toContain('SUPAUTH_PUBLIC_URL or AUTH_PUBLIC_URL is required when NODE_ENV=production');
  });

  it('does not disclose configured values in production startup errors', () => {
    const sensitiveToken = 'sensitive-management-token-0123456789abcdef';
    const sensitiveStorageToken = 'sensitive-storage-token-0123456789abcdef';
    const sensitivePublicUrl = 'sensitive-public-url-value';
    process.env.NODE_ENV = 'production';
    process.env.SUPACLOUD_MASTER_TOKEN = sensitiveToken;
    process.env.SUPABASE_SERVICE_ROLE_KEY = sensitiveStorageToken;
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = sensitiveToken;
    process.env.SUPAUTH_PUBLIC_URL = sensitivePublicUrl;
    const config = loadConfig();
    let startupErrorMessage = '';

    try {
      enforceStartupConfig(config);
    } catch (error) {
      startupErrorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(startupErrorMessage).toContain('SupaOAuth configuration is invalid:');
    expect(startupErrorMessage).not.toContain(sensitiveToken);
    expect(startupErrorMessage).not.toContain(sensitiveStorageToken);
    expect(startupErrorMessage).not.toContain(sensitivePublicUrl);
  });

  it('keeps incomplete development config as a warning', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(() => enforceStartupConfig(loadConfig())).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'SupaOAuth config warnings:',
        expect.stringContaining('SUPACLOUD_MASTER_TOKEN or SUPACLOUD_INTERNAL_TOKEN is required'),
      );
    } finally {
      warn.mockRestore();
    }
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

  it('fails closed for every non-GoTrue runtime mode', () => {
    for (const runtimeMode of ['external_oidc', 'invalid']) {
      process.env.RUNTIME_MODE = runtimeMode;
      expect(() => loadConfig()).toThrow('RUNTIME_MODE must be "gotrue"');
    }
  });

  it('requires an independent 32-character BFF signing secret', () => {
    const missing = validateConfig(loadConfig());
    expect(missing).toContain('SUPAOAUTH_BFF_SIGNING_SECRET is required');

    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'short-secret';
    expect(validateConfig(loadConfig())).toContain('SUPAOAUTH_BFF_SIGNING_SECRET must be at least 32 characters');

    process.env.SUPACLOUD_MASTER_TOKEN = 'shared-token-that-is-at-least-32-characters';
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'shared-token-that-is-at-least-32-characters';
    expect(validateConfig(loadConfig())).toContain('SUPAOAUTH_BFF_SIGNING_SECRET must be independent from the SupaCloud token');
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

  it('prefers dedicated OAuth internal runtime URL over stale SupaCloud runtime URL', () => {
    process.env.OAUTH_RUNTIME_URL = 'https://auth.example.test/auth/v1';
    process.env.OAUTH_RUNTIME_INTERNAL_URL = 'http://127.0.0.1:3372';
    process.env.SUPACLOUD_RUNTIME_INTERNAL_URL = 'http://127.0.0.1:3367';

    const config = loadConfig();

    expect(config.oauthRuntimeInternalUrl).toBe('http://127.0.0.1:3372');
  });

  it('uses a dedicated OAuth authorization project ref when configured', () => {
    process.env.PROJECT_REF = 'business-project';
    process.env.SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF = 'central-idp-project';

    const config = loadConfig();

    expect(config.projectRef).toBe('business-project');
    expect(config.oauthAuthorizationProjectRef).toBe('central-idp-project');
  });
});
