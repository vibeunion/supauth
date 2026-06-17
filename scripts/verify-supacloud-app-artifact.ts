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

const EXPECTED_REQUIRED_ENV = [
  'SUPACLOUD_INTERNAL_API_URL',
  'SUPACLOUD_INTERNAL_TOKEN',
  'SUPACLOUD_PROJECT_REF',
  'SUPACLOUD_RUNTIME_URL',
  'SUPACLOUD_DATABASE_URL',
];

const EXPECTED_FUNCTION_ROUTES = [
  '/api/*',
  '/v1/public/*',
  '/oauth/*',
  '/login.html',
  '/account',
  '/account.html',
  '/account/*',
  '/change-password',
  '/change-password.html',
  '/claim',
  '/claim.html',
  '/favicon.ico',
  '/favicon.svg',
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
  'application_secrets',
  'users',
  'user_sessions',
  'user_identities',
  'user_mfa',
  'user_passkeys',
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
  if (manifest.install_mode !== 'supacloud-project-scoped') {
    result.errors.push('Manifest must declare install_mode=supacloud-project-scoped');
  }

  for (const missing of hasEvery(manifest.forbidden_runtime_forms, EXPECTED_FORBIDDEN_RUNTIME_FORMS)) {
    result.errors.push(`Missing forbidden runtime form: ${missing}`);
  }
  for (const missing of hasEvery(manifest.supacloud_owned_management_domains, EXPECTED_SUPACLOUD_DOMAINS)) {
    result.errors.push(`Missing SupaCloud-owned management domain: ${missing}`);
  }
  for (const missing of hasEvery(manifest.preserved_runtime_routes, EXPECTED_PRESERVED_RUNTIME_ROUTES)) {
    result.errors.push(`Missing preserved runtime route: ${missing}`);
  }

  const requiredEnv = asArray(manifest.required_supacloud_env).map((entry) => asRecord(entry));
  const envNames = requiredEnv.map((entry) => String(entry.name || ''));
  for (const envName of EXPECTED_REQUIRED_ENV) {
    if (!envNames.includes(envName)) result.errors.push(`Missing required SupaCloud env: ${envName}`);
  }
  const tokenEnv = requiredEnv.find((entry) => entry.name === 'SUPACLOUD_INTERNAL_TOKEN');
  const databaseEnv = requiredEnv.find((entry) => entry.name === 'SUPACLOUD_DATABASE_URL');
  if (tokenEnv?.secret !== true) result.errors.push('SUPACLOUD_INTERNAL_TOKEN must be marked secret');
  if (databaseEnv?.secret !== true) result.errors.push('SUPACLOUD_DATABASE_URL must be marked secret');

  const artifacts = asRecord(manifest.artifacts);
  const functionBundle = String(artifacts.function_bundle || '');
  const adminStaticDir = String(artifacts.admin_static_dir || '');
  const openapiPath = String(artifacts.openapi || '');
  if (!functionBundle || !fileExists(root, functionBundle)) result.errors.push(`Missing Function bundle artifact: ${functionBundle}`);
  if (!adminStaticDir || !fileExists(root, adminStaticDir)) result.errors.push(`Missing Admin Pages artifact dir: ${adminStaticDir}`);
  if (!openapiPath || !fileExists(root, openapiPath)) result.errors.push(`Missing OpenAPI artifact: ${openapiPath}`);

  if (adminStaticDir) {
    for (const requiredPage of ['index.html', 'authorize.html', 'claim.html', 'change-password.html', 'account.html']) {
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
    if (!pageRoutes.includes('/admin/*')) result.errors.push('supauth-admin must route /admin/*');
  }

  const migrations = asArray(manifest.migrations).map(asRecord);
  const overlayMigration = migrations.find((migration) => migration.name === 'supauth-overlay-schema');
  const grantsMigration = migrations.find((migration) => migration.name === 'supauth-overlay-project-role-grants');
  if (!overlayMigration) {
    result.errors.push('Manifest must declare supauth-overlay-schema migration');
  } else if (overlayMigration.database_env !== 'SUPACLOUD_DATABASE_URL') {
    result.errors.push('supauth-overlay-schema migration must use SUPACLOUD_DATABASE_URL');
  }
  if (!grantsMigration) {
    result.errors.push('Manifest must declare supauth-overlay-project-role-grants migration');
  } else if (grantsMigration.database_env !== 'SUPACLOUD_DATABASE_URL') {
    result.errors.push('supauth-overlay-project-role-grants migration must use SUPACLOUD_DATABASE_URL');
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
