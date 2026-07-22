import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { getConfig } from '../config/index.js';
import { getDiscovery, getJWKS } from '../runtime/index.js';
import { getSupaCloudAdapter, getSupaCloudAdapterForProject } from '../supacloud/adapter.js';

type LogoutQuery = Record<string, unknown>;

export interface LogoutValidationDependencies {
  discovery: () => Promise<Record<string, unknown>>;
  jwks: () => Promise<Record<string, unknown>>;
  oauthClient: (clientId: string) => Promise<unknown>;
}

function queryString(query: LogoutQuery, name: string): string {
  const candidate = query[name];
  return typeof candidate === 'string' ? candidate : '';
}

function logoutClientAdapter() {
  const authorityRef = getConfig().oauthAuthorizationProjectRef;
  return authorityRef ? getSupaCloudAdapterForProject(authorityRef) : getSupaCloudAdapter();
}

function defaultDependencies(): LogoutValidationDependencies {
  return {
    discovery: getDiscovery,
    jwks: getJWKS,
    oauthClient: (clientId) => logoutClientAdapter().getOAuthClient(clientId),
  };
}

function clientMetadata(candidate: unknown): Record<string, unknown> | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const nested = record.client;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : record;
}

function registeredLogoutUris(client: Record<string, unknown>): string[] {
  const configured = [client.post_logout_redirect_uris, client.redirect_uris].flatMap((candidate) => (
    Array.isArray(candidate) ? candidate.filter((uri): uri is string => typeof uri === 'string') : []
  ));
  return [...new Set(configured)];
}

function safeRedirectUri(candidate: string): URL | null {
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function fallbackRedirectUrl(request: Request): string {
  const configuredBase = getConfig().publicBaseUrl;
  return new URL('/login?logged_out=1', configuredBase || request.url).toString();
}

async function validIdTokenHint(
  token: string,
  clientId: string,
  dependencies: LogoutValidationDependencies,
): Promise<boolean> {
  const [discovery, jwks] = await Promise.all([dependencies.discovery(), dependencies.jwks()]);
  const issuer = discovery.issuer;
  if (typeof issuer !== 'string' || !issuer) return false;
  const verified = await jwtVerify(token, createLocalJWKSet(jwks as unknown as JSONWebKeySet), {
    issuer,
    audience: clientId,
    algorithms: ['ES256', 'RS256'],
  });
  return verified.payload.azp === undefined || verified.payload.azp === clientId;
}

function redirectWithState(redirectUri: URL, state: string): string {
  if (state) redirectUri.searchParams.set('state', state);
  return redirectUri.toString();
}

export async function resolvePostLogoutRedirect(
  request: Request,
  query: LogoutQuery,
  dependencies: LogoutValidationDependencies = defaultDependencies(),
): Promise<string> {
  const fallback = fallbackRedirectUrl(request);
  const clientId = queryString(query, 'client_id');
  const idTokenHint = queryString(query, 'id_token_hint');
  const requestedRedirect = queryString(query, 'post_logout_redirect_uri');
  const state = queryString(query, 'state');
  const redirectUri = safeRedirectUri(requestedRedirect);
  if (!clientId || clientId.length > 256 || !idTokenHint || !redirectUri || state.length > 1024) return fallback;

  try {
    const metadata = clientMetadata(await dependencies.oauthClient(clientId));
    if (!metadata || (metadata.client_id && metadata.client_id !== clientId)) return fallback;
    if (!registeredLogoutUris(metadata).includes(requestedRedirect)) return fallback;
    if (!await validIdTokenHint(idTokenHint, clientId, dependencies)) return fallback;
    return redirectWithState(redirectUri, state);
  } catch {
    return fallback;
  }
}

export const LOGOUT_PAGE_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;
