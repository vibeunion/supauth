#!/usr/bin/env bun
/**
 * Install the SupAuth SupaCloud app artifact into an existing SupaCloud project.
 *
 * The installer is intentionally explicit about migration: SupAuth is a
 * Function-only app, but its overlay schema must exist before the Function is
 * considered installed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIGRATION_SQL, PROJECT_ROLE_GRANTS_SQL } from '../packages/auth-server/src/db/migrate.js';
import { verifySupacloudAppArtifact } from './verify-supacloud-app-artifact.js';
import { verifyRbacAgainstDatabase } from '../packages/auth-server/src/compatibility/rbac-verify.js';
import type { RbacDbVerification } from '../packages/auth-server/src/compatibility/rbac-verify.js';

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type MigrationVerifier = (databaseUrl: string) => Promise<RbacDbVerification>;

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
  gatewayAdminToken?: string;
  runtimeUrl?: string;
  runtimeInternalUrl?: string;
  baseUrl?: string;
  edgeRuntimeUpstream?: string;
  databaseUrl?: string;
  dryRun?: boolean;
  skipMigration?: boolean;
  skipMigrationVerify?: boolean;
  skipSecrets?: boolean;
  skipFunctionDeploy?: boolean;
  skipDirectVerify?: boolean;
  fetchImpl?: FetchImpl;
  migrationVerifier?: MigrationVerifier;
}

interface ResolvedInstallConfig {
  root: string;
  artifactDir: string;
  manifestPath?: string;
  supacloudApiUrl: string;
  projectRef: string;
  token: string;
  gatewayAdminToken: string;
  runtimeUrl: string;
  runtimeInternalUrl: string;
  baseUrl: string;
  edgeRuntimeUpstream: string;
  databaseUrl: string;
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

function resolveConfig(options: InstallSupacloudAppOptions): ResolvedInstallConfig {
  const root = resolve(options.root || new URL('..', import.meta.url).pathname);
  const artifactDir = resolve(root, options.artifactDir || 'artifacts/supacloud-app');
  const fileEnv = options.envFile ? parseEnvFile(resolve(root, options.envFile)) : {};
  const cliEnv: Record<string, string | undefined> = {
    SUPACLOUD_API_URL: options.supacloudApiUrl,
    SUPACLOUD_PROJECT_REF: options.projectRef,
    SUPACLOUD_API_TOKEN: options.token,
    SUPACLOUD_GATEWAY_ADMIN_TOKEN: options.gatewayAdminToken,
    SUPACLOUD_RUNTIME_URL: options.runtimeUrl,
    SUPACLOUD_RUNTIME_INTERNAL_URL: options.runtimeInternalUrl,
    SUPAUTH_PUBLIC_URL: options.baseUrl,
    SUPACLOUD_EDGE_RUNTIME_UPSTREAM: options.edgeRuntimeUpstream,
    SUPACLOUD_DATABASE_URL: options.databaseUrl,
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
  const runtimeUrl = firstValue(sources, ['SUPACLOUD_RUNTIME_URL', 'OAUTH_RUNTIME_URL', 'SUPABASE_URL']);
  const runtimeInternalUrl = firstValue(sources, [
    'SUPACLOUD_RUNTIME_INTERNAL_URL',
    'OAUTH_RUNTIME_INTERNAL_URL',
    'GOTRUE_INTERNAL_URL',
  ]);
  const databaseUrl = firstValue(sources, ['SUPACLOUD_DATABASE_URL', 'SUPABASE_DB_URL']);
  const baseUrl = firstValue(sources, ['SUPAUTH_PUBLIC_URL', 'AUTH_PUBLIC_URL', 'SUPAUTH_INSTALLED_BASE_URL', 'SUPAUTH_BASE_URL']);
  const edgeRuntimeUpstream = firstValue(sources, ['SUPACLOUD_EDGE_RUNTIME_UPSTREAM', 'EDGE_RUNTIME_UPSTREAM']);

  return {
    root,
    artifactDir,
    manifestPath: options.manifestPath,
    supacloudApiUrl: stripTrailingSlash(supacloudApiUrl),
    projectRef,
    token,
    gatewayAdminToken,
    runtimeUrl: stripTrailingSlash(runtimeUrl),
    runtimeInternalUrl: stripTrailingSlash(runtimeInternalUrl),
    baseUrl: stripTrailingSlash(baseUrl),
    edgeRuntimeUpstream: edgeRuntimeUpstream || '127.0.0.1:9000',
    databaseUrl,
    dryRun: options.dryRun === true,
  };
}

function requireConfig(config: ResolvedInstallConfig) {
  const missing: string[] = [];
  if (!config.supacloudApiUrl) missing.push('SUPACLOUD_API_URL');
  if (!config.projectRef) missing.push('SUPACLOUD_PROJECT_REF');
  if (!config.token) missing.push('SUPACLOUD_API_TOKEN');
  if (!config.runtimeUrl) missing.push('SUPACLOUD_RUNTIME_URL');
  if (!config.databaseUrl) missing.push('SUPACLOUD_DATABASE_URL');
  if (missing.length > 0) {
    throw new Error(`Missing required install configuration: ${missing.join(', ')}`);
  }
}

function readManifest(root: string, artifactDir: string, manifestPath?: string) {
  const path = manifestPath ? resolve(root, manifestPath) : resolve(artifactDir, 'supacloud-app-manifest.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

function artifactPath(root: string, manifest: Record<string, any>, key: string) {
  const value = manifest.artifacts?.[key];
  if (!value || typeof value !== 'string') throw new Error(`Manifest artifact is missing: ${key}`);
  const path = resolve(root, value);
  if (!existsSync(path)) throw new Error(`Manifest artifact file is missing: ${value}`);
  return path;
}

function redact(text: string, secrets: string[]) {
  let output = text;
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

class SupacloudClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchImpl,
  ) {}

  async request(path: string, init: RequestInit & { okStatuses?: number[] } = {}) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const { okStatuses, ...requestInit } = init;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...requestInit, headers });
    if (!response.ok && !okStatuses?.includes(response.status)) {
      const text = await response.text().catch(() => '');
      throw new Error(`SupaCloud API ${init.method || 'GET'} ${path} failed with ${response.status}: ${redact(text, [this.token])}`);
    }
    return response;
  }
}

function functionEnv(config: ResolvedInstallConfig) {
  return [
    { name: 'SUPACLOUD_INTERNAL_API_URL', value: config.supacloudApiUrl },
    { name: 'SUPACLOUD_INTERNAL_TOKEN', value: config.token },
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
    { name: 'SUPACLOUD_DATABASE_URL', value: config.databaseUrl },
  ];
}

function hostnameFromUrl(url: string) {
  if (!url) return '';
  return new URL(url).hostname;
}

async function deployFunction(input: {
  client: SupacloudClient;
  projectRef: string;
  functionBundlePath: string;
}) {
  const code = readFileSync(input.functionBundlePath, 'utf8');
  await input.client.request(`/v1/projects/${input.projectRef}/functions/supauth/bundle`, {
    method: 'POST',
    body: JSON.stringify({
      files: { 'index.ts': code },
      entrypoint: 'index.ts',
      minify: false,
    }),
  });
  await input.client.request(`/v1/projects/${input.projectRef}/functions/supauth/config`, {
    method: 'PATCH',
    body: JSON.stringify({ verify_jwt: false }),
  });
}

async function configureGatewayRoutes(input: {
  client: SupacloudClient;
  projectRef: string;
  baseUrl: string;
  edgeRuntimeUpstream: string;
}) {
  const host = hostnameFromUrl(input.baseUrl);
  if (!host) throw new Error('SUPAUTH_PUBLIC_URL or SUPAUTH_INSTALLED_BASE_URL is required for gateway route binding');

  await input.client.request(`/v1/projects/${input.projectRef}/gateway/routes`, {
    method: 'POST',
    body: JSON.stringify({
      id: 'supauth-function-hosted',
      hosts: [host],
      path: [
        '/api/*',
        '/v1/*',
        '/v1/public/*',
        '/oauth/*',
        '/login.html',
        '/authorize.html',
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
      ],
      upstream: input.edgeRuntimeUpstream,
      rewrite_uri: '/functions/v1/supauth{http.request.uri.path}',
      priority: 100,
    }),
  });
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
  if (!result.hasOrgPermissionExists) errors.push('supaoauth.has_org_permission() is missing');
  if (!result.authorizeGranted) errors.push('authenticated lacks EXECUTE on supaoauth.authorize(TEXT, UUID)');
  if (!result.hasOrgPermissionGranted) errors.push('authenticated lacks EXECUTE on supaoauth.has_org_permission(UUID, TEXT)');
  const unsafePolicyCount = result.unsafePolicies?.length ?? 0;
  if (unsafePolicyCount > 0) errors.push(`${unsafePolicyCount} RLS policy/policies still use JWT role claim for business authorization`);
  return errors;
}

async function directFunctionProbe(runtimeUrl: string, fetchImpl: FetchImpl) {
  const url = `${runtimeUrl}/functions/v1/supauth/api/v1/health`;
  const response = await fetchImpl(url, { method: 'GET' });
  return { url, status: response.status, ok: response.status >= 200 && response.status < 300 };
}

export async function installSupacloudApp(options: InstallSupacloudAppOptions = {}): Promise<SupacloudInstallResult> {
  const config = resolveConfig(options);
  const fetchImpl = options.fetchImpl || fetch;
  const migrationVerifier = options.migrationVerifier || verifyRbacAgainstDatabase;
  const steps: InstallStep[] = [];
  const warnings: string[] = [];

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
  const manifest = readManifest(config.root, config.artifactDir, config.manifestPath);
  const functionBundlePath = artifactPath(config.root, manifest, 'function_bundle');
  const client = new SupacloudClient(config.supacloudApiUrl, config.token, fetchImpl);
  const gatewayClient = config.gatewayAdminToken
    ? new SupacloudClient(config.supacloudApiUrl, config.gatewayAdminToken, fetchImpl)
    : null;

  if (options.skipMigration) {
    steps.push({ name: 'migration', status: 'skipped', detail: 'skipMigration=true' });
  } else if (config.dryRun) {
    steps.push({ name: 'migration', status: 'planned', detail: 'supauth-overlay-schema via SupaCloud Management API' });
  } else {
    await runSupacloudMigration(client, config.projectRef, 'supauth-overlay-schema', MIGRATION_SQL);
    await runSupacloudMigration(client, config.projectRef, 'supauth-overlay-project-role-grants', PROJECT_ROLE_GRANTS_SQL);
    steps.push({ name: 'migration', status: 'done', detail: 'supauth-overlay-schema + project role grants via SupaCloud Management API' });
  }

  if (options.skipMigration) {
    steps.push({ name: 'migration-verification', status: 'skipped', detail: 'skipMigration=true' });
  } else if (options.skipMigrationVerify) {
    steps.push({ name: 'migration-verification', status: 'skipped', detail: 'skipMigrationVerify=true' });
  } else if (config.dryRun) {
    steps.push({ name: 'migration-verification', status: 'planned', detail: 'RBAC helper functions, grants, and unsafe RLS policy scan' });
  } else {
    const verification = await migrationVerifier(config.databaseUrl);
    const errors = rbacMigrationVerificationErrors(verification);
    if (errors.length > 0) {
      throw new Error(`SupaCloud overlay migration verification failed: ${errors.join('; ')}`);
    }
    steps.push({ name: 'migration-verification', status: 'done', detail: 'RBAC helper functions, grants, and RLS policy scan passed' });
  }

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
    await deployFunction({ client, projectRef: config.projectRef, functionBundlePath });
    steps.push({ name: 'function-deploy', status: 'done', detail: 'supauth verify_jwt=false' });
  }

  if (!config.baseUrl) {
    steps.push({ name: 'gateway-routes', status: 'skipped', detail: 'SUPAUTH_PUBLIC_URL is not set' });
    warnings.push('Gateway hosted routes were not configured because SUPAUTH_PUBLIC_URL or SUPAUTH_INSTALLED_BASE_URL is missing.');
  } else if (!gatewayClient) {
    steps.push({ name: 'gateway-routes', status: 'skipped', detail: 'SUPACLOUD_GATEWAY_ADMIN_TOKEN is not set' });
    warnings.push('Gateway hosted routes were not configured because an admin-scoped SupaCloud token is required.');
  } else if (config.dryRun) {
    steps.push({ name: 'gateway-routes', status: 'planned', detail: `${hostnameFromUrl(config.baseUrl)} -> /functions/v1/supauth` });
  } else {
    await configureGatewayRoutes({
      client: gatewayClient,
      projectRef: config.projectRef,
      baseUrl: config.baseUrl,
      edgeRuntimeUpstream: config.edgeRuntimeUpstream,
    });
    steps.push({ name: 'gateway-routes', status: 'done', detail: `${hostnameFromUrl(config.baseUrl)} -> /functions/v1/supauth` });
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
      gatewayAdminToken: option('gateway-admin-token'),
      runtimeUrl: option('runtime-url'),
      runtimeInternalUrl: option('runtime-internal-url'),
      baseUrl: option('base-url'),
      edgeRuntimeUpstream: option('edge-runtime-upstream'),
      databaseUrl: option('database-url'),
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
    const secrets = [
      option('token'),
      option('database-url'),
      process.env.SUPACLOUD_API_TOKEN,
      process.env.SUPACLOUD_MASTER_TOKEN,
      process.env.SUPACLOUD_INTERNAL_TOKEN,
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
