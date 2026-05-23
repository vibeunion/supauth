#!/usr/bin/env bun
/**
 * Kong route verification script (P2-2)
 * Validates custom domain, OIDC discovery, JWKS, auth runtime, and Management API routes.
 * Usage: bun run scripts/kong-verify.ts [--host <kong-ip>] [--domain <domain>]
 */

const args = process.argv.slice(2);
let kongHost = 'http://localhost:8000';
let domain = 'localhost';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--host' && args[i + 1]) kongHost = args[++i];
  if (args[i] === '--domain' && args[i + 1]) domain = args[++i];
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

const results: CheckResult[] = [];

async function check(name: string, url: string, opts: { expectStatus?: number; expectJson?: boolean; hostHeader?: string } = {}): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    if (opts.hostHeader) headers['Host'] = opts.hostHeader;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    const ok = opts.expectStatus ? res.status === opts.expectStatus : res.ok;
    let detail = '';
    if (opts.expectJson && ok) {
      try {
        const json = await res.json();
        detail = json.issuer ? ` issuer=${json.issuer}` : '';
      } catch {}
    }
    results.push({
      name,
      status: ok ? 'pass' : 'fail',
      message: `${res.status} ${res.statusText}${detail}`,
    });
  } catch (e) {
    results.push({ name, status: 'fail', message: (e as Error).message });
  }
}

async function main() {
  console.log(`Kong verification target: ${kongHost} (Host: ${domain})\n`);

  // 1. Admin Console
  await check('Admin Console /admin', `${kongHost}/admin`, { expectStatus: 200 });

  // 2. Management API health
  await check('Management API health', `${kongHost}/api/v1/health`, { expectStatus: 200 });

  // 3. OIDC Discovery
  await check('OIDC Discovery', `${kongHost}/auth/v1/.well-known/openid-configuration`, {
    expectStatus: 200,
    expectJson: true,
    hostHeader: domain,
  });

  // 4. JWKS
  await check('JWKS endpoint', `${kongHost}/auth/v1/.well-known/jwks.json`, {
    expectStatus: 200,
    hostHeader: domain,
  });

  // 5. Auth runtime token endpoint
  await check('Auth token endpoint exists', `${kongHost}/auth/v1/token`, {
    expectStatus: 400, // 400 without body is expected (method or missing params)
    hostHeader: domain,
  });

  // 6. Management API apps
  await check('Management API /api/v1/applications', `${kongHost}/api/v1/applications`, {
    expectStatus: 401, // 401 expected without token
  });

  // 7. Host-based routing check
  await check('Host routing (custom domain)', `${kongHost}/auth/v1/health`, {
    hostHeader: domain,
  });

  // 8. Storage route not occupied by SupaOAuth
  await check('Storage route free', `${kongHost}/storage/v1/bucket`, {
    expectStatus: [200, 401].includes, // Either accessible or auth required, both fine
  });

  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;

  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '⚠';
    console.log(`  ${icon} ${r.name}: ${r.message}`);
  }

  console.log(`\n${passed} passed, ${failed} failed, ${warned} warnings`);

  if (failed > 0) process.exit(1);
}

main();
