// GoTrue-compatible SSO entrypoint.
// SupaOAuth validates application metadata and redirects to GoTrue for runtime auth.

import { Elysia } from 'elysia';
import { getConfig, type ServerConfig } from '../config/index.js';
import { getSupaCloudAdapter, type SupaCloudAdapter } from '../supacloud/adapter.js';

type OAuthClient = {
  client_id?: string;
  id?: string;
  redirect_uris?: string[];
  redirect_uri?: string;
  grant_types?: string[];
};

type AuthorizeQuery = Record<string, unknown>;

const FORWARDED_AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
  'resource',
  'prompt',
  'max_age',
  'login_hint',
  'ui_locales',
  'acr_values',
] as const;

function stringParam(query: AuthorizeQuery, key: string) {
  const value = query[key];
  return typeof value === 'string' ? value : '';
}

export function isSafeOAuthClientId(clientId: string) {
  if (!clientId || clientId.length > 256) return false;
  return !/[/?#\\\u0000-\u001f\u007f]/.test(clientId);
}

function normalizeRedirectUris(client: OAuthClient) {
  const values = [
    ...(Array.isArray(client.redirect_uris) ? client.redirect_uris : []),
    ...(typeof client.redirect_uri === 'string' ? [client.redirect_uri] : []),
  ];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function appendOAuthError(redirectUri: string, error: string, description: string, state?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

export function isRedirectUriAllowed(client: OAuthClient, redirectUri: string) {
  if (!redirectUri) return false;
  try {
    const parsed = new URL(redirectUri);
    if (parsed.hash) return false;
  } catch {
    return false;
  }
  return normalizeRedirectUris(client).includes(redirectUri);
}

export function buildGoTrueOAuthAuthorizeUrl(runtimeUrl: string, query: AuthorizeQuery) {
  const url = new URL('/auth/v1/oauth/authorize', runtimeUrl);
  for (const key of FORWARDED_AUTHORIZE_PARAMS) {
    const value = stringParam(query, key);
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

export function publicOriginFromRequest(request: Request, trustProxyHeaders = false) {
  const forwardedHost = trustProxyHeaders
    ? request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    : '';
  const forwardedProto = trustProxyHeaders
    ? request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    : '';
  const parsed = new URL(request.url);
  const host = forwardedHost || request.headers.get('host') || parsed.host;
  const protocol = forwardedProto || parsed.protocol.replace(/:$/, '');
  return `${protocol}://${host}`;
}

function normalizePublicBaseUrl(value?: string) {
  if (!value) return '';
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function createSsoAuthorizeRoutes(
  prefix: string,
  adapter: Pick<SupaCloudAdapter, 'getOAuthClient'> = getSupaCloudAdapter(),
  config: Pick<ServerConfig, 'publicBaseUrl' | 'trustProxyHeaders'> = getConfig(),
) {
  return new Elysia({ prefix })
    .get('/authorize', async ({ query, request, set }) => {
      const clientId = stringParam(query as AuthorizeQuery, 'client_id');
      const redirectUri = stringParam(query as AuthorizeQuery, 'redirect_uri');
      const responseType = stringParam(query as AuthorizeQuery, 'response_type') || 'code';
      const state = stringParam(query as AuthorizeQuery, 'state');

      if (!clientId || !redirectUri) {
        set.status = 400;
        return { error: 'invalid_request', error_description: 'client_id and redirect_uri are required' };
      }

      if (!isSafeOAuthClientId(clientId)) {
        set.status = 400;
        return { error: 'invalid_request', error_description: 'client_id contains unsupported characters' };
      }

      let client: OAuthClient;
      try {
        client = await adapter.getOAuthClient(clientId) as OAuthClient;
      } catch (error) {
        set.status = 400;
        return {
          error: 'invalid_client',
          error_description: error instanceof Error ? error.message : 'OAuth client was not found',
        };
      }

      if (!isRedirectUriAllowed(client, redirectUri)) {
        set.status = 400;
        return { error: 'invalid_request', error_description: 'redirect_uri is not registered for this client' };
      }

      if (responseType !== 'code') {
        const location = appendOAuthError(
          redirectUri,
          'unsupported_response_type',
          'Only authorization code flow is supported',
          state,
        );
        set.status = 302;
        set.headers.location = location;
        return { redirect: location };
      }

      const publicBaseUrl = normalizePublicBaseUrl(config.publicBaseUrl) || publicOriginFromRequest(request, config.trustProxyHeaders);
      const goTrueUrl = buildGoTrueOAuthAuthorizeUrl(publicBaseUrl, query as AuthorizeQuery);
      set.status = 302;
      set.headers.location = goTrueUrl.toString();
      return { redirect: goTrueUrl.toString() };
    }, {
      detail: {
        summary: 'Validate OAuth request and redirect to GoTrue authorization endpoint',
        tags: ['Public', 'SSO', 'Consent'],
      },
    });
}

export const ssoAuthorizeRoutes = new Elysia()
  .use(createSsoAuthorizeRoutes('/oauth/sso'))
  .use(createSsoAuthorizeRoutes('/v1/public/oauth/sso'));
