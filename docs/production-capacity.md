# Production Capacity Baseline

This baseline defines the minimum production guardrails for SupaOAuth on top of SupaCloud/Supabase runtime.

## Minimum Runtime Targets

- GoTrue `/auth/v1/health`: p95 <= 300ms, error rate < 1%.
- OIDC discovery and JWKS: p95 <= 500ms, error rate < 1%.
- PostgREST `/rest/v1/`: p95 <= 500ms for authenticated smoke paths.
- Storage `/storage/v1/bucket`: p95 <= 800ms for service smoke checks.
- SupAuth Function Management API `/api/v1/health`: p95 <= 300ms, error rate < 1%.

## Resource Budget

- Keep Postgres, GoTrue, PostgREST, SupaCloud gateway/runtime, SupaCloud Functions, and SupaCloud Pages above non-core observability workloads in CPU and memory priority.
- Enable swap on small hosts; 4 GB swap is the minimum for B-machine style staging hosts.
- Cap optional VictoriaMetrics/Grafana/exporter workloads or move them off the auth runtime host when p95 degrades.
- Watch Postgres connection count, memory RSS, swap used, and SupaCloud gateway/runtime latency during every release gate.

## Baseline Command

```bash
OAUTH_RUNTIME_URL=https://api.example.com \
SUPAUTH_INSTALLED_BASE_URL=https://auth.example.com \
CAPACITY_CONCURRENCY=10 \
CAPACITY_ITERATIONS=50 \
bun run capacity:baseline
```

The script prints JSON summaries with p50/p95/p99 and error rates. Production release is blocked if any required target exceeds the threshold above.

## Evidence To Record

- release id and git commit
- host CPU, memory, and swap summary
- p95/error-rate output from `bun run capacity:baseline`
- SupaCloud Function concurrency/memory limits, Pages artifact version, and managed job status
- Postgres max connections and current active connections
