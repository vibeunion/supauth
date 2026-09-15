import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SupaOAuthFetch } from '@supauth/sdk-typescript';
import type { PublicEffectiveSignInExperience } from '@supauth/shared';
import {
  buildHostedLogoutUrl,
  buildHostedBrandingCss,
  buildSupabaseAuthUiConfig,
  mapConnectorsToSupabaseProviders,
  resolveSupabaseAuthUiConfig,
} from '../index.js';

describe('buildHostedLogoutUrl', () => {
  it('builds the central hosted logout URL with RP logout context', () => {
    expect(buildHostedLogoutUrl({
      supauthUrl: 'https://auth.example.test/auth/v1',
      clientId: 'business-app',
      idTokenHint: 'header.payload.signature',
      postLogoutRedirectUri: 'https://app.example.test/login',
      state: 'signed-out',
    })).toBe('https://auth.example.test/logout?client_id=business-app&id_token_hint=header.payload.signature&post_logout_redirect_uri=https%3A%2F%2Fapp.example.test%2Flogin&state=signed-out');
  });

  it('rejects partial redirect validation context', () => {
    expect(() => buildHostedLogoutUrl({
      supauthUrl: 'https://auth.example.test',
      postLogoutRedirectUri: 'https://app.example.test/login',
    })).toThrow('must be provided together');
  });
});

describe('sdk-auth-ui bridge helpers', () => {
  const baseExperience = {
    branding: {
      primary_color: '#123456',
      page_title: 'Acme Login',
      background_url: 'https://cdn.example.com/bg.png',
      custom_css: '.hero { display: none; }',
    },
    sign_in_methods: ['password'],
    sign_up_enabled: true,
    password_policy: {
      min_length: 8,
      require_uppercase: false,
      require_lowercase: false,
      require_numbers: false,
      require_symbols: false,
    },
    connectors: [
      { id: 'google', name: 'Google', type: 'social' },
      { id: 'oidc-acme', name: 'Acme SSO', type: 'enterprise_sso' },
    ],
  };

  it('maps only supported connectors to Supabase auth-ui providers', () => {
    const result = mapConnectorsToSupabaseProviders(baseExperience.connectors);
    expect(result.supportedProviders).toEqual(['google']);
    expect(result.unsupportedConnectors).toHaveLength(1);
    expect(result.unsupportedConnectors[0]?.id).toBe('oidc-acme');
  });

  it('builds auth-ui props from experience and phrases', () => {
    const config = buildSupabaseAuthUiConfig({
      experience: baseExperience,
      phrases: {
        email: 'Email address',
        password: 'Password',
        sign_up: {
          button_label: 'Create account',
        },
      },
      view: 'sign_up',
      redirectTo: 'https://app.example.com/callback',
    });

    expect(config.auth.providers).toEqual(['google']);
    expect(config.auth.view).toBe('sign_up');
    expect(config.auth.redirectTo).toBe('https://app.example.com/callback');
    expect(config.auth.appearance.variables.default.colors['brand']).toBe('#123456');
    expect(config.auth.localization.variables.sign_in?.['email_label']).toBe('Email address');
    expect(config.auth.localization.variables.sign_up?.['button_label']).toBe('Create account');
  });

  it('validates direct builder inputs without executing property accessors', () => {
    let calls = 0;
    const experience = {
      ...baseExperience,
      get branding() {
        calls += 1;
        return baseExperience.branding;
      },
    };
    expect(() => buildSupabaseAuthUiConfig({ experience })).toThrow();
    const phrases = { get email() { calls += 1; return 'Email'; } };
    expect(() => buildSupabaseAuthUiConfig({ experience: baseExperience, phrases })).toThrow();
    for (const field of ['experience', 'phrases', 'view', 'redirectTo']) {
      const input = Object.defineProperty({ experience: baseExperience }, field, {
        enumerable: true,
        get() { calls += 1; return 'unexpected'; },
      });
      expect(() => buildSupabaseAuthUiConfig(input)).toThrow();
    }
    expect(calls).toBe(0);
  });

  it.each([
    { view: 7 },
    { view: 'unsupported' },
    { view: null },
    { view: undefined },
    { redirectTo: { destination: 'bad' } },
    { redirectTo: 7 },
    { redirectTo: null },
    { redirectTo: undefined },
  ])('rejects invalid direct builder options: %j', (invalid) => {
    expect(() => {
      Reflect.apply(buildSupabaseAuthUiConfig, undefined, [{
        experience: baseExperience,
        ...invalid,
      }]);
    }).toThrow('Response does not match the expected schema.');
  });

  it.each(['sign_in', 'sign_up', 'forgotten_password'] as const)('preserves supported view %s', (view) => {
    const config = buildSupabaseAuthUiConfig({ experience: baseExperience, view, redirectTo: '' });
    expect(config.auth.view).toBe(view);
    expect(config.auth.redirectTo).toBe('');
  });

  it('defaults omitted options and preserves the legacy null phrase fallback', () => {
    const config = buildSupabaseAuthUiConfig({ experience: baseExperience });
    expect(config.auth.view).toBe('sign_in');
    expect(config.auth).not.toHaveProperty('redirectTo');
    const legacy: unknown = Reflect.apply(buildSupabaseAuthUiConfig, undefined, [{
      experience: baseExperience,
      phrases: null,
    }]);
    expect(legacy).toEqual(config);
  });

  it('renders hosted branding css from background and custom css', () => {
    const css = buildHostedBrandingCss({
      backgroundUrl: 'https://cdn.example.com/bg.png',
      customCss: '.card { border-radius: 20px; }',
    });
    expect(css).toContain('background-image');
    expect(css).toContain('.card { border-radius: 20px; }');
  });

  it('ignores unsafe background URLs without allowing CSS boundary injection', () => {
    expect(buildHostedBrandingCss({
      backgroundUrl: 'javascript:alert(1)',
    })).toBe('');
    expect(buildHostedBrandingCss({
      backgroundUrl: 'https://cdn.example.com/" ); color: red; /*',
    })).not.toContain('color: red');
    expect(buildHostedBrandingCss({
      backgroundUrl: 'https://user:pass@cdn.example.com/bg.png',
    })).toBe('');
  });
});

