#!/usr/bin/env bun
/**
 * Offline verifier for the SupAuth SupaCloud app artifact.
 *
 * This is the local preflight for SupaCloud project installation. It does not
 * call SupaCloud, but it proves the artifact is self-contained and declares the
 * required Function/Pages/runtime boundaries.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOSTED_MIGRATIONS } from '../packages/auth-server/src/db/migrate.js';

const ADMIN_SSO_REQUIRED_ENV = ['ADMIN_SSO_ISSUER', 'ADMIN_SSO_CLIENT_ID'];
const ADMIN_SSO_OPTIONAL_ENV = [
  'ADMIN_SSO_JWKS_URI',
  'ADMIN_SSO_AUDIENCE',
  'ADMIN_SSO_REDIRECT_URI',
  'ADMIN_SSO_POST_LOGOUT_REDIRECT_URI',
  'ADMIN_SSO_REQUIRE_AAL2',
];
const ADMIN_SSO_ALLOWLIST_ENV = ['ADMIN_SSO_ALLOWED_EMAILS', 'ADMIN_SSO_ALLOWED_DOMAINS'];
const ADMIN_SSO_GRANT_TYPES = ['authorization_code', 'refresh_token'];

const EXPECTED_REQUIRED_ENV = [
  'SUPACLOUD_INTERNAL_API_URL',
  'SUPACLOUD_INTERNAL_TOKEN',
  'SUPAOAUTH_BFF_SIGNING_SECRET',
  'SUPACLOUD_PROJECT_REF',
  'SUPACLOUD_RUNTIME_URL',
  'SUPACLOUD_DATABASE_URL',
  ...ADMIN_SSO_REQUIRED_ENV,
];

const EXPECTED_ADMIN_SSO_ENV = [
  ...ADMIN_SSO_REQUIRED_ENV.map((name) => ({ name, secret: false, optional: false })),
  ...ADMIN_SSO_OPTIONAL_ENV.map((name) => ({ name, secret: false, optional: true })),
  ...ADMIN_SSO_ALLOWLIST_ENV.map((name) => ({ name, secret: true, optional: true })),
] as const;

const EXPECTED_FUNCTION_ROUTES = [
  '/api/*',
  '/v1/*',
  '/v1/public/*',
  '/oauth/*',
  '/login',
  '/login.html',
  '/authorize.html',
  '/logout',
  '/logout.html',
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
  '/admin',
  '/',
];

const EXPECTED_PRESERVED_RUNTIME_ROUTES = [
  '/auth/v1/*',
  '/rest/v1/*',
  '/storage/v1/*',
  '/realtime/v1/*',
  '/functions/v1/*',
];

const EXPECTED_FORBIDDEN_RUNTIME_FORMS = [
  'standalone-http-server',
  'systemd-service',
  'pm2-process',
  'webhook-worker-process',
  'cron-process-owned-by-supauth',
];

const EXPECTED_SUPACLOUD_DOMAINS = [
  'applications',
  'organizations',
  'organization_members',
  'organization_invitations',
  'organization_jit',
  'organization_applications',
  'rbac_roles',
  'rbac_permissions',
  'rbac_assignments',
  'audit',
  'webhooks',
  'webhook_delivery',
  'providers',
  'secret_manager',
  'tenant_collaborators',
  'tenant_collaborator_invitations',
];

const EXPECTED_GOTRUE_DOMAINS = [
  'auth.users',
  'auth.identities',
  'auth.oauth_clients',
  'auth.oauth_grants',
  'auth.oauth_authorizations',
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.mfa_factors',
  'oauth_oidc_protocol',
  'jwt_signing_and_jwks',
  '/auth/v1/*',
];

const EXPECTED_SUPACLOUD_MANAGEMENT_FACADES = [
  'oauth_clients',
  'users',
  'user_mfa',
];

const FORBIDDEN_SUPACLOUD_OWNED_RUNTIME_DOMAINS = [
  'application_secrets',
  'oauth_clients',
  'oauth_grants',
  'users',
  'user_sessions',
  'user_identities',
  'user_mfa',
  'user_passkeys',
];

const FORBIDDEN_LOCAL_TABLES = ['passkeys', 'account_sessions', 'webhooks', 'webhook_deliveries'];
const FORBIDDEN_FUNCTION_BUNDLE_MARKERS = [
  'processPendingDeliveries',
  'deliverWebhookOnce',
  'X-SupaOAuth-Signature',
];

interface VerificationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifestPath: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasEvery(actual: unknown, expected: string[]) {
  const set = new Set(asArray(actual).map(String));
  return expected.filter((item) => !set.has(item));
}

function routePaths(routes: unknown) {
  return asArray(routes)
    .map((route) => asRecord(route).path)
    .filter((path): path is string => typeof path === 'string');
}

function fileExists(root: string, relativePath: string) {
  return existsSync(resolve(root, relativePath));
}

function assertAdminSsoEnvContract(
  result: VerificationResult,
  requiredEnv: Record<string, unknown>[],
) {
  for (const expected of EXPECTED_ADMIN_SSO_ENV) {
    const entry = requiredEnv.find((candidate) => candidate.name === expected.name);
    if (!entry) {
      result.errors.push(`Missing Admin SSO env contract: ${expected.name}`);
      continue;
    }
    if (entry.secret !== expected.secret) {
      result.errors.push(`${expected.name} secret flag must be ${expected.secret}`);
    }
    if ((entry.optional === true) !== expected.optional) {
      result.errors.push(`${expected.name} optional flag must be ${expected.optional}`);
    }
  }
}

function stringArray(manifestField: unknown) {
  return asArray(manifestField).map(String);
}

function hasExactStrings(manifestField: unknown, expected: string[]) {
  return JSON.stringify(stringArray(manifestField)) === JSON.stringify(expected);
}

function assertAdminSsoInstallContract(result: VerificationResult, manifest: Record<string, unknown>) {
  const adminSso = asRecord(manifest.admin_sso);
  const allowlist = asRecord(adminSso.allowlist);
  const clientContract = asRecord(adminSso.client_contract);
  if (!hasExactStrings(adminSso.required_env, ADMIN_SSO_REQUIRED_ENV)) {
    result.errors.push('Admin SSO contract must require issuer and client id');
  }
  if (!hasExactStrings(adminSso.optional_env, ADMIN_SSO_OPTIONAL_ENV)) {
    result.errors.push('Admin SSO contract has invalid optional public metadata');
  }
  const hasDatabaseContract = allowlist.database_table === 'supaoauth.security_config'
    && hasExactStrings(allowlist.database_fields, ['admin_allowed_emails', 'admin_allowed_domains']);
  const hasEnvironmentContract = hasExactStrings(allowlist.optional_secret_env, ADMIN_SSO_ALLOWLIST_ENV)
    && allowlist.install_rule === 'exact-email-count-positive-and-domain-count-zero';
  if (!hasDatabaseContract || !hasEnvironmentContract) {
    result.errors.push('Admin SSO allowlist contract must require exact emails and forbid domain authorization');
  }
  const hasClientContract = clientContract.verification === 'management-api-readback'
    && clientContract.client_type === 'public'
    && clientContract.token_endpoint_auth_method === 'none'
    && clientContract.redirect_uris === 'exact-single'
    && hasExactStrings(clientContract.grant_types, ADMIN_SSO_GRANT_TYPES)
    && clientContract.pkce_code_challenge_method === 'S256'
    && clientContract.browser_client_secret === 'forbidden'
    && clientContract.required_aal === 'aal2-when-ADMIN_SSO_REQUIRE_AAL2=true';
  if (!hasClientContract) {
    result.errors.push('Admin SSO client contract must require management read-back, public PKCE S256, exact redirect, no secret, and the server-controlled AAL2 policy');
  }
}

function assertFunctionDeploymentBundle(result: VerificationResult, supauthFunction: Record<string, unknown>) {
  const deploymentBundle = asRecord(supauthFunction.deployment_bundle);
  const deploymentFiles = asArray(deploymentBundle.files).map(asRecord);
  const functionFile = deploymentFiles.find((entry) => entry.artifact === 'function_bundle');
  const adminFiles = deploymentFiles.find((entry) => entry.artifact === 'admin_static_dir');
  if (deploymentBundle.entrypoint !== 'index.ts' || functionFile?.target !== 'index.ts') {
    result.errors.push('Function deployment bundle must publish function_bundle as index.ts');
  }
  if (adminFiles?.target_prefix !== 'admin-console/build'
    || adminFiles?.recursive !== true
    || adminFiles?.text_only !== true) {
    result.errors.push('Function deployment bundle must recursively publish text Admin assets under admin-console/build');
  }
}

function assertNoRuntimeRouteCollision(result: VerificationResult, functionRoutes: string[], preservedRoutes: string[]) {
  for (const route of functionRoutes) {
    for (const preserved of preservedRoutes) {
      const preservedPrefix = preserved.replace(/\*$/, '');
      if (route === preserved || route.startsWith(preservedPrefix)) {
        result.errors.push(`Function route ${route} collides with preserved runtime route ${preserved}`);
      }
    }
  }
}

export function verifySupacloudAppArtifact(input: {
  root?: string;
  artifactDir?: string;
  manifestPath?: string;
} = {}): VerificationResult {
  const root = resolve(input.root || new URL('..', import.meta.url).pathname);
  const artifactDir = resolve(root, input.artifactDir || 'artifacts/supacloud-app');
  const manifestPath = input.manifestPath ? resolve(root, input.manifestPath) : resolve(artifactDir, 'supacloud-app-manifest.json');
  const result: VerificationResult = { ok: false, errors: [], warnings: [], manifestPath };

  if (!existsSync(manifestPath)) {
    result.errors.push(`Missing SupaCloud app manifest: ${manifestPath}`);
    return result;
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    result.errors.push(`Invalid JSON manifest: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  if (manifest.http_runtime !== 'supacloud-functions-only') {
    result.errors.push('Manifest must declare http_runtime=supacloud-functions-only');
  }
  if (manifest.source_of_truth !== 'supacloud-management-api') {
    result.errors.push('Manifest must declare source_of_truth=supacloud-management-api');
  }
  if (manifest.runtime_mode !== 'gotrue') {
    result.errors.push('Manifest must declare runtime_mode=gotrue');
  }
  if (manifest.install_mode !== 'supacloud-project-scoped') {
    result.errors.push('Manifest must declare install_mode=supacloud-project-scoped');
  }

  const authority = asRecord(manifest.authority);
  if (authority.auth_runtime !== 'gotrue') {
    result.errors.push('Manifest authority.auth_runtime must be gotrue');
  }
  if (authority.control_plane !== 'supacloud-management-api') {
    result.errors.push('Manifest authority.control_plane must be supacloud-management-api');
  }
  if (authority.overlay !== 'supaoauth-schema') {
    result.errors.push('Manifest authority.overlay must be supaoauth-schema');
  }

  for (const missing of hasEvery(manifest.forbidden_runtime_forms, EXPECTED_FORBIDDEN_RUNTIME_FORMS)) {
    result.errors.push(`Missing forbidden runtime form: ${missing}`);
  }
  const supacloudOwnedDomains = new Set(asArray(manifest.supacloud_owned_management_domains).map(String));
  for (const missing of hasEvery(manifest.supacloud_owned_management_domains, EXPECTED_SUPACLOUD_DOMAINS)) {
    result.errors.push(`Missing SupaCloud-owned management domain: ${missing}`);
  }
  for (const domain of FORBIDDEN_SUPACLOUD_OWNED_RUNTIME_DOMAINS) {
    if (supacloudOwnedDomains.has(domain)) {
      result.errors.push(`GoTrue-owned runtime domain cannot be SupaCloud-owned: ${domain}`);
    }
  }
  for (const missing of hasEvery(manifest.gotrue_owned_runtime_domains, EXPECTED_GOTRUE_DOMAINS)) {
    result.errors.push(`Missing GoTrue-owned runtime domain: ${missing}`);
  }
  for (const missing of hasEvery(manifest.supacloud_management_facades, EXPECTED_SUPACLOUD_MANAGEMENT_FACADES)) {
    result.errors.push(`Missing delegated SupaCloud management facade: ${missing}`);
  }
  for (const missing of hasEvery(manifest.preserved_runtime_routes, EXPECTED_PRESERVED_RUNTIME_ROUTES)) {
    result.errors.push(`Missing preserved runtime route: ${missing}`);
  }

  const tableOwnership = asRecord(manifest.supaoauth_table_ownership);
  for (const table of FORBIDDEN_LOCAL_TABLES) {
    if (Object.prototype.hasOwnProperty.call(tableOwnership, table)) {
      result.errors.push(`Removed local table must not be advertised: ${table}`);
    }
  }
  if (asRecord(tableOwnership.user_consents).replacement !== 'gotrue-oauth-grants') {
    result.errors.push('Legacy user_consents table must defer to GoTrue OAuth grants');
  }
  if (asRecord(tableOwnership.application_secrets).replacement !== 'gotrue:oauth-client-secret-rotation') {
    result.errors.push('Legacy application_secrets table must defer to GoTrue client-secret rotation');
  }

  const requiredEnv = asArray(manifest.required_supacloud_env).map((entry) => asRecord(entry));
  const envNames = requiredEnv.map((entry) => String(entry.name || ''));
  for (const envName of EXPECTED_REQUIRED_ENV) {
    if (!envNames.includes(envName)) result.errors.push(`Missing required SupaCloud env: ${envName}`);
  }
  const tokenEnv = requiredEnv.find((entry) => entry.name === 'SUPACLOUD_INTERNAL_TOKEN');
  const bffSigningSecretEnv = requiredEnv.find((entry) => entry.name === 'SUPAOAUTH_BFF_SIGNING_SECRET');
  const databaseEnv = requiredEnv.find((entry) => entry.name === 'SUPACLOUD_DATABASE_URL');
  const oauthAuthorizationProjectRefEnv = requiredEnv.find((entry) => entry.name === 'SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF');
  if (tokenEnv?.secret !== true) result.errors.push('SUPACLOUD_INTERNAL_TOKEN must be marked secret');
  if (bffSigningSecretEnv?.secret !== true) result.errors.push('SUPAOAUTH_BFF_SIGNING_SECRET must be marked secret');
  if (databaseEnv?.secret !== true) result.errors.push('SUPACLOUD_DATABASE_URL must be marked secret');
  if (oauthAuthorizationProjectRefEnv && oauthAuthorizationProjectRefEnv.optional !== true) {
    result.errors.push('SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF must be marked optional');
  }
  assertAdminSsoEnvContract(result, requiredEnv);
  assertAdminSsoInstallContract(result, manifest);

  const artifacts = asRecord(manifest.artifacts);
  const functionBundle = String(artifacts.function_bundle || '');
  const adminStaticDir = String(artifacts.admin_static_dir || '');
  const openapiPath = String(artifacts.openapi || '');
  if (!functionBundle || !fileExists(root, functionBundle)) result.errors.push(`Missing Function bundle artifact: ${functionBundle}`);
  if (!adminStaticDir || !fileExists(root, adminStaticDir)) result.errors.push(`Missing Admin Pages artifact dir: ${adminStaticDir}`);
  if (!openapiPath || !fileExists(root, openapiPath)) result.errors.push(`Missing OpenAPI artifact: ${openapiPath}`);

  if (functionBundle && fileExists(root, functionBundle)) {
    const functionSource = readFileSync(resolve(root, functionBundle), 'utf8');
    for (const marker of FORBIDDEN_FUNCTION_BUNDLE_MARKERS) {
      if (functionSource.includes(marker)) {
        result.errors.push(`Function bundle contains removed local webhook implementation: ${marker}`);
      }
    }
  }

  if (adminStaticDir) {
    for (const requiredPage of ['index.html', 'authorize.html', 'claim.html', 'change-password.html', 'account.html', 'logout.html']) {
      if (!fileExists(root, `${adminStaticDir}/${requiredPage}`)) {
        result.errors.push(`Missing Admin/hosted page artifact: ${adminStaticDir}/${requiredPage}`);
      }
    }
  }

  const functions = asArray(manifest.functions).map(asRecord);
  if (functions.length !== 1) {
    result.errors.push(`Manifest must declare exactly one SupAuth Function, found ${functions.length}`);
  }
  const supauthFunction = functions[0] || {};
  if (supauthFunction.entrypoint !== functionBundle) {
    result.errors.push('Function entrypoint must match artifacts.function_bundle');
  }
  if (supauthFunction.runtime !== 'bun') {
    result.errors.push('SupAuth Function runtime must be bun');
  }
  assertFunctionDeploymentBundle(result, supauthFunction);
  const functionRoutes = routePaths(supauthFunction.routes);
  for (const missing of EXPECTED_FUNCTION_ROUTES.filter((route) => !functionRoutes.includes(route))) {
    result.errors.push(`Missing Function route: ${missing}`);
  }
  assertNoRuntimeRouteCollision(result, functionRoutes, EXPECTED_PRESERVED_RUNTIME_ROUTES);

  const pages = asArray(manifest.pages).map(asRecord);
  const adminPage = pages.find((page) => page.name === 'supauth-admin');
  if (!adminPage) {
    result.errors.push('Manifest must declare supauth-admin Pages artifact');
  } else {
    if (adminPage.source_dir !== adminStaticDir) result.errors.push('supauth-admin source_dir must match artifacts.admin_static_dir');
    const pageRoutes = asArray(adminPage.routes).map(String);
    if (!pageRoutes.includes('/admin')) result.errors.push('supauth-admin must route /admin');
    if (!pageRoutes.includes('/admin/*')) result.errors.push('supauth-admin must route /admin/*');
  }

  const migrations = asArray(manifest.migrations).map(asRecord);
  for (const expectedMigration of HOSTED_MIGRATIONS) {
    const manifestMigration = migrations.find((migration) => migration.name === expectedMigration.name);
    if (!manifestMigration) {
      result.errors.push(`Manifest must declare ${expectedMigration.name} migration`);
    } else if (manifestMigration.database_env !== 'SUPACLOUD_DATABASE_URL') {
      result.errors.push(`${expectedMigration.name} migration must use SUPACLOUD_DATABASE_URL`);
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}

function option(name: string) {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

if (import.meta.main) {
  const result = verifySupacloudAppArtifact({
    artifactDir: option('artifact-dir'),
    manifestPath: option('manifest'),
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
