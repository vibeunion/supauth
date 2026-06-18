// GoTrue-compatible SSO entrypoint.
// SupaOAuth validates application metadata and redirects to GoTrue for runtime auth.

import { Elysia } from 'elysia';
import { getConfig, type ServerConfig } from '../config/index.js';

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

export function isSafeRedirectUriSyntax(redirectUri: string) {
  if (!redirectUri) return false;
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.hash) return false;
  } catch {
    return false;
  }
  return true;
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
  config: Pick<ServerConfig, 'publicBaseUrl' | 'trustProxyHeaders'> = getConfig(),
) {
  return new Elysia({ prefix })
    .get('/authorize', async ({ query, request, set }) => {
      const clientId = stringParam(query as AuthorizeQuery, 'client_id');
      const redirectUri = stringParam(query as AuthorizeQuery, 'redirect_uri');
      const responseType = stringParam(query as AuthorizeQuery, 'response_type') || 'code';

      if (!clientId || !redirectUri) {
        set.status = 400;
        return { error: 'invalid_request', error_description: 'client_id and redirect_uri are required' };
      }

      if (!isSafeOAuthClientId(clientId)) {
        set.status = 400;
        return { error: 'invalid_request', error_description: 'client_id contains unsupported characters' };
      }

      if (!isSafeRedirectUriSyntax(redirectUri)) {
        set.status = 400;
        return { error: 'invalid_request', error_description: 'redirect_uri must be an http(s) URL without a fragment' };
      }

      if (responseType !== 'code') {
        set.status = 400;
        return { error: 'unsupported_response_type', error_description: 'Only authorization code flow is supported' };
      }

      // 生产 Function 不能把公网登录入口依赖在 Management API 可达性上；
      // OAuth client 与 redirect_uri 的权威校验交给 GoTrue authorize 端点完成。
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
