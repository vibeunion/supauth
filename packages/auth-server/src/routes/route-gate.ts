// P0-29: SupaOAuth route/domain integration gate
// Validates that all expected routes are reachable on the target
// SupaCloud stack and no Supabase standard paths are broken.

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { getConfig } from '../config/index.js';

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
  adminReachable: boolean;
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

/**
 * Run the full integration gate against a SupaCloud stack.
 * Tests all standard Supabase routes plus SupaOAuth-specific routes.
 */
export async function runIntegrationGate(
  projectRef: string,
  adminUrl: string,
  runtimeUrl: string,
): Promise<IntegrationGateResult> {
  const config = getConfig();
  const conflicts: string[] = [];

  // 1. Probe SupaOAuth admin routes
  const adminRoutes: RouteProbe[] = await Promise.all([
    probeRoute(adminUrl, 'admin_root', '/admin', 'GET', [200, 301, 302]),
    probeRoute(adminUrl, 'health', '/api/v1/health', 'GET', [200]),
    probeRoute(adminUrl, 'swagger', '/swagger', 'GET', [200]),
    probeRoute(adminUrl, 'applications_unauth', '/api/v1/applications', 'GET', [401]),
    probeRoute(adminUrl, 'public_sie', '/api/v1/sign-in-experience/public', 'GET', [200, 404]),
    probeRoute(adminUrl, 'public_oauth', '/api/v1/oauth/authorize', 'GET', [200, 302, 400, 404]),
  ]);

  // 2. Probe Supabase runtime routes (must not be broken)
  const runtimeRoutes: RouteProbe[] = await Promise.all([
    probeRoute(runtimeUrl, 'gotrue_health', '/auth/v1/health', 'GET', [200]),
    probeRoute(runtimeUrl, 'postgrest_root', '/rest/v1/', 'GET', [200, 401, 406]),
    probeRoute(runtimeUrl, 'storage_buckets', '/storage/v1/bucket', 'GET', [200, 401]),
    probeRoute(runtimeUrl, 'realtime_ws', '/realtime/v1/websocket', 'GET', [200, 400, 403, 426]),
    probeRoute(runtimeUrl, 'functions_root', '/functions/v1/', 'GET', [200, 401, 404]),
    probeRoute(runtimeUrl, 'auth_v1_signup', '/auth/v1/signup', 'POST', [200, 400, 401, 422]),
  ]);

  // 3. Check for route conflicts
  for (const probe of runtimeRoutes) {
    if (probe.actualStatus === 502 || probe.actualStatus === 503 || probe.actualStatus === 504) {
      conflicts.push(`${probe.name}: upstream error ${probe.actualStatus} on ${probe.path}`);
    }
    if (probe.error?.includes('no Route matched')) {
      conflicts.push(`${probe.name}: Kong route miss on ${probe.path}`);
    }
  }

  // 4. Domain audit
  const domainAudit: DomainAudit[] = [];
  const domains = [adminUrl, runtimeUrl];
  for (const domain of domains) {
    try {
      const url = new URL(domain);
      const baseDomain = url.hostname;

      // Test admin reachability
      const adminRes = await fetch(`${adminUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      // Test runtime reachability
      const runtimeRes = await fetch(`${runtimeUrl}/auth/v1/health`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      domainAudit.push({
        domain: baseDomain,
        adminReachable: adminRes?.ok ?? false,
        apiReachable: adminRes?.ok ?? false,
        authReachable: runtimeRes?.ok ?? false,
        tlsValid: url.protocol === 'https:',
      });
    } catch {
      domainAudit.push({
        domain,
        adminReachable: false,
        apiReachable: false,
        authReachable: false,
        tlsValid: false,
        error: 'Failed to resolve or connect',
      });
    }
  }

  const allRoutes = [...adminRoutes, ...runtimeRoutes];
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
    },
    allPassed,
    conflicts,
  };
}

export const routeGateRoutes = new Elysia({ prefix: '/v1/route-gate' })
  .get('/', async () => {
    const config = getConfig();
    const adminUrl = `http://${config.host}:${config.port}`;
    const runtimeUrl = config.oauthRuntimeUrl;
    return runIntegrationGate(config.projectRef, adminUrl, runtimeUrl);
  }, {
    detail: {
      summary: 'Run route/domain integration gate',
      description: 'Validates all SupaOAuth admin routes and Supabase runtime routes are reachable on the target stack. Reports conflicts, missing routes, and domain health.',
      tags: ['Route Gate'],
    },
  })

  .get('/routes', async () => {
    const config = getConfig();
    const adminUrl = `http://${config.host}:${config.port}`;
    const runtimeUrl = config.oauthRuntimeUrl;

    const result = await runIntegrationGate(config.projectRef, adminUrl, runtimeUrl);
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
