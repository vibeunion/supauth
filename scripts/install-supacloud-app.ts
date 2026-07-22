#!/usr/bin/env bun
/**
 * Install the SupAuth SupaCloud app artifact into an existing SupaCloud project.
 *
 * The installer is intentionally explicit about migration: SupAuth is a
 * Function-only app, but its overlay schema must exist before the Function is
 * considered installed.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HOSTED_MIGRATIONS } from '../packages/auth-server/src/db/migrate.js';
import { verifySupacloudAppArtifact } from './verify-supacloud-app-artifact.js';
import { verifyRbacAgainstDatabase } from '../packages/auth-server/src/compatibility/rbac-verify.js';
import { verifyAdminSsoAllowlist } from '../packages/auth-server/src/compatibility/admin-sso-verify.js';
import type { RbacDbVerification } from '../packages/auth-server/src/compatibility/rbac-verify.js';
import type { AdminSsoAllowlistVerification } from '../packages/auth-server/src/compatibility/admin-sso-verify.js';

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type MigrationVerifier = (databaseUrl: string) => Promise<RbacDbVerification>;
type AdminSsoAllowlistVerifier = (databaseUrl: string) => Promise<AdminSsoAllowlistVerification>;

const ADMIN_SSO_ENV = {
  issuer: 'ADMIN_SSO_ISSUER',
  clientId: 'ADMIN_SSO_CLIENT_ID',
  jwksUri: 'ADMIN_SSO_JWKS_URI',
  audience: 'ADMIN_SSO_AUDIENCE',
  redirectUri: 'ADMIN_SSO_REDIRECT_URI',
  postLogoutRedirectUri: 'ADMIN_SSO_POST_LOGOUT_REDIRECT_URI',
  allowedEmails: 'ADMIN_SSO_ALLOWED_EMAILS',
  allowedDomains: 'ADMIN_SSO_ALLOWED_DOMAINS',
} as const;

type StepStatus = 'done' | 'planned' | 'skipped';

export interface InstallStep {
  name: string;
  status: StepStatus;
  detail?: string;
}

export interface SupacloudInstallResult {
  ok: boolean;
  dryRun: boolean;
  artifactOk: boolean;
  projectRef: string;
  supacloudApiUrl: string;
  runtimeUrl: string;
  functionSlug: string;
  steps: InstallStep[];
  directFunctionProbe?: {
    url: string;
    status: number;
    ok: boolean;
  };
  warnings: string[];
}

export interface InstallSupacloudAppOptions {
  root?: string;
  artifactDir?: string;
  manifestPath?: string;
  envFile?: string;
  supacloudApiUrl?: string;
  projectRef?: string;
  token?: string;
  bffSigningSecret?: string;
  gatewayAdminToken?: string;
  runtimeUrl?: string;
  runtimeInternalUrl?: string;
  oauthAuthorizationProjectRef?: string;
  baseUrl?: string;
  apiUrl?: string;
  corsOrigins?: string | string[];
  edgeRuntimeUpstream?: string;
  databaseUrl?: string;
  runtimeMode?: string;
  adminSsoIssuer?: string;
  adminSsoClientId?: string;
  adminSsoJwksUri?: string;
  adminSsoAudience?: string;
  adminSsoRedirectUri?: string;
  adminSsoPostLogoutRedirectUri?: string;
  adminSsoAllowedEmails?: string;
  adminSsoAllowedDomains?: string;
  dryRun?: boolean;
  skipMigration?: boolean;
  skipMigrationVerify?: boolean;
  skipSecrets?: boolean;
  skipFunctionDeploy?: boolean;
  skipDirectVerify?: boolean;
  fetchImpl?: FetchImpl;
  migrationVerifier?: MigrationVerifier;
  adminSsoAllowlistVerifier?: AdminSsoAllowlistVerifier;
}

interface ResolvedInstallConfig {
  root: string;
  artifactDir: string;
  manifestPath?: string;
  supacloudApiUrl: string;
  projectRef: string;
  token: string;
  bffSigningSecret: string;
  gatewayAdminToken: string;
  runtimeUrl: string;
  runtimeInternalUrl: string;
  oauthAuthorizationProjectRef: string;
  baseUrl: string;
  apiUrl: string;
  corsOrigins: string[];
  edgeRuntimeUpstream: string;
  databaseUrl: string;
  runtimeMode: string;
  adminSsoIssuer: string;
  adminSsoClientId: string;
  adminSsoJwksUri: string;
  adminSsoAudience: string;
  adminSsoRedirectUri: string;
  adminSsoPostLogoutRedirectUri: string;
  adminSsoAllowedEmails: string;
  adminSsoAllowedDomains: string;
  dryRun: boolean;
}

function parseEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([^=\s]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function firstValue(sources: Record<string, string | undefined>[], names: string[]) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name];
      if (value) return value;
    }
  }
  return '';
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function supacloudProjectBaseUrl(runtimeUrl: string) {
  const parsedRuntimeUrl = new URL(runtimeUrl);
  if (parsedRuntimeUrl.href.includes('?') || parsedRuntimeUrl.href.includes('#')) {
    throw new Error('SUPACLOUD_RUNTIME_URL must not include a query string or fragment');
  }
  parsedRuntimeUrl.pathname = parsedRuntimeUrl.pathname.replace(/\/auth\/v1\/?$/, '');
  return stripTrailingSlash(parsedRuntimeUrl.toString());
}

function urlOrigin(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`CORS origin must use http(s): ${rawUrl}`);
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`CORS origin must use http(s): ${rawUrl}`);
  }
  return url.origin;
}

function uniqueOrigins(rawOrigins: string[]) {
  const origins: string[] = [];
  const seen = new Set<string>();
  for (const rawOrigin of rawOrigins) {
    const trimmed = rawOrigin.trim();
    if (!trimmed) continue;
    const origin = urlOrigin(trimmed);
    if (seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }
  return origins;
}

function resolveConfig(options: InstallSupacloudAppOptions): ResolvedInstallConfig {
  const root = resolve(options.root || new URL('..', import.meta.url).pathname);
  const artifactDir = resolve(root, options.artifactDir || 'artifacts/supacloud-app');
  const fileEnv = options.envFile ? parseEnvFile(resolve(root, options.envFile)) : {};
  const cliEnv: Record<string, string | undefined> = {
    SUPACLOUD_API_URL: options.supacloudApiUrl,
    SUPACLOUD_PROJECT_REF: options.projectRef,
    SUPACLOUD_API_TOKEN: options.token,
    SUPAOAUTH_BFF_SIGNING_SECRET: options.bffSigningSecret,
    SUPACLOUD_GATEWAY_ADMIN_TOKEN: options.gatewayAdminToken,
    SUPACLOUD_RUNTIME_URL: options.runtimeUrl,
    SUPACLOUD_RUNTIME_INTERNAL_URL: options.runtimeInternalUrl,
    SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF: options.oauthAuthorizationProjectRef,
    SUPAUTH_PUBLIC_URL: options.baseUrl,
    SUPAUTH_API_URL: options.apiUrl,
    CORS_ORIGINS: Array.isArray(options.corsOrigins) ? options.corsOrigins.join(',') : options.corsOrigins,
    SUPACLOUD_EDGE_RUNTIME_UPSTREAM: options.edgeRuntimeUpstream,
    SUPACLOUD_DATABASE_URL: options.databaseUrl,
    RUNTIME_MODE: options.runtimeMode,
    [ADMIN_SSO_ENV.issuer]: options.adminSsoIssuer,
    [ADMIN_SSO_ENV.clientId]: options.adminSsoClientId,
    [ADMIN_SSO_ENV.jwksUri]: options.adminSsoJwksUri,
    [ADMIN_SSO_ENV.audience]: options.adminSsoAudience,
    [ADMIN_SSO_ENV.redirectUri]: options.adminSsoRedirectUri,
    [ADMIN_SSO_ENV.postLogoutRedirectUri]: options.adminSsoPostLogoutRedirectUri,
    [ADMIN_SSO_ENV.allowedEmails]: options.adminSsoAllowedEmails,
    [ADMIN_SSO_ENV.allowedDomains]: options.adminSsoAllowedDomains,
  };
  const sources = [cliEnv, fileEnv, process.env];

  const supacloudApiUrl = firstValue(sources, [
    'SUPACLOUD_API_URL',
    'SUPACLOUD_INTERNAL_API_URL',
    'SUPACLOUD_MANAGEMENT_API_URL',
    'SUPABASE_URL',
  ]);
  const projectRef = firstValue(sources, ['SUPACLOUD_PROJECT_REF', 'PROJECT_REF', 'SUPABASE_PROJECT_REF']);
  const token = firstValue(sources, [
    'SUPACLOUD_API_TOKEN',
    'SUPACLOUD_MASTER_TOKEN',
    'SUPACLOUD_INTERNAL_TOKEN',
    'SUPACLOUD_SERVICE_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  const gatewayAdminToken = firstValue(sources, [
    'SUPACLOUD_GATEWAY_ADMIN_TOKEN',
    'SUPACLOUD_ADMIN_TOKEN',
  ]);
  const bffSigningSecret = firstValue(sources, ['SUPAOAUTH_BFF_SIGNING_SECRET']);
  const runtimeUrl = firstValue(sources, ['SUPACLOUD_RUNTIME_URL', 'OAUTH_RUNTIME_URL', 'SUPABASE_URL']);
  const runtimeInternalUrl = firstValue(sources, [
    'OAUTH_RUNTIME_INTERNAL_URL',
    'SUPACLOUD_RUNTIME_INTERNAL_URL',
    'GOTRUE_INTERNAL_URL',
  ]);
  const oauthAuthorizationProjectRef = firstValue(sources, [
    'SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF',
    'OAUTH_AUTHORIZATION_PROJECT_REF',
    'GOTRUE_AUTHORIZATION_PROJECT_REF',
  ]);
  const databaseUrl = firstValue(sources, ['SUPACLOUD_DATABASE_URL', 'SUPABASE_DB_URL']);
  const runtimeMode = (firstValue(sources, ['RUNTIME_MODE']) || 'gotrue').trim();
  const baseUrl = firstValue(sources, ['SUPAUTH_PUBLIC_URL', 'AUTH_PUBLIC_URL', 'SUPAUTH_INSTALLED_BASE_URL', 'SUPAUTH_BASE_URL']);
  const apiUrl = firstValue(sources, ['SUPAUTH_API_URL', 'AUTH_API_URL']);
  const configuredCorsOrigins = firstValue(sources, ['CORS_ORIGINS']);
  const edgeRuntimeUpstream = firstValue(sources, ['SUPACLOUD_EDGE_RUNTIME_UPSTREAM', 'EDGE_RUNTIME_UPSTREAM']);
  const adminSsoIssuer = firstValue(sources, [ADMIN_SSO_ENV.issuer]).trim();
  const adminSsoClientId = firstValue(sources, [ADMIN_SSO_ENV.clientId]).trim();

  return {
    root,
    artifactDir,
    manifestPath: options.manifestPath,
    supacloudApiUrl: stripTrailingSlash(supacloudApiUrl),
    projectRef,
    token,
    bffSigningSecret,
    gatewayAdminToken,
    runtimeUrl: stripTrailingSlash(runtimeUrl),
    runtimeInternalUrl: stripTrailingSlash(runtimeInternalUrl),
    oauthAuthorizationProjectRef,
    baseUrl: stripTrailingSlash(baseUrl),
    apiUrl: stripTrailingSlash(apiUrl),
    corsOrigins: uniqueOrigins([
      ...configuredCorsOrigins.split(','),
      baseUrl,
      apiUrl,
    ]),
    edgeRuntimeUpstream: edgeRuntimeUpstream || '127.0.0.1:9000',
    databaseUrl,
    runtimeMode,
    adminSsoIssuer: stripTrailingSlash(adminSsoIssuer),
    adminSsoClientId,
    adminSsoJwksUri: firstValue(sources, [ADMIN_SSO_ENV.jwksUri]).trim(),
    adminSsoAudience: firstValue(sources, [ADMIN_SSO_ENV.audience]).trim(),
    adminSsoRedirectUri: firstValue(sources, [ADMIN_SSO_ENV.redirectUri]).trim(),
    adminSsoPostLogoutRedirectUri: firstValue(sources, [ADMIN_SSO_ENV.postLogoutRedirectUri]).trim(),
    adminSsoAllowedEmails: firstValue(sources, [ADMIN_SSO_ENV.allowedEmails]).trim(),
    adminSsoAllowedDomains: firstValue(sources, [ADMIN_SSO_ENV.allowedDomains]).trim(),
    dryRun: options.dryRun === true,
  };
}

function requireAdminSsoIssuer(config: ResolvedInstallConfig) {
  let issuer: URL;
  try {
    issuer = new URL(config.adminSsoIssuer);
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`${ADMIN_SSO_ENV.issuer} must be an absolute URL`);
    throw error;
  }
  if (issuer.protocol !== 'http:' && issuer.protocol !== 'https:') {
    throw new Error(`${ADMIN_SSO_ENV.issuer} must use http(s)`);
  }
  if (!config.dryRun && issuer.protocol !== 'https:') {
    throw new Error(`${ADMIN_SSO_ENV.issuer} must use HTTPS for production installation`);
  }
}

function requireConfig(config: ResolvedInstallConfig) {
  const missing: string[] = [];
  if (!config.supacloudApiUrl) missing.push('SUPACLOUD_API_URL');
  if (!config.projectRef) missing.push('SUPACLOUD_PROJECT_REF');
  if (!config.token) missing.push('SUPACLOUD_API_TOKEN');
  if (!config.bffSigningSecret) missing.push('SUPAOAUTH_BFF_SIGNING_SECRET');
  if (!config.runtimeUrl) missing.push('SUPACLOUD_RUNTIME_URL');
  if (!config.databaseUrl) missing.push('SUPACLOUD_DATABASE_URL');
  if (!config.adminSsoIssuer) missing.push(ADMIN_SSO_ENV.issuer);
  if (!config.adminSsoClientId) missing.push(ADMIN_SSO_ENV.clientId);
  if (missing.length > 0) {
    throw new Error(`Missing required install configuration: ${missing.join(', ')}`);
  }
  supacloudProjectBaseUrl(config.runtimeUrl);
  if (config.bffSigningSecret.length < 32) {
    throw new Error('SUPAOAUTH_BFF_SIGNING_SECRET must be at least 32 characters');
  }
  if (config.bffSigningSecret === config.token) {
    throw new Error('SUPAOAUTH_BFF_SIGNING_SECRET must be independent from the SupaCloud token');
  }
  if (config.runtimeMode !== 'gotrue') {
    throw new Error('RUNTIME_MODE must be "gotrue"; external OIDC runtimes are not supported');
  }
  requireAdminSsoIssuer(config);
}

function readManifest(root: string, artifactDir: string, manifestPath?: string) {
  const path = manifestPath ? resolve(root, manifestPath) : resolve(artifactDir, 'supacloud-app-manifest.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

function pathEscapesRoot(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function artifactLocation(realRoot: string, manifest: Record<string, any>, key: string) {
  const value = manifest.artifacts?.[key];
  if (!value || typeof value !== 'string') throw new Error(`Manifest artifact is missing: ${key}`);
  const declaredPath = resolve(realRoot, value);
  if (pathEscapesRoot(realRoot, declaredPath)) {
    throw new Error(`Manifest artifact escapes the repository root: ${key}`);
  }
  if (!existsSync(declaredPath)) throw new Error(`Manifest artifact file is missing: ${value}`);
  const realPath = realpathSync(declaredPath);
  if (pathEscapesRoot(realRoot, realPath)) {
    throw new Error(`Manifest artifact resolves outside the repository root: ${key}`);
  }
  return { declaredPath, realPath };
}

function assertNoSymlinkSegments(root: string, artifactPath: string, key: string) {
  let currentPath = root;
  for (const segment of relative(root, artifactPath).split(sep).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    if (lstatSync(currentPath).isSymbolicLink()) {
      throw new Error(`Manifest artifact path must not contain symlinks: ${key}`);
    }
  }
}

function validatedDeployArtifactPaths(root: string, manifest: Record<string, any>) {
  const realRoot = realpathSync(root);
  const functionBundle = artifactLocation(realRoot, manifest, 'function_bundle');
  const adminStaticDir = artifactLocation(realRoot, manifest, 'admin_static_dir');
  artifactLocation(realRoot, manifest, 'openapi');
  const functionStat = lstatSync(functionBundle.declaredPath);
  if (functionStat.isSymbolicLink() || !functionStat.isFile()) {
    throw new Error('Manifest function_bundle must be a regular file and must not be a symlink');
  }
  assertNoSymlinkSegments(realRoot, adminStaticDir.declaredPath, 'admin_static_dir');
  return {
    functionBundlePath: functionBundle.realPath,
    adminStaticDirPath: adminStaticDir.realPath,
  };
}

function redact(text: string, secrets: string[]) {
  let output = text;
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

function csvEntries(csv: string) {
  return csv.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function configuredAdminAllowlistCount(config: ResolvedInstallConfig) {
  return csvEntries(config.adminSsoAllowedEmails).length + csvEntries(config.adminSsoAllowedDomains).length;
}

function allowlistRedactionSecrets(allowlistCsv: Array<string | undefined>) {
  const secrets = allowlistCsv.flatMap((csv) => csv?.trim() ? [csv, ...csvEntries(csv)] : []);
  return [...new Set(secrets)].sort((left, right) => right.length - left.length);
}

class SupacloudClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchImpl,
    private readonly redactedSecrets: string[],
  ) {}

  async request(path: string, init: RequestInit & { okStatuses?: number[] } = {}) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const { okStatuses, ...requestInit } = init;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...requestInit, headers });
    if (!response.ok && !okStatuses?.includes(response.status)) {
      const text = await response.text().catch(() => '');
      throw new Error(`SupaCloud API ${init.method || 'GET'} ${path} failed with ${response.status}: ${redact(text, this.redactedSecrets)}`);
    }
    return response;
  }
}

function optionalRuntimeEnv(name: string, runtimeValue: string) {
  return runtimeValue ? [{ name, value: runtimeValue }] : [];
}

function adminSsoFunctionEnv(config: ResolvedInstallConfig) {
  return [
    { name: ADMIN_SSO_ENV.issuer, value: config.adminSsoIssuer },
    { name: ADMIN_SSO_ENV.clientId, value: config.adminSsoClientId },
    ...optionalRuntimeEnv(ADMIN_SSO_ENV.jwksUri, config.adminSsoJwksUri),
    ...optionalRuntimeEnv(ADMIN_SSO_ENV.audience, config.adminSsoAudience),
    ...optionalRuntimeEnv(ADMIN_SSO_ENV.redirectUri, config.adminSsoRedirectUri),
    ...optionalRuntimeEnv(ADMIN_SSO_ENV.postLogoutRedirectUri, config.adminSsoPostLogoutRedirectUri),
    ...optionalRuntimeEnv(ADMIN_SSO_ENV.allowedEmails, config.adminSsoAllowedEmails),
    ...optionalRuntimeEnv(ADMIN_SSO_ENV.allowedDomains, config.adminSsoAllowedDomains),
  ];
}

function functionEnv(config: ResolvedInstallConfig) {
  return [
    { name: 'SUPACLOUD_INTERNAL_API_URL', value: config.supacloudApiUrl },
    { name: 'SUPACLOUD_INTERNAL_TOKEN', value: config.token },
    { name: 'SUPAOAUTH_BFF_SIGNING_SECRET', value: config.bffSigningSecret },
    { name: 'SUPACLOUD_PROJECT_REF', value: config.projectRef },
    { name: 'SUPACLOUD_RUNTIME_URL', value: config.runtimeUrl },
    ...(config.baseUrl
      ? [
        { name: 'SUPAUTH_PUBLIC_URL', value: config.baseUrl },
        { name: 'SUPAUTH_INSTALLED_BASE_URL', value: config.baseUrl },
      ]
      : []),
    ...(config.runtimeInternalUrl
      ? [{ name: 'SUPACLOUD_RUNTIME_INTERNAL_URL', value: config.runtimeInternalUrl }]
      : []),
    ...(config.oauthAuthorizationProjectRef
      ? [{ name: 'SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF', value: config.oauthAuthorizationProjectRef }]
      : []),
    ...(config.corsOrigins.length > 0
      ? [{ name: 'CORS_ORIGINS', value: config.corsOrigins.join(',') }]
      : []),
    { name: 'SUPACLOUD_DATABASE_URL', value: config.databaseUrl },
    ...adminSsoFunctionEnv(config),
  ];
}

function hostnameFromUrl(url: string) {
  if (!url) return '';
  return new URL(url).hostname;
}

function textBundleFile(filePath: string, relativePath: string) {
  const bytes = readFileSync(filePath);
  if (bytes.includes(0)) throw new Error(`Admin static artifact is binary: ${relativePath}`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`Admin static artifact is not valid UTF-8 text: ${relativePath}`);
    throw error;
  }
}

function directoryTextEntries(root: string, directory: string): Array<[string, string]> {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .flatMap((entry): Array<[string, string]> => {
      const entryPath = join(directory, entry.name);
      const relativePath = relative(root, entryPath).split(sep).join('/');
      const entryStat = lstatSync(entryPath);
      if (entryStat.isSymbolicLink()) throw new Error(`Admin static artifact must not contain symlinks: ${relativePath}`);
      if (entryStat.isDirectory()) return directoryTextEntries(root, entryPath);
      if (!entryStat.isFile()) throw new Error(`Admin static artifact must contain only regular files: ${relativePath}`);
      return [[relativePath, textBundleFile(entryPath, relativePath)]];
    });
}

function adminStaticTextEntries(adminStaticDirPath: string) {
  const rootStat = lstatSync(adminStaticDirPath);
  if (rootStat.isSymbolicLink()) throw new Error('Admin static artifact directory must not be a symlink');
  if (!rootStat.isDirectory()) throw new Error('Admin static artifact must be a directory');
  return directoryTextEntries(adminStaticDirPath, adminStaticDirPath);
}

function functionBundleFiles(functionBundlePath: string, adminStaticDirPath: string) {
  const files: Record<string, string> = {
    'index.ts': readFileSync(functionBundlePath, 'utf8'),
  };
  for (const [relativePath, staticSource] of adminStaticTextEntries(adminStaticDirPath)) {
    files[`admin-console/build/${relativePath}`] = staticSource;
  }
  return files;
}

async function deployFunction(input: {
  client: SupacloudClient;
  projectRef: string;
  files: Record<string, string>;
}) {
  await input.client.request(`/v1/projects/${input.projectRef}/functions/supauth/bundle`, {
    method: 'POST',
    body: JSON.stringify({
      files: input.files,
      entrypoint: 'index.ts',
      minify: false,
    }),
  });
  await input.client.request(`/v1/projects/${input.projectRef}/functions/supauth/config`, {
    method: 'PATCH',
    body: JSON.stringify({ verify_jwt: false }),
  });
}

const hostedRoutePaths = [
  '/api/*',
  '/v1/*',
  '/v1/public/*',
  '/oauth/*',
  '/login',
  '/login.html',
  '/authorize.html',
  '/logout',
  '/logout.html',
  '/hosted-auth.js',
  '/account',
  '/account.html',
  '/account/*',
  '/change-password',
  '/change-password.html',
  '/claim',
  '/claim.html',
  '/favicon.ico',
  '/favicon.svg',
  '/admin/api/*',
  '/admin/*',
  '/',
];

const apiRoutePaths = ['/api/*', '/v1/*', '/v1/public/*', '/oauth/*', '/swagger*', '/'];

async function upsertGatewayRoute(input: {
  client: SupacloudClient;
  projectRef: string;
  id: string;
  host: string;
  path: string[];
  corsOrigins: string[];
  edgeRuntimeUpstream: string;
  priority: number;
}) {
  await input.client.request(`/v1/projects/${input.projectRef}/gateway/routes`, {
    method: 'POST',
    body: JSON.stringify({
      id: input.id,
      hosts: [input.host],
      path: input.path,
      upstream: input.edgeRuntimeUpstream,
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: input.priority,
      enabled: true,
      cors: input.corsOrigins,
    }),
  });
}

async function configureGatewayRoutes(input: {
  client: SupacloudClient;
  projectRef: string;
  baseUrl: string;
  apiUrl: string;
  corsOrigins: string[];
  edgeRuntimeUpstream: string;
}) {
  const host = hostnameFromUrl(input.baseUrl);
  if (!host) throw new Error('SUPAUTH_PUBLIC_URL or SUPAUTH_INSTALLED_BASE_URL is required for gateway route binding');
  const routeDefaults = {
    client: input.client,
    projectRef: input.projectRef,
    corsOrigins: input.corsOrigins,
    edgeRuntimeUpstream: input.edgeRuntimeUpstream,
  };

  await upsertGatewayRoute({
    ...routeDefaults,
    id: 'supauth-function-hosted',
    host,
    path: hostedRoutePaths,
    priority: 100,
  });

  if (!input.apiUrl) return;

  await upsertGatewayRoute({
    ...routeDefaults,
    id: 'supauth-api',
    host: hostnameFromUrl(input.apiUrl),
    path: apiRoutePaths,
    priority: 110,
  });
}

function gatewayRouteDetail(config: ResolvedInstallConfig) {
  const hosts = [hostnameFromUrl(config.baseUrl), hostnameFromUrl(config.apiUrl)].filter(Boolean);
  return `${hosts.join(', ')} -> /functions/v1/supauth`;
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag = '';

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] || '';

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !dollarQuoteTag && char === '-' && next === '-') {
      current += char + next;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !dollarQuoteTag && char === '/' && next === '*') {
      current += char + next;
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (!inDoubleQuote && !dollarQuoteTag && char === "'") {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && !dollarQuoteTag && char === '"') {
      current += char;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        const tag = match[0];
        if (!dollarQuoteTag) {
          dollarQuoteTag = tag;
          current += tag;
          index += tag.length - 1;
          continue;
        }
        if (dollarQuoteTag === tag) {
          dollarQuoteTag = '';
          current += tag;
          index += tag.length - 1;
          continue;
        }
      }
    }

    if (!inSingleQuote && !inDoubleQuote && !dollarQuoteTag && char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements.filter((statement) => statement.replace(/--.*$/gm, '').trim().length > 0);
}

async function runSupacloudMigration(client: SupacloudClient, projectRef: string, name: string, sql: string) {
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await client.request(`/v1/projects/${projectRef}/database/sql`, {
      method: 'POST',
      body: JSON.stringify({
        sql: statement,
        mode: 'admin',
        admin: true,
      }),
    });
  }
  return { name, statements: statements.length };
}

function rbacMigrationVerificationErrors(result: RbacDbVerification) {
  const errors: string[] = [];
  if (!result.reachable) {
    errors.push(result.error ? `database unreachable: ${result.error}` : 'database unreachable');
    return errors;
  }
  if (!result.authorizeExists) errors.push('supaoauth.authorize() is missing');
  if (!result.hasPermissionExists) errors.push('supaoauth.has_permission() is missing');
  if (!result.hasOrgPermissionExists) errors.push('supaoauth.has_org_permission() is missing');
  if (!result.currentProjectClaimsExists) errors.push('supaoauth.current_project_claims() is missing');
  if (!result.authorizeGranted) errors.push('authenticated lacks EXECUTE on supaoauth.authorize(TEXT, UUID)');
  if (!result.hasPermissionGranted) errors.push('authenticated lacks EXECUTE on supaoauth.has_permission(TEXT, UUID)');
  if (!result.hasOrgPermissionGranted) errors.push('authenticated lacks EXECUTE on supaoauth.has_org_permission(UUID, TEXT)');
  if (!result.currentProjectClaimsGranted) errors.push('authenticated lacks EXECUTE on supaoauth.current_project_claims()');
  if (!result.legacyWebhookDeliveriesAbsent) {
    errors.push('reason_code=legacy_webhook_table_present: supaoauth.webhook_deliveries must be retired; recreate and rotate webhooks in SupaCloud Secret Manager first');
  }
  if (!result.legacyWebhooksAbsent) {
    errors.push('reason_code=legacy_webhook_table_present: supaoauth.webhooks must be retired; recreate and rotate webhooks in SupaCloud Secret Manager first');
  }
  const unsafePolicyCount = result.unsafePolicies?.length ?? 0;
  if (unsafePolicyCount > 0) errors.push(`${unsafePolicyCount} RLS policy/policies still use JWT role claim for business authorization`);
  return errors;
}

async function directFunctionProbe(runtimeUrl: string, fetchImpl: FetchImpl) {
  const url = `${supacloudProjectBaseUrl(runtimeUrl)}/functions/v1/supauth/api/v1/health`;
  const response = await fetchImpl(url, { method: 'GET' });
  return { url, status: response.status, ok: response.status >= 200 && response.status < 300 };
}

async function adminSsoAllowlistInstallStep(config: ResolvedInstallConfig, verifier: AdminSsoAllowlistVerifier): Promise<InstallStep> {
  if (config.dryRun) return {
    name: 'admin-sso-allowlist-verification',
    status: 'planned',
    detail: 'database counts or explicit server-only environment allowlist',
  };
  const dbAllowlist = await verifier(config.databaseUrl);
  const databaseCount = dbAllowlist.emailCount + dbAllowlist.domainCount;
  const environmentCount = configuredAdminAllowlistCount(config);
  if (databaseCount === 0 && environmentCount === 0) {
    throw new Error('Admin SSO installation requires a non-empty database or explicit environment allowlist');
  }
  return {
    name: 'admin-sso-allowlist-verification',
    status: 'done',
    detail: `database email/domain counts=${dbAllowlist.emailCount}/${dbAllowlist.domainCount}; explicit environment configured=${environmentCount > 0}`,
  };
}

export async function installSupacloudApp(options: InstallSupacloudAppOptions = {}): Promise<SupacloudInstallResult> {
  const config = resolveConfig(options);
  const fetchImpl = options.fetchImpl || fetch;
  const migrationVerifier = options.migrationVerifier || verifyRbacAgainstDatabase;
  const adminSsoAllowlistVerifier = options.adminSsoAllowlistVerifier || verifyAdminSsoAllowlist;
  const steps: InstallStep[] = [];
  const warnings: string[] = [];
  const manifest = readManifest(config.root, config.artifactDir, config.manifestPath);
  const artifactPaths = validatedDeployArtifactPaths(config.root, manifest);

  const offline = verifySupacloudAppArtifact({
    root: config.root,
    artifactDir: config.artifactDir,
    manifestPath: config.manifestPath,
  });
  steps.push({ name: 'artifact-verification', status: 'done', detail: offline.ok ? 'ok' : 'failed' });
  if (!offline.ok) {
    throw new Error(`SupaCloud app artifact verification failed: ${offline.errors.join('; ')}`);
  }

  requireConfig(config);
  const bundleFiles = functionBundleFiles(
    artifactPaths.functionBundlePath,
    artifactPaths.adminStaticDirPath,
  );
  const clientSecrets = [
    config.token,
    config.bffSigningSecret,
    ...allowlistRedactionSecrets([
      config.adminSsoAllowedEmails,
      config.adminSsoAllowedDomains,
    ]),
  ];
  const client = new SupacloudClient(config.supacloudApiUrl, config.token, fetchImpl, clientSecrets);
  const gatewayClient = config.gatewayAdminToken
    ? new SupacloudClient(
      config.supacloudApiUrl,
      config.gatewayAdminToken,
      fetchImpl,
      [config.gatewayAdminToken, ...clientSecrets],
    )
    : null;

  if (options.skipMigration) {
    steps.push({ name: 'migration', status: 'skipped', detail: 'skipMigration=true' });
  } else if (config.dryRun) {
    steps.push({
      name: 'migration',
      status: 'planned',
      detail: `${HOSTED_MIGRATIONS.length} versioned supauth overlay migrations via SupaCloud Management API`,
    });
  } else {
    for (const migration of HOSTED_MIGRATIONS) {
      await runSupacloudMigration(client, config.projectRef, migration.name, migration.sql);
    }
    steps.push({
      name: 'migration',
      status: 'done',
      detail: `${HOSTED_MIGRATIONS.length} versioned overlay migrations via SupaCloud Management API`,
    });
  }

  if (options.skipMigration) {
    steps.push({ name: 'migration-verification', status: 'skipped', detail: 'skipMigration=true' });
  } else if (options.skipMigrationVerify) {
    steps.push({ name: 'migration-verification', status: 'skipped', detail: 'skipMigrationVerify=true' });
  } else if (config.dryRun) {
    steps.push({ name: 'migration-verification', status: 'planned', detail: 'RBAC helpers, grants, retired webhook tables, and unsafe RLS policies' });
  } else {
    const verification = await migrationVerifier(config.databaseUrl);
    const errors = rbacMigrationVerificationErrors(verification);
    if (errors.length > 0) {
      throw new Error(`SupaCloud overlay migration verification failed: ${errors.join('; ')}`);
    }
    steps.push({ name: 'migration-verification', status: 'done', detail: 'RBAC helpers, grants, retired webhook tables, and RLS policies passed' });
  }

  steps.push(await adminSsoAllowlistInstallStep(config, adminSsoAllowlistVerifier));

  if (options.skipSecrets) {
    steps.push({ name: 'runtime-env', status: 'skipped', detail: 'skipSecrets=true' });
  } else if (config.dryRun) {
    steps.push({ name: 'runtime-env', status: 'planned', detail: 'project runtime secrets' });
  } else {
    await client.request(`/v1/projects/${config.projectRef}/secrets`, {
      method: 'POST',
      body: JSON.stringify(functionEnv(config)),
    });
    steps.push({ name: 'runtime-env', status: 'done', detail: 'project runtime secrets' });
  }

  if (options.skipFunctionDeploy) {
    steps.push({ name: 'function-deploy', status: 'skipped', detail: 'skipFunctionDeploy=true' });
  } else if (config.dryRun) {
    steps.push({ name: 'function-deploy', status: 'planned', detail: 'supauth verify_jwt=false' });
  } else {
    await deployFunction({ client, projectRef: config.projectRef, files: bundleFiles });
    steps.push({ name: 'function-deploy', status: 'done', detail: 'supauth multi-file bundle verify_jwt=false' });
  }

  if (!config.baseUrl) {
    steps.push({ name: 'gateway-routes', status: 'skipped', detail: 'SUPAUTH_PUBLIC_URL is not set' });
    warnings.push('Gateway hosted routes were not configured because SUPAUTH_PUBLIC_URL or SUPAUTH_INSTALLED_BASE_URL is missing.');
  } else if (!gatewayClient) {
    steps.push({ name: 'gateway-routes', status: 'skipped', detail: 'SUPACLOUD_GATEWAY_ADMIN_TOKEN is not set' });
    warnings.push('Gateway hosted routes were not configured because an admin-scoped SupaCloud token is required.');
  } else if (config.dryRun) {
    steps.push({ name: 'gateway-routes', status: 'planned', detail: gatewayRouteDetail(config) });
  } else {
    await configureGatewayRoutes({
      client: gatewayClient,
      projectRef: config.projectRef,
      baseUrl: config.baseUrl,
      apiUrl: config.apiUrl,
      corsOrigins: config.corsOrigins,
      edgeRuntimeUpstream: config.edgeRuntimeUpstream,
    });
    steps.push({ name: 'gateway-routes', status: 'done', detail: gatewayRouteDetail(config) });
  }

  let probe: SupacloudInstallResult['directFunctionProbe'];
  if (options.skipDirectVerify) {
    steps.push({ name: 'direct-function-probe', status: 'skipped', detail: 'skipDirectVerify=true' });
  } else if (config.dryRun) {
    steps.push({ name: 'direct-function-probe', status: 'planned', detail: '/functions/v1/supauth/api/v1/health' });
  } else {
    probe = await directFunctionProbe(config.runtimeUrl, fetchImpl);
    steps.push({
      name: 'direct-function-probe',
      status: probe.ok ? 'done' : 'skipped',
      detail: `status=${probe.status}`,
    });
    if (!probe.ok) warnings.push(`Direct SupaCloud Function probe did not pass: status=${probe.status}`);
  }

  if (!config.baseUrl || !gatewayClient) {
    warnings.push('Gateway hosted routes (/api/*, /oauth/*, /account*, /claim*) still require SupaCloud route binding before installed-app verifier can pass.');
  }
  return {
    ok: !probe || probe.ok,
    dryRun: config.dryRun,
    artifactOk: true,
    projectRef: config.projectRef,
    supacloudApiUrl: config.supacloudApiUrl,
    runtimeUrl: config.runtimeUrl,
    functionSlug: 'supauth',
    steps,
    directFunctionProbe: probe,
    warnings,
  };
}

function option(name: string) {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return Bun.argv.includes(`--${name}`);
}

if (import.meta.main) {
  try {
    const output = option('output');
    const result = await installSupacloudApp({
      artifactDir: option('artifact-dir'),
      manifestPath: option('manifest'),
      envFile: option('env-file'),
      supacloudApiUrl: option('supacloud-api-url'),
      projectRef: option('project-ref'),
      token: option('token'),
      bffSigningSecret: option('bff-signing-secret'),
      gatewayAdminToken: option('gateway-admin-token'),
      runtimeUrl: option('runtime-url'),
      runtimeInternalUrl: option('runtime-internal-url'),
      oauthAuthorizationProjectRef: option('oauth-authorization-project-ref'),
      baseUrl: option('base-url'),
      apiUrl: option('api-url'),
      corsOrigins: option('cors-origins'),
      edgeRuntimeUpstream: option('edge-runtime-upstream'),
      databaseUrl: option('database-url'),
      adminSsoIssuer: option('admin-sso-issuer'),
      adminSsoClientId: option('admin-sso-client-id'),
      adminSsoJwksUri: option('admin-sso-jwks-uri'),
      adminSsoAudience: option('admin-sso-audience'),
      adminSsoRedirectUri: option('admin-sso-redirect-uri'),
      adminSsoPostLogoutRedirectUri: option('admin-sso-post-logout-redirect-uri'),
      adminSsoAllowedEmails: option('admin-sso-allowed-emails'),
      adminSsoAllowedDomains: option('admin-sso-allowed-domains'),
      dryRun: hasFlag('dry-run'),
      skipMigration: hasFlag('skip-migration'),
      skipMigrationVerify: hasFlag('skip-migration-verify'),
      skipSecrets: hasFlag('skip-secrets'),
      skipFunctionDeploy: hasFlag('skip-function-deploy'),
      skipDirectVerify: hasFlag('skip-direct-verify'),
    });

    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (output) {
      const path = resolve(output);
      writeFileSync(path, json);
      console.log(`SupAuth SupaCloud install summary written to ${path}`);
    } else {
      console.log(json);
    }

    if (!result.ok) process.exit(1);
  } catch (error) {
    const allowlistSecrets = allowlistRedactionSecrets([
      option('admin-sso-allowed-emails'),
      option('admin-sso-allowed-domains'),
      process.env[ADMIN_SSO_ENV.allowedEmails],
      process.env[ADMIN_SSO_ENV.allowedDomains],
    ]);
    const secrets = [
      option('token'),
      option('bff-signing-secret'),
      option('database-url'),
      ...allowlistSecrets,
      process.env.SUPACLOUD_API_TOKEN,
      process.env.SUPACLOUD_MASTER_TOKEN,
      process.env.SUPACLOUD_INTERNAL_TOKEN,
      process.env.SUPAOAUTH_BFF_SIGNING_SECRET,
      process.env.SUPACLOUD_GATEWAY_ADMIN_TOKEN,
      process.env.SUPACLOUD_ADMIN_TOKEN,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SUPACLOUD_DATABASE_URL,
      process.env.DATABASE_URL,
    ].filter((value): value is string => Boolean(value));
    const message = error instanceof Error ? error.message : String(error);
    console.error(redact(message, secrets));
    process.exit(1);
  }
}
