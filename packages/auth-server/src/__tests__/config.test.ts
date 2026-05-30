import { describe, it, expect, beforeEach } from 'bun:test';
import { loadConfig, validateConfig } from '../config/index.js';

describe('ServerConfig', () => {
  beforeEach(() => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.SUPACLOUD_API_URL;
    delete process.env.SUPACLOUD_MASTER_TOKEN;
    delete process.env.PROJECT_REF;
    delete process.env.OAUTH_RUNTIME_URL;
    delete process.env.OAUTH_RUNTIME_INTERNAL_URL;
    delete process.env.GOTRUE_INTERNAL_URL;
    delete process.env.RUNTIME_MODE;
    delete process.env.CORS_ORIGINS;
    delete process.env.LOG_LEVEL;
    delete process.env.DATABASE_URL;
  });

  it('returns defaults when env vars are not set', () => {
    const config = loadConfig();
    expect(config.port).toBe(4010);
    expect(config.host).toBe('0.0.0.0');
    expect(config.runtimeMode).toBe('gotrue');
    expect(config.logLevel).toBe('info');
  });

  it('validates missing required config', () => {
    const config = loadConfig();
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContain('SUPACLOUD_MASTER_TOKEN is required');
    expect(errors).toContain('PROJECT_REF is required');
    expect(errors).toContain('DATABASE_URL is required');
  });

  it('passes validation with all required fields', () => {
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.DATABASE_URL = 'postgres://localhost/supaoauth';
    const config = loadConfig();
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);
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
