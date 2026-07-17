import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySignInExperience,
  buildAuthConfigPayload,
  buildAuthConfigEndpoint,
  buildSignInExperienceEndpoint,
  extractSignInExperiencePayload,
} from '../scripts/apply-sign-in-experience.js';

const PRESET_PATH = 'config/sign-in-experience/xigu-shujian.json';

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return handler(url, init);
  }) as typeof fetch;
}

describe('sign-in experience deployment presets', () => {
  it('keeps Xigu Shujian as tenant configuration, not a source default', () => {
    const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8')) as unknown;
    const payload = extractSignInExperiencePayload(preset);

    expect(payload.branding?.page_title).toBe('西谷智灯枢鉴系统');
    expect(payload.branding?.button_label).toBe('进入枢鉴');
    expect(payload.branding?.custom_css).toBeNull();
    expect(payload.sign_in_methods).toEqual(['password']);
    expect(payload.sign_up_enabled).toBe(false);
    expect(payload.password_policy?.min_length).toBe(10);
  });

  it('documents the SupAuth versus tenant-configuration boundary', () => {
    const docs = readFileSync('docs/xigu-shujian-config.md', 'utf8');
    const preset = readFileSync('config/sign-in-experience/xigu-shujian.json', 'utf8');

    expect(docs).toContain('落在 SupAuth 的通用能力');
    expect(docs).toContain('通过西谷租户配置实现');
    expect(docs).toContain('不把“西谷智灯枢鉴系统”写入默认源码');
    expect(docs).toContain('**不是**服务端配置的原始 `ADMIN_TOKEN`');
    expect(docs).toContain('password_required_characters');
    expect(docs).toContain('企业 SSO 必须通过已启用的 connector/SAML 配置接入');
    expect(preset).toContain('"supauth_owned"');
    expect(preset).toContain('"tenant_configured"');
  });

  it('defaults to the admin API path and allows direct Function path override', () => {
    expect(buildSignInExperienceEndpoint('https://auth.ai.xigu.team/', undefined)).toBe(
      'https://auth.ai.xigu.team/api/v1/sign-in-experience',
    );
    expect(buildSignInExperienceEndpoint('https://auth.ai.xigu.team', '/v1/sign-in-experience')).toBe(
      'https://auth.ai.xigu.team/v1/sign-in-experience',
    );
    expect(buildAuthConfigEndpoint('https://auth.ai.xigu.team')).toBe(
      'https://auth.ai.xigu.team/api/v1/auth-config',
    );
    expect(buildAuthConfigEndpoint('https://auth.ai.xigu.team', '/v1/sign-in-experience')).toBe(
      'https://auth.ai.xigu.team/v1/auth-config',
    );
  });

  it('strictly rejects unknown fields, invalid methods, booleans, password lengths and content', () => {
    const valid = {
      branding: { page_title: 'Tenant' },
      sign_in_methods: ['password'],
      sign_up_enabled: false,
      password_policy: { min_length: 10, require_uppercase: true },
    };

    expect(() => extractSignInExperiencePayload({ ...valid, unexpected: true })).toThrow('unknown field');
    expect(() => extractSignInExperiencePayload({ ...valid, sign_in_methods: ['password', 'sso'] })).toThrow(
      'sign_in_methods[1]',
    );
    expect(() => extractSignInExperiencePayload({ ...valid, sign_up_enabled: 'false' })).toThrow(
      'sign_up_enabled must be a boolean',
    );
    expect(() => extractSignInExperiencePayload({
      ...valid,
      password_policy: { min_length: 2 },
    })).toThrow('integer from 6 to 128');
    expect(() => extractSignInExperiencePayload({
      ...valid,
      password_policy: {
        min_length: 10,
        require_uppercase: false,
        require_lowercase: true,
        require_numbers: true,
        require_symbols: false,
      },
    })).toThrow('cannot be represented exactly');
    expect(() => extractSignInExperiencePayload({
      ...valid,
      branding: {
        page_title: 'Tenant',
        content: { layout: 'features', items: [{ title: 'Feature', html: '<script>' }] },
      },
    })).toThrow('unknown field');
  });

  it('maps only exactly representable GoTrue password character combinations', () => {
    const acceptedMasks = new Set([0, 7, 15]);
    for (let mask = 0; mask < 16; mask += 1) {
      const config = {
        branding: { page_title: 'Tenant' },
        password_policy: {
          min_length: 10,
          require_uppercase: Boolean(mask & 1),
          require_lowercase: Boolean(mask & 2),
          require_numbers: Boolean(mask & 4),
          require_symbols: Boolean(mask & 8),
        },
      };
      if (acceptedMasks.has(mask)) {
        expect(() => extractSignInExperiencePayload(config)).not.toThrow();
      } else {
        expect(() => extractSignInExperiencePayload(config)).toThrow('cannot be represented exactly');
      }
    }

    expect(buildAuthConfigPayload(extractSignInExperiencePayload({
      branding: { page_title: 'Tenant' },
      password_policy: {
        require_uppercase: false,
        require_lowercase: false,
        require_numbers: false,
        require_symbols: false,
      },
    }))).toEqual({ password_required_characters: '' });
    expect(buildAuthConfigPayload(extractSignInExperiencePayload({
      branding: { page_title: 'Tenant' },
      password_policy: {
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_symbols: true,
      },
    }))).toEqual({
      password_required_characters:
        "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~",
    });

    const fullCharacterSet = buildAuthConfigPayload(extractSignInExperiencePayload({
      branding: { page_title: 'Tenant' },
      password_policy: {
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_symbols: true,
      },
    })).password_required_characters as string;
    expect(fullCharacterSet.length).toBe(98);
    expect([...fullCharacterSet].slice(-25, -9).map(char => char.charCodeAt(0))).toEqual([
      40, 41, 95, 43, 45, 61, 91, 93, 123, 125, 59, 39, 92, 92, 58, 34,
    ]);
  });

  it('requires an exchanged session/SSO bearer before making any live request', async () => {
    let called = false;
    const fetchImpl = mockFetch(() => {
      called = true;
      return new Response('{}');
    });

    await expect(applySignInExperience({
      baseUrl: 'https://auth.example.test',
      configPath: PRESET_PATH,
      fetchImpl,
    })).rejects.toThrow('exchanged admin session token or SSO bearer');
    expect(called).toBe(false);

    await expect(applySignInExperience({
      baseUrl: 'https://auth.example.test',
      configPath: PRESET_PATH,
      token: 'Bearer session-token',
      fetchImpl,
    })).rejects.toThrow('without the "Bearer " prefix');
    expect(called).toBe(false);
  });

  it('updates GoTrue first, updates the overlay, then reads both resources back', async () => {
    const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8')) as { sign_in_experience: Record<string, unknown> };
    const payload = extractSignInExperiencePayload(preset);
    const expectedAuthConfig = {
      enable_signup: false,
      disable_signup: true,
      password_min_length: 10,
      password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
    };
    const calls: Array<{
      method: string;
      pathname: string;
      authorization: string | null;
      contentType: string | null;
      body: unknown;
    }> = [];

    const fetchImpl = mockFetch((url, init) => {
      const method = init?.method || 'GET';
      const headers = new Headers(init?.headers);
      calls.push({
        method,
        pathname: new URL(url).pathname,
        authorization: headers.get('authorization'),
        contentType: headers.get('content-type'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null,
      });

      if (method === 'PATCH') {
        return Response.json(expectedAuthConfig, { status: 200 });
      }
      if (method === 'PUT') {
        return Response.json(payload, { status: 200 });
      }
      if (new URL(url).pathname.endsWith('/auth-config')) {
        return Response.json({ ...expectedAuthConfig, jwt_expiry: 3600 }, { status: 200 });
      }
      return Response.json({ ...payload, _meta: { id: 'sign-in-config' } }, { status: 200 });
    });

    const result = await applySignInExperience({
      baseUrl: 'https://auth.example.test/',
      configPath: PRESET_PATH,
      bearerToken: 'session-token-123',
      fetchImpl,
    });

    expect(calls.map(call => `${call.method} ${call.pathname}`)).toEqual([
      'PATCH /api/v1/auth-config',
      'PUT /api/v1/sign-in-experience',
      'GET /api/v1/auth-config',
      'GET /api/v1/sign-in-experience',
    ]);
    expect(calls.every(call => call.authorization === 'Bearer session-token-123')).toBe(true);
    expect(calls.every(call => call.contentType === 'application/json')).toBe(true);
    expect(calls[0]?.body).toEqual(expectedAuthConfig);
    expect(calls[1]?.body).toEqual(payload);
    expect(result.verified).toBe(true);
    expect(result.authConfig).toMatchObject({ payload: expectedAuthConfig, readBackStatus: 200 });
  });

  it('reports the exact failed stage and stops before changing the overlay', async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push(`${init?.method || 'GET'} ${new URL(url).pathname}`);
      return new Response('management API unavailable', { status: 503 });
    });

    await expect(applySignInExperience({
      baseUrl: 'https://auth.example.test',
      configPath: PRESET_PATH,
      token: 'session-token-123',
      fetchImpl,
    })).rejects.toThrow('auth-config update stage failed');
    expect(calls).toEqual(['PATCH /api/v1/auth-config']);
  });

  it('validates an invalid file payload before invoking fetch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'supauth-sign-in-preset-'));
    const configPath = join(root, 'invalid.json');
    writeFileSync(configPath, JSON.stringify({
      sign_in_experience: {
        branding: { page_title: 'Tenant', content: { illustration: 'unknown' } },
      },
    }));
    let called = false;

    try {
      await expect(applySignInExperience({
        baseUrl: 'https://auth.example.test',
        configPath,
        token: 'session-token-123',
        fetchImpl: mockFetch(() => {
          called = true;
          return new Response('{}');
        }),
      })).rejects.toThrow('illustration must be one of');
      expect(called).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
