#!/usr/bin/env bun
/**
 * Runtime capacity smoke baseline (P0-23).
 *
 * Measures latency and error rate for Auth, REST, Storage, and Management API
 * endpoints. This is a lightweight gate; use k6/vegeta for full stress runs.
 */

export {};

const runtimeUrl = (process.env.OAUTH_RUNTIME_URL || 'http://localhost:9999').replace(/\/+$/, '');
const managementUrl = (process.env.MANAGEMENT_URL || 'http://localhost:4000').replace(/\/+$/, '');
const concurrency = parseInt(process.env.CAPACITY_CONCURRENCY || '10', 10);
const iterations = parseInt(process.env.CAPACITY_ITERATIONS || '50', 10);

const targets = [
  { name: 'gotrue_health', url: `${runtimeUrl}/auth/v1/health` },
  { name: 'oidc_discovery', url: `${runtimeUrl}/auth/v1/.well-known/openid-configuration` },
  { name: 'postgrest_root', url: `${runtimeUrl}/rest/v1/` },
  { name: 'storage_bucket', url: `${runtimeUrl}/storage/v1/bucket` },
  { name: 'management_health', url: `${managementUrl}/v1/health` },
];

interface Sample {
  name: string;
  ok: boolean;
  ms: number;
  status: number;
}

async function sample(target: { name: string; url: string }): Promise<Sample> {
  const started = performance.now();
  try {
    const res = await fetch(target.url, { signal: AbortSignal.timeout(10_000) });
    return {
      name: target.name,
      ok: res.status < 500,
      ms: performance.now() - started,
      status: res.status,
    };
  } catch {
    return { name: target.name, ok: false, ms: performance.now() - started, status: 0 };
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx] || 0);
}

const samples: Sample[] = [];

for (const target of targets) {
  const queue = Array.from({ length: iterations }, () => target);
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.pop();
      if (!item) break;
      samples.push(await sample(item));
    }
  });
  await Promise.all(workers);
}

for (const target of targets) {
  const rows = samples.filter((item) => item.name === target.name);
  const errors = rows.filter((item) => !item.ok).length;
  const latencies = rows.map((item) => item.ms);
  console.log(JSON.stringify({
    target: target.name,
    count: rows.length,
    errors,
    error_rate: errors / rows.length,
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    p99_ms: percentile(latencies, 99),
  }));
}