describe('resolveSupabaseAuthUiConfig', () => {
  let transport: SupaOAuthFetch;

  beforeEach(() => {
    transport = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/public/sign-in-experience/resolve?application_id=app-1')) {
        return new Response(JSON.stringify({
          branding: { primary_color: '#2563eb' },
          sign_in_methods: ['password'],
          sign_up_enabled: true,
          password_policy: {
            min_length: 8,
            require_uppercase: false,
            require_lowercase: false,
            require_numbers: false,
            require_symbols: false,
          },
          connectors: [{ id: 'github', name: 'GitHub', type: 'social' }],
        }), { status: 200 });
      }
      if (url.endsWith('/v1/public/phrases/zh-CN')) {
        return new Response(JSON.stringify({
          language_tag: 'zh-CN',
          phrases: { email: 'Email address' },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
  });

  it('resolves public experience and phrases through the shared client', async () => {
    const config = await resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.example.com',
      applicationId: 'app-1',
      locale: 'zh-CN',
      fetch: transport,
    });

    expect(config.auth.providers).toEqual(['github']);
    expect(config.auth.localization.variables.sign_in?.['email_label']).toBe('Email address');
    expect(config.auth.appearance.variables.default.colors['brand']).toBe('#2563eb');
  });

  const experience = {
    branding: {}, sign_in_methods: ['password'], sign_up_enabled: true, connectors: [],
    password_policy: {
      min_length: 8, require_uppercase: false, require_lowercase: false,
      require_numbers: false, require_symbols: false,
    },
  } satisfies PublicEffectiveSignInExperience;

  it('allows browser and worker transports without changing global fetch', async () => {
    const globalFetch = globalThis.fetch;
    const fetcher = mock<SupaOAuthFetch>(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json(experience);
    });
    const result = await resolveSupabaseAuthUiConfig({ baseUrl: 'https://auth.example.test', fetch: fetcher });
    expect(result.experience).toEqual(experience);
    expect(result.auth).not.toHaveProperty('redirectTo');
    expect(result.brand).not.toHaveProperty('logoUrl');
    expect(globalThis.fetch).toBe(globalFetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains empty branding values and omits only undefined properties', () => {
    const result = buildSupabaseAuthUiConfig({ experience: { ...experience, branding: { page_title: '' } } });
    expect(result.brand).toEqual({ pageTitle: '' });
  });

  it('normalizes nullable server branding without emitting optional null values', () => {
    const result = buildSupabaseAuthUiConfig({
      experience: { ...experience, branding: { page_title: null, primary_color: null, logo_url: null, button_label: '' } },
    });
    expect(result.brand).toEqual({ buttonLabel: '' });
    expect(result.auth.appearance?.variables?.default?.colors?.['brand']).toBe('#2563eb');
  });

  it('rejects invalid public experience instead of building untyped configuration', async () => {
    const fetcher: SupaOAuthFetch = async () => Response.json({ branding: { primary_color: 42 } });
    await expect(resolveSupabaseAuthUiConfig({ baseUrl: 'https://auth.example.test', fetch: fetcher }))
      .rejects.toMatchObject({ code: 'SUPAUTH_RESPONSE_CONTRACT_INVALID' });
  });

  it('keeps unavailable phrase fallback but does not swallow malformed phrases', async () => {
    let malformed = false;
    const fetcher: SupaOAuthFetch = async (input) => String(input).includes('/phrases/')
      ? malformed ? Response.json({ language_tag: 'zh-CN', phrases: [] }) : new Response('Not found', { status: 404 })
      : Response.json(experience);
    const options = { baseUrl: 'https://auth.example.test', locale: 'zh-CN', fetch: fetcher };
    await expect(resolveSupabaseAuthUiConfig(options)).resolves.toHaveProperty('experience');
    malformed = true;
    await expect(resolveSupabaseAuthUiConfig(options)).rejects.toMatchObject({ code: 'SUPAUTH_RESPONSE_CONTRACT_INVALID' });
  });

  it('rejects cancellation immediately even while a transport is stalled', async () => {
    const caller = new AbortController();
    let observedSignal: AbortSignal | null | undefined;
    const fetcher: SupaOAuthFetch = async (_input, init) => {
      observedSignal = init?.signal;
      return new Promise<Response>(() => {});
    };
    const pending = resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.example.test', fetch: fetcher, signal: caller.signal,
    });
    await Promise.resolve();
    caller.abort(new Error('must-not-leak'));
    await expect(pending).rejects.toMatchObject({ code: 'request_aborted' });
    expect(observedSignal?.aborted).toBe(true);
    await expect(pending).rejects.not.toHaveProperty('cause');
  });

  it('keeps timeout around both phrase loading and response body reads', async () => {
    let observedSignal: AbortSignal | null | undefined;
    const fetcher: SupaOAuthFetch = async (input, init) => {
      observedSignal = init?.signal;
      return String(input).includes('/phrases/')
        ? new Response(new ReadableStream({ pull() {} })) : Response.json(experience);
    };
    await expect(resolveSupabaseAuthUiConfig({
      baseUrl: 'https://auth.example.test', fetch: fetcher, locale: 'zh-CN', timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'request_timeout' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('does not send requests for already cancelled operations', async () => {
    const fetcher = mock<SupaOAuthFetch>(async () => Response.json(experience));
    const signal = AbortSignal.abort();
    await expect(resolveSupabaseAuthUiConfig({ baseUrl: 'https://auth.example.test', fetch: fetcher, signal }))
      .rejects.toMatchObject({ code: 'request_aborted' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
