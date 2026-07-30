// P0-29: SupaOAuth route/domain integration gate
// Validates that all expected routes are reachable on the target
// SupaCloud stack and no Supabase standard paths are broken.

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import { runtimeEnv } from '../config/platform-env.js';

export interface RouteProbe {
  name: string;
  path: string;
  method: string;
  expectedStatus: number[];
  actualStatus: number | null;
  ok: boolean;
  error?: string;
  responseSnippet?: string;
}

export interface DomainAudit {
  domain: string;
  functionReachable: boolean;
  apiReachable: boolean;
  authReachable: boolean;
  tlsValid: boolean;
  error?: string;
}

export interface IntegrationGateResult {
  timestamp: string;
  projectRef: string;
  routes: RouteProbe[];
  domainAudit: DomainAudit[];
  envAudit: {
    supacloudApiUrl: string;
    oauthRuntimeUrl: string;
    runtimeMode: string;
    corsOrigins: string[];
    supauthUrl: string;
    runtimeUrl: string;
    extraDomains: string[];
  };
  allPassed: boolean;
  conflicts: string[];
}

/**
 * Probe a single HTTP endpoint.
 */
async function probeRoute(
  baseUrl: string,
  name: string,
  path: string,
  method: string = 'GET',
  expectedStatus: number[] = [200],
  headers: Record<string, string> = {},
): Promise<RouteProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      signal: controller.signal,
    });
    const body = await res.text().catch(() => '');
    const ok = expectedStatus.includes(res.status) &&
      !body.includes('no Route matched with those values');
    return {
      name,
      path,
      method,
      expectedStatus,
      actualStatus: res.status,
      ok,
      error: ok ? undefined : body.slice(0, 200),
    };
  } catch (e) {
    return {
      name,
      path,
      method,
      expectedStatus,
      actualStatus: null,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function localAdminUrl(): string {
  const config = getConfig();
  const host = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
  return `http://${host}:${config.port}`;
}

function parseCsv(value?: string): string[] {
  return (value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function resolveRouteGateInput(query?: Record<string, unknown>): {
  projectRef: string;
  supauthUrl: string;
  runtimeUrl: string;
  extraDomains: string[];
} {
  const config = getConfig();
  const supauthUrl = String(
    query?.supauth_url ||
    query?.admin_url ||
    runtimeEnv('SUPAUTH_INSTALLED_BASE_URL') ||
    process.env.SUPAOAUTH_ROUTE_GATE_ADMIN_URL ||
    process.env.SUPAOAUTH_ADMIN_URL ||
    localAdminUrl(),
  );
  const runtimeUrl = String(
    query?.runtime_url ||
    process.env.SUPAOAUTH_ROUTE_GATE_RUNTIME_URL ||
    config.oauthRuntimeUrl,
  );
  const extraDomains = [
    ...parseCsv(process.env.SUPAOAUTH_ROUTE_GATE_DOMAINS),
    ...parseCsv(query?.domains as string | undefined),
  ];

  return {
    projectRef: String(query?.project_ref || config.projectRef),
    supauthUrl: normalizeBaseUrl(supauthUrl),
    runtimeUrl: normalizeBaseUrl(runtimeUrl),
    extraDomains: extraDomains.map(normalizeBaseUrl),
  };
}

async function auditDomain(baseUrl: string): Promise<DomainAudit> {
  try {
    const url = new URL(baseUrl);
    const [adminRes, apiRes, runtimeRes] = await Promise.all([
      fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
      fetch(`${baseUrl}/rest/v1/`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
      fetch(`${baseUrl}/auth/v1/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
    ]);
    return {
      domain: url.hostname,
      functionReachable: adminRes?.ok ?? false,
      apiReachable: apiRes?.ok ?? false,
      authReachable: runtimeRes?.ok ?? false,
      tlsValid: url.protocol === 'https:',
    };
  } catch {
    return {
      domain: baseUrl,
      functionReachable: false,
      apiReachable: false,
      authReachable: false,
      tlsValid: false,
      error: 'Failed to resolve or connect',
    };
  }
}

/**
 * Run the full integration gate against a SupaCloud stack.
 * Tests all standard Supabase routes plus SupaOAuth-specific routes.
 */
export async function runIntegrationGate(
  projectRef: string,
  supauthUrl: string,
  runtimeUrl: string,
  extraDomains: string[] = [],
): Promise<IntegrationGateResult> {
  const config = getConfig();
  const conflicts: string[] = [];
  const normalizedSupauthUrl = normalizeBaseUrl(supauthUrl);
  const normalizedRuntimeUrl = normalizeBaseUrl(runtimeUrl);
  const normalizedExtraDomains = extraDomains.map(normalizeBaseUrl);

  // 1. Probe SupAuth SupaCloud Function/Pages routes
  const supauthRoutes: RouteProbe[] = await Promise.all([
    probeRoute(normalizedSupauthUrl, 'admin_root', '/admin', 'GET', [200, 301, 302]),
    probeRoute(normalizedSupauthUrl, 'function_health', '/api/v1/health', 'GET', [200]),
    probeRoute(normalizedSupauthUrl, 'swagger', '/api/swagger', 'GET', [200]),
    probeRoute(normalizedSupauthUrl, 'applications_unauth', '/api/v1/applications', 'GET', [401]),
    probeRoute(normalizedSupauthUrl, 'public_sie', '/v1/public/sign-in-experience/resolve', 'GET', [200, 400, 401, 422]),
    probeRoute(normalizedSupauthUrl, 'public_oauth', '/oauth/authorize', 'GET', [200, 302, 400]),
    probeRoute(normalizedSupauthUrl, 'claim_page', '/claim', 'GET', [200]),
  ]);

  // 2. Probe Supabase runtime routes (must not be broken)
  const runtimeRoutes: RouteProbe[] = await Promise.all([
    probeRoute(normalizedRuntimeUrl, 'gotrue_health', '/auth/v1/health', 'GET', [200]),
    probeRoute(normalizedRuntimeUrl, 'postgrest_root', '/rest/v1/', 'GET', [200, 401, 406]),
    probeRoute(normalizedRuntimeUrl, 'storage_buckets', '/storage/v1/bucket', 'GET', [200, 401]),
    probeRoute(normalizedRuntimeUrl, 'realtime_ws', '/realtime/v1/websocket', 'GET', [200, 400, 403, 426]),
    probeRoute(normalizedRuntimeUrl, 'functions_root', '/functions/v1/', 'GET', [200, 401, 404]),
    probeRoute(normalizedRuntimeUrl, 'auth_v1_signup', '/auth/v1/signup', 'POST', [200, 400, 401, 422]),
  ]);

  // 3. Check for route conflicts
  for (const probe of runtimeRoutes) {
    if (probe.actualStatus === 502 || probe.actualStatus === 503 || probe.actualStatus === 504) {
      conflicts.push(`${probe.name}: upstream error ${probe.actualStatus} on ${probe.path}`);
    }
    if (probe.error?.includes('no Route matched')) {
      conflicts.push(`${probe.name}: SupaCloud gateway route miss on ${probe.path}`);
    }
  }

  // 4. Domain audit
  const domainAudit = await Promise.all(
    [...new Set([normalizedSupauthUrl, normalizedRuntimeUrl, ...normalizedExtraDomains])].map(auditDomain),
  );

  const allRoutes = [...supauthRoutes, ...runtimeRoutes];
  const allPassed = allRoutes.every(r => r.ok) && conflicts.length === 0;

  return {
    timestamp: new Date().toISOString(),
    projectRef,
    routes: allRoutes,
    domainAudit,
    envAudit: {
      supacloudApiUrl: config.supacloudApiUrl,
      oauthRuntimeUrl: config.oauthRuntimeUrl,
      runtimeMode: config.runtimeMode,
      corsOrigins: config.corsOrigins,
      supauthUrl: normalizedSupauthUrl,
      runtimeUrl: normalizedRuntimeUrl,
      extraDomains: normalizedExtraDomains,
    },
    allPassed,
    conflicts,
  };
}

export const routeGateRoutes = new Elysia({ prefix: '/v1/route-gate' })
  .get('/', async ({ query }) => {
    const input = resolveRouteGateInput(query as Record<string, unknown>);
    return runIntegrationGate(input.projectRef, input.supauthUrl, input.runtimeUrl, input.extraDomains);
  }, {
    detail: {
      summary: 'Run route/domain integration gate',
      description: 'Validates installed SupAuth Function/Pages routes and preserved Supabase runtime routes on the target SupaCloud project. Reports conflicts, missing routes, and domain health.',
      tags: ['Route Gate'],
    },
  })

  .get('/routes', async ({ query }) => {
    const input = resolveRouteGateInput(query as Record<string, unknown>);
    const result = await runIntegrationGate(input.projectRef, input.supauthUrl, input.runtimeUrl, input.extraDomains);
    return {
      total: result.routes.length,
      passed: result.routes.filter(r => r.ok).length,
      failed: result.routes.filter(r => !r.ok),
      conflicts: result.conflicts,
      allPassed: result.allPassed,
    };
  }, {
    detail: {
      summary: 'Quick route health summary',
      tags: ['Route Gate'],
    },
  });
