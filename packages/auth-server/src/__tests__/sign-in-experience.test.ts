import { describe, expect, it } from 'bun:test';
import { GOTRUE_PASSWORD_CHARACTER_POLICIES } from '../utils/password-policy.js';

describe('Sign-in experience repository — module structure', () => {
  it('exports global and application-level experience functions', async () => {
    const repo = await import('../repositories/sign-in-experience.js');
    const expectedFns = [
      'getSignInExperience',
      'updateSignInExperience',
      'getApplicationSignInExperience',
      'upsertApplicationSignInExperience',
      'deleteApplicationSignInExperience',
      'resolveSignInExperience',
      'mergeSupaCloudBrandingDefaults',
    ];

    for (const fn of expectedFns) {
      expect(typeof (repo as Record<string, unknown>)[fn]).toBe('function');
    }
  });

  it('uses SupaCloud project fields as tenant-level branding defaults', async () => {
    const { mergeSupaCloudBrandingDefaults } = await import('../repositories/sign-in-experience.js');
    const branding = mergeSupaCloudBrandingDefaults({
      page_title: 'SupaOAuth',
      logo_url: null,
      favicon_url: null,
      primary_color: null,
    }, {
      project: {
        name: 'Volt',
        config: {
          branding: {
            logo_url: 'https://assets.example.com/volt-logo.png',
            primary_color: '#635bff',
          },
        },
      },
    });

    expect(branding.page_title).toBe('Volt');
    expect(branding.logo_url).toBe('https://assets.example.com/volt-logo.png');
    expect(branding.primary_color).toBe('#635bff');
  });

  it('uses SupaCloud OAuth client metadata as application branding defaults', async () => {
    const { mergeSupaCloudBrandingDefaults } = await import('../repositories/sign-in-experience.js');
    const branding = mergeSupaCloudBrandingDefaults({
      page_title: 'SupaOAuth',
      logo_url: 'https://assets.example.com/tenant-logo.png',
      favicon_url: null,
      primary_color: '#0a2540',
    }, {
      application: {
        client_name: 'Volt Studio',
        logo_uri: 'https://assets.example.com/volt-studio-logo.png',
        primary_color: '#00d4ff',
      },
    });

    // stock 全局标题时，应用 client_name 回填标题
    expect(branding.page_title).toBe('Volt Studio');
    expect(branding.logo_url).toBe('https://assets.example.com/volt-studio-logo.png');
    expect(branding.primary_color).toBe('#00d4ff');
  });

  it('preserves a non-stock tenant-level system name against application metadata', async () => {
    const { mergeSupaCloudBrandingDefaults } = await import('../repositories/sign-in-experience.js');
    const branding = mergeSupaCloudBrandingDefaults({
      page_title: '西谷智灯枢鉴系统',
      logo_url: null,
      favicon_url: null,
      primary_color: null,
      background_url: 'https://assets.example.com/bg.png',
      button_label: '进入枢鉴',
      custom_css: 'body { color: #102019; }',
    }, {
      application: {
        client_name: 'SupAuth Admin Console',
        button_label: 'App Login',
      },
    });

    // 显式租户系统名不应被 OAuth client 元数据覆盖
    expect(branding.page_title).toBe('西谷智灯枢鉴系统');
    expect(branding.background_url).toBe('https://assets.example.com/bg.png');
    expect(branding.button_label).toBe('进入枢鉴');
    expect(branding.custom_css).toBe('body { color: #102019; }');
  });

  it('keeps third-party connectors closed by default for public sign-in', async () => {
    const { resolvePublicConnectors } = await import('../routes/sign-in-experience.js');
    const connectors = resolvePublicConnectors([
      { id: 'github', name: 'GitHub', type: 'social', enabled: true },
      { id: 'google', name: 'Google', type: 'social', enabled: true },
    ], []);

    expect(connectors).toEqual([]);
  });

  it('only exposes explicitly enabled third-party connectors for public sign-in', async () => {
    const { resolvePublicConnectors } = await import('../routes/sign-in-experience.js');
    const connectors = resolvePublicConnectors([
      { id: 'github', name: 'GitHub', type: 'social', enabled: true },
      { id: 'google', name: 'Google', type: 'social', enabled: false },
      { id: 'email', name: 'Email', type: 'credential', enabled: true },
    ], [
      { id: 'github', provider_id: 'github', name: 'GitHub Login', category: 'social', enabled: true },
      { id: 'google', provider_id: 'google', name: 'Google Login', category: 'social', enabled: true },
      { id: 'email', provider_id: 'email', name: 'Email', category: 'credential', enabled: true },
    ]);

    expect(connectors).toEqual([{ id: 'github', name: 'GitHub Login', type: 'social' }]);
  });

  it('builds GoTrue API URLs with the /auth/v1 prefix exactly once', async () => {
    const { buildGoTrueApiUrl, buildRawGoTrueApiUrl } = await import('../routes/sign-in-experience.js');

    expect(buildGoTrueApiUrl('https://auth.example.test', '/user')).toBe('https://auth.example.test/auth/v1/user');
    expect(buildGoTrueApiUrl('https://auth.example.test/auth/v1', '/user')).toBe('https://auth.example.test/auth/v1/user');
    expect(buildGoTrueApiUrl('https://auth.example.test/base/', 'oauth/authorizations/authz/consent')).toBe(
      'https://auth.example.test/base/auth/v1/oauth/authorizations/authz/consent',
    );

    expect(buildRawGoTrueApiUrl('http://127.0.0.1:3367', '/user')).toBe('http://127.0.0.1:3367/user');
    expect(buildRawGoTrueApiUrl('http://127.0.0.1:3367/', 'oauth/authorizations/authz/consent')).toBe(
      'http://127.0.0.1:3367/oauth/authorizations/authz/consent',
    );
  });

  it('resolves the public password policy from authoritative GoTrue config', async () => {
    const routes = await import('../routes/sign-in-experience.js');
    const resolvePublicSignInExperience = (routes as any).resolvePublicSignInExperience;
    const cases = [
      {
        authConfig: {
          password_min_length: 8,
          password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.none,
        },
        expected: {
          min_length: 8,
          require_uppercase: false,
          require_lowercase: false,
          require_numbers: false,
          require_symbols: false,
        },
      },
      {
        authConfig: {
          password_min_length: 10,
          password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.standard,
        },
        expected: {
          min_length: 10,
          require_uppercase: true,
          require_lowercase: true,
          require_numbers: true,
          require_symbols: false,
        },
      },
      {
        authConfig: {
          password_min_length: 12,
          password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
        },
        expected: {
          min_length: 12,
          require_uppercase: true,
          require_lowercase: true,
          require_numbers: true,
          require_symbols: true,
        },
      },
    ];

    for (const policyCase of cases) {
      const resolved = await resolvePublicSignInExperience('app-one', {
        getExperience: async () => ({
          branding: { page_title: 'Test Auth' },
          password_policy: { min_length: 6 },
        }),
        getConnectors: async () => [],
        getAuthConfig: async () => policyCase.authConfig,
      });

      expect(resolved.password_policy).toEqual(policyCase.expected);
      expect(resolved.sign_up_enabled).toBe(true);
    }
  });

  it('fails public resolve closed when GoTrue password policy is unavailable or invalid', async () => {
    const routes = await import('../routes/sign-in-experience.js');
    const resolvePublicSignInExperience = (routes as any).resolvePublicSignInExperience;
    const baseOptions = {
      getExperience: async () => ({ sign_up_enabled: true }),
      getConnectors: async () => [],
    };

    for (const getAuthConfig of [
      async () => ({ password_min_length: 12, password_required_characters: 'unsupported' }),
      async () => { throw new Error('https://auth.internal/config?token=secret'); },
    ]) {
      try {
        await resolvePublicSignInExperience(undefined, { ...baseOptions, getAuthConfig });
        throw new Error('Public sign-in experience unexpectedly resolved.');
      } catch (error) {
        expect(error).toMatchObject({ status: 503, code: 'password_policy_unavailable' });
        expect(String((error as Error).message)).not.toContain('auth.internal');
        expect(String((error as Error).message)).not.toContain('secret');
      }
    }
  });

});
