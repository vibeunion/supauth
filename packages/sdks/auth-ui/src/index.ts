import {
  SupaOAuthClient,
  SupaOAuthRequestContractError,
  SupaOAuthResponseContractError,
  type SupaOAuthFetch,
} from '@supauth/sdk-typescript';
import type {
  PublicEffectiveSignInExperience,
  PublicPhraseBundle,
  PublicSignInConnector,
} from '@supauth/shared';
import { decodeSchema, Type, type Static, PublicEffectiveSignInExperienceSchema, PublicPhraseBundleSchema } from '@supauth/shared';

const SUPABASE_PROVIDER_IDS = [
  'apple',
  'azure',
  'bitbucket',
  'discord',
  'facebook',
  'github',
  'gitlab',
  'google',
  'keycloak',
  'linkedin',
  'notion',
  'spotify',
  'slack',
  'twitch',
  'twitter',
  'workos',
  'zoom',
  'email',
  'phone',
  'saml',
] as const;

const CREDENTIAL_METHOD_IDS = new Set([
  'password',
  'email',
  'email_password',
  'phone',
  'phone_password',
]);

export type SupabaseAuthUiProvider = typeof SUPABASE_PROVIDER_IDS[number];
const EmbeddedAuthUiViewSchema = Type.Union([
  Type.Literal('sign_in'),
  Type.Literal('sign_up'),
  Type.Literal('forgotten_password'),
]);
export type EmbeddedAuthUiView = Static<typeof EmbeddedAuthUiViewSchema>;

const BuildSupabaseAuthUiInputSchema = Type.Object({
  experience: PublicEffectiveSignInExperienceSchema,
  phrases: Type.Optional(Type.Union([PublicPhraseBundleSchema.properties.phrases, Type.Null()])),
  view: Type.Optional(EmbeddedAuthUiViewSchema),
  redirectTo: Type.Optional(Type.String()),
});

export interface HostedBranding {
  pageTitle?: string;
  logoUrl?: string;
  faviconUrl?: string;
  backgroundUrl?: string;
  primaryColor?: string;
  buttonLabel?: string;
  customCss?: string;
}

export interface AuthUiLocalizationVariables {
  sign_in?: Record<string, string>;
  sign_up?: Record<string, string>;
  forgotten_password?: Record<string, string>;
}

export interface SupabaseAuthUiBridgeConfig {
  auth: {
    providers: SupabaseAuthUiProvider[];
    view: EmbeddedAuthUiView;
    theme: 'default';
    showLinks: boolean;
    onlyThirdPartyProviders: boolean;
    redirectTo?: string;
    appearance: {
      extend: true;
      variables: {
        default: {
          colors: Record<string, string>;
          fonts: Record<string, string>;
          radii: Record<string, string>;
        };
      };
    };
    localization: {
      variables: AuthUiLocalizationVariables;
    };
  };
  brand: HostedBranding;
  unsupportedConnectors: PublicSignInConnector[];
  experience: PublicEffectiveSignInExperience;
}

export interface ResolveSupabaseAuthUiConfigOptions {
  baseUrl: string;
  applicationId?: string;
  authorizationId?: string;
  locale?: string;
  view?: EmbeddedAuthUiView;
  redirectTo?: string;
  fetch?: SupaOAuthFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HostedLogoutUrlOptions {
  supauthUrl: string;
  clientId?: string;
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
  state?: string;
}

export function buildHostedLogoutUrl(options: HostedLogoutUrlOptions): string {
  const endpoint = new URL('/logout', options.supauthUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new TypeError('supauthUrl must be an http(s) URL without credentials');
  }
  const redirectFields = [options.clientId, options.idTokenHint, options.postLogoutRedirectUri];
  const configuredRedirectFields = redirectFields.filter(Boolean).length;
  if (configuredRedirectFields > 0 && configuredRedirectFields !== redirectFields.length) {
    throw new TypeError('clientId, idTokenHint, and postLogoutRedirectUri must be provided together');
  }
  if (options.clientId) endpoint.searchParams.set('client_id', options.clientId);
  if (options.idTokenHint) endpoint.searchParams.set('id_token_hint', options.idTokenHint);
  if (options.postLogoutRedirectUri) endpoint.searchParams.set('post_logout_redirect_uri', options.postLogoutRedirectUri);
  if (options.state) endpoint.searchParams.set('state', options.state);
  return endpoint.toString();
}

function compactStrings(values: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.trim()) result[key] = value;
  }
  return result;
}

function phraseRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getPhraseValue(
  phrases: Record<string, unknown>,
  dottedKey: string,
  fallbackKey?: string,
): string | undefined {
  const direct = phrases[dottedKey];
  if (typeof direct === 'string' && direct.trim()) return direct;

  const segments = dottedKey.split('.');
  let current: unknown = phrases;
  for (const segment of segments) {
    if (!phraseRecord(current) || !Object.hasOwn(current, segment)) {
      current = undefined;
      break;
    }
    current = current[segment];
  }
  if (typeof current === 'string' && current.trim()) return current;

  if (fallbackKey) {
    const fallback = phrases[fallbackKey];
    if (typeof fallback === 'string' && fallback.trim()) return fallback;
  }
  return undefined;
}

function toBranding(experience: PublicEffectiveSignInExperience): HostedBranding {
  const { branding } = experience;
  return {
    ...(branding.page_title == null ? {} : { pageTitle: branding.page_title }),
    ...(branding.logo_url == null ? {} : { logoUrl: branding.logo_url }),
    ...(branding.favicon_url == null ? {} : { faviconUrl: branding.favicon_url }),
    ...(branding.background_url == null ? {} : { backgroundUrl: branding.background_url }),
    ...(branding.primary_color == null ? {} : { primaryColor: branding.primary_color }),
    ...(branding.button_label == null ? {} : { buttonLabel: branding.button_label }),
    ...(branding.custom_css == null ? {} : { customCss: branding.custom_css }),
  };
}

export function mapConnectorsToSupabaseProviders(connectors: PublicSignInConnector[] = []) {
  const supportedProviders: SupabaseAuthUiProvider[] = [];
  const unsupportedConnectors: PublicSignInConnector[] = [];
  for (const connector of connectors) {
    const provider = SUPABASE_PROVIDER_IDS.find(id => id === connector.id);
    if (provider !== undefined) {
      supportedProviders.push(provider);
    } else {
      unsupportedConnectors.push(connector);
    }
  }

  return { supportedProviders, unsupportedConnectors };
}

export function buildHostedBrandingCss(branding: HostedBranding) {
  const css: string[] = [];
  if (branding.backgroundUrl) {
    try {
      const backgroundUrl = new URL(branding.backgroundUrl);
      if (['http:', 'https:'].includes(backgroundUrl.protocol)
        && !backgroundUrl.username && !backgroundUrl.password && !backgroundUrl.hash) {
        const escapedUrl = backgroundUrl.toString()
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/[\r\n\f]/g, '\\A ');
        css.push(`body { background-image: url("${escapedUrl}"); background-size: cover; background-position: center; }`);
      }
    } catch {
      // Invalid branding URLs are ignored; custom CSS remains an explicit capability.
    }
  }
  if (branding.customCss) {
    css.push(branding.customCss);
  }
  return css.join('\n');
}

