// GoTrue-compatible SSO entrypoint.
// SupaOAuth validates application metadata and redirects to GoTrue for runtime auth.


import { accountContract, accountOutput, readAccountInput } from '../utils/account-contract.js';
import { getConfig, type ServerConfig } from '../config/index.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

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
  fetcher: (input: URL, init: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
) {
  return defineHttpOperations({ prefix }, {
    getAuthorize: defineHttpOperation('GET', '/authorize', async ({ query, request, set }) => {
      const clientId = stringParam(query, 'client_id');
      const redirectUri = stringParam(query, 'redirect_uri');
      const responseType = stringParam(query, 'response_type') || 'code';

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
      const input = readAccountInput('authorize', request, { query });
      const goTrueUrl = buildGoTrueOAuthAuthorizeUrl(publicBaseUrl, input.query);
      const prompts = stringParam(input.query, 'prompt').split(/\s+/);
      set.headers['cache-control'] = 'no-store';
      if (prompts.includes('login')) {
        if (prompts.includes('none')) {
          set.status = 400;
          return { error: 'invalid_request', error_description: 'prompt=none cannot be combined with login' };
        }
        // 服务端取授权 ID 时仅访问配置域名，绝不信任请求 Host 发起出站请求。
        if (!config.publicBaseUrl || goTrueUrl.protocol !== 'https:' || goTrueUrl.username || goTrueUrl.password) {
          set.status = 503;
          return { success: false, error: { code: 'interactive_auth_origin_unavailable', message: 'Interactive authentication origin is unavailable' } };
        }
        try {
          // 不携带旧会话，也不跟随跳转；GoTrue 仍负责 client、回调和 PKCE 的权威校验。
          const response = await fetcher(goTrueUrl, {
            redirect: 'manual',
            credentials: 'omit',
            signal: AbortSignal.timeout(10_000),
          });
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (response.status === 400) {
            set.status = 400;
            return { error: 'invalid_request', error_description: 'Authorization request was rejected' };
          }
          if (response.status !== 302 || !location) throw new Error('Missing hosted authorization redirect');
          const hosted = new URL(location, goTrueUrl);
          const authorizationIds = hosted.searchParams.getAll('authorization_id');
          if (hosted.origin !== goTrueUrl.origin || hosted.pathname !== '/oauth/authorize'
            || hosted.username || hosted.password || hosted.hash
            || authorizationIds.length !== 1 || !authorizationIds[0]?.trim()
            || hosted.searchParams.has('code') || hosted.searchParams.has('access_token')
            || hosted.searchParams.has('refresh_token')) {
            throw new Error('Invalid hosted authorization redirect');
          }
          // GoTrue 部分版本不将 prompt 透传到登录 UI，绑定新授权 ID 后补齐交互要求。
          hosted.searchParams.set('prompt', stringParam(input.query, 'prompt'));
          set.status = 302;
          set.headers['location'] = hosted.toString();
          return accountOutput('authorize', { redirect: hosted.toString() });
        } catch {
          set.status = 502;
          return { success: false, error: { code: 'interactive_auth_unavailable', message: 'Interactive authentication is unavailable; please retry from the application' } };
        }
      }
      set.status = 302;
      set.headers['location'] = goTrueUrl.toString();
      return accountOutput('authorize', { redirect: goTrueUrl.toString() });
    }, accountContract('authorize', {
      detail: {
        summary: 'Validate OAuth request and redirect to GoTrue authorization endpoint',
        tags: ['Public', 'SSO', 'Consent'],
      },
    })),
  });
}

export const oauthSsoRoutes = createSsoAuthorizeRoutes('/oauth/sso');
export const publicOauthSsoRoutes = createSsoAuthorizeRoutes('/v1/public/oauth/sso');

export const ssoAuthorizeRoutes = [oauthSsoRoutes, publicOauthSsoRoutes] as const;