export function buildSupabaseAuthUiConfig(input: {
  experience: PublicEffectiveSignInExperience;
  phrases?: PublicPhraseBundle['phrases'];
  view?: EmbeddedAuthUiView;
  redirectTo?: string;
}) : SupabaseAuthUiBridgeConfig {
  const { experience, phrases: phraseInput, view = 'sign_in', redirectTo } = decodeSchema(
    BuildSupabaseAuthUiInputSchema,
    input,
  );
  // 保留历史 JavaScript 调用的 null 语言包回退，其他字段仍按契约拒绝。
  const phrases = phraseInput ?? {};
  const { supportedProviders, unsupportedConnectors } = mapConnectorsToSupabaseProviders(experience.connectors ?? []);
  const branding = toBranding(experience);
  const hasCredentialMethods = experience.sign_in_methods.length === 0
    || experience.sign_in_methods.some((method) => CREDENTIAL_METHOD_IDS.has(method));
  const hasProviders = supportedProviders.length > 0;

  return {
    auth: {
      providers: supportedProviders,
      view,
      theme: 'default',
      showLinks: true,
      onlyThirdPartyProviders: hasProviders && !hasCredentialMethods,
      ...(redirectTo === undefined ? {} : { redirectTo }),
      appearance: {
        extend: true,
        variables: {
          default: {
            colors: {
              brand: branding.primaryColor ?? '#2563eb',
              brandAccent: branding.primaryColor ?? '#2563eb',
              brandButtonText: '#ffffff',
              inputBorderFocus: branding.primaryColor ?? '#2563eb',
            },
            fonts: {
              bodyFontFamily: '"Segoe UI", system-ui, sans-serif',
              buttonFontFamily: '"Segoe UI", system-ui, sans-serif',
              inputFontFamily: '"Segoe UI", system-ui, sans-serif',
              labelFontFamily: '"Segoe UI", system-ui, sans-serif',
            },
            radii: {
              borderRadiusButton: '10px',
              buttonBorderRadius: '10px',
              inputBorderRadius: '10px',
            },
          },
        },
      },
      localization: {
        variables: {
          sign_in: compactStrings({
            email_label: getPhraseValue(phrases, 'sign_in.email_label', 'email'),
            password_label: getPhraseValue(phrases, 'sign_in.password_label', 'password'),
            button_label: branding.buttonLabel || getPhraseValue(phrases, 'sign_in.button_label', 'submit'),
            social_provider_text: getPhraseValue(phrases, 'sign_in.social_provider_text'),
            link_text: getPhraseValue(phrases, 'sign_in.link_text', 'forgotLink'),
          }),
          sign_up: compactStrings({
            email_label: getPhraseValue(phrases, 'sign_up.email_label', 'email'),
            password_label: getPhraseValue(phrases, 'sign_up.password_label', 'password'),
            button_label: getPhraseValue(phrases, 'sign_up.button_label', 'signUpSubmit'),
            confirmation_text: getPhraseValue(phrases, 'sign_up.confirmation_text', 'signUpSuccess'),
          }),
          forgotten_password: compactStrings({
            email_label: getPhraseValue(phrases, 'forgotten_password.email_label', 'forgotEmailLabel'),
            button_label: getPhraseValue(phrases, 'forgotten_password.button_label', 'forgotSubmit'),
            confirmation_text: getPhraseValue(phrases, 'forgotten_password.confirmation_text', 'forgotSuccess'),
          }),
        },
      },
    },
    brand: branding,
    unsupportedConnectors,
    experience,
  };
}

export async function resolveSupabaseAuthUiConfig(
  options: ResolveSupabaseAuthUiConfigOptions,
): Promise<SupabaseAuthUiBridgeConfig> {
  return runAuthUiRequest(options, async (signal) => {
    const transport = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const client = new SupaOAuthClient({
      baseUrl: options.baseUrl,
      fetch: (input, init) => transport(input, { ...init, signal }),
    });
    const [experience, phraseBundle] = await Promise.all([
      client.resolvePublicSignInExperience({
        ...(options.applicationId === undefined ? {} : { application_id: options.applicationId }),
        ...(options.authorizationId === undefined ? {} : { authorization_id: options.authorizationId }),
      }),
      options.locale ? client.getPublicPhrases(options.locale).catch((error: unknown) => {
        if (signal.aborted) throw new AuthUiRequestError('request_aborted');
        // 语言包缺失仍降级；契约错误必须暴露，不能伪装成成功加载。
        if (error instanceof SupaOAuthResponseContractError || error instanceof SupaOAuthRequestContractError) throw error;
        return null;
      }) : Promise.resolve(null),
    ]);
    return buildSupabaseAuthUiConfig({
      experience,
      ...(phraseBundle === null ? {} : { phrases: phraseBundle.phrases }),
      ...(options.view === undefined ? {} : { view: options.view }),
      ...(options.redirectTo === undefined ? {} : { redirectTo: options.redirectTo }),
    });
  });
}

export class AuthUiRequestError extends Error {
  constructor(public readonly code: 'request_aborted' | 'request_timeout') {
    super(code === 'request_timeout' ? 'Auth UI request timed out' : 'Auth UI request was cancelled');
    this.name = 'AuthUiRequestError';
  }
}

async function runAuthUiRequest<T>(
  options: Pick<ResolveSupabaseAuthUiConfigOptions, 'signal' | 'timeoutMs'>,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (options.signal?.aborted) throw new AuthUiRequestError('request_aborted');
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new TypeError('timeoutMs must be a positive finite number');
  }
  const controller = new AbortController();
  let rejectInterruption: (error: AuthUiRequestError) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterruption = reject; });
  const interrupt = (code: 'request_aborted' | 'request_timeout') => {
    rejectInterruption(new AuthUiRequestError(code));
    controller.abort();
  };
  const onAbort = () => interrupt('request_aborted');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = options.timeoutMs === undefined
    ? undefined : setTimeout(() => interrupt('request_timeout'), options.timeoutMs);
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), interrupted]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
