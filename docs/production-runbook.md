# Production Runbook

This runbook covers release, rollback, restore, and incident triage for SupaOAuth and the underlying Supabase-compatible runtime.

## Release Gate

1. Run local gate: `bun run release:gate`.
2. For live cutover, set `RUN_LIVE_RELEASE_GATE=1`, `SUPAUTH_PUBLIC_URL`, and `SUPAUTH_INSTALLED_RUNTIME_URL`; this runs the installed SupaCloud Function/Pages verifier. `SUPAUTH_INSTALLED_BASE_URL` remains supported for existing SupaCloud installs.
3. Optional: set `RUN_SUPABASE_RUNTIME_COMPAT=1` or `RUN_SUPABASE_OAUTH21_COMPAT=1` with their fixture-specific env vars to run the broader Supabase runtime black-box fixtures.
4. Confirm the generated `artifacts/<release>/release-manifest.json` contains commit, OpenAPI hash, SupaCloud app manifest hash, installed app verification path, and live gate status.
5. Deploy the artifact through SupaCloud using `artifacts/<release>/supacloud-app-manifest.json`.
6. Switch traffic only after `scripts/verify-supacloud-installed-app.ts` passes against the installed Function/Pages routes and preserved `/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*`, and `/functions/v1/*` runtime routes.

## Rollback

1. Ask SupaCloud to roll the SupAuth Function bundle and Admin Pages artifact back to the previous manifest version.
2. Verify SupaCloud route bindings still send `/api/*`, `/v1/public/*`, hosted pages, and `/oauth/*` to the SupAuth Function.
3. Verify `https://auth.example.com/api/v1/health` and the generated manifest still declare `http_runtime=supacloud-functions-only`.
4. Do not modify SupaCloud managed runtime routes during rollback unless the manifest changed preserved runtime routing.
5. If provisioning records drifted, run `POST /v1/provisioning/:projectRef/rollback` to reset reconcile state.

## Backup And Restore

1. Backup metadata: `DATABASE_URL=... BACKUP_DIR=backups/<id> bun run backup:drill`.
2. Store the SQL dump and manifest with project config, SupaCloud route/domain inventory, OAuth client secret inventory, webhook secret inventory, and storage object inventory.
3. Restore to a new target: `RESTORE_DATABASE_URL=... BACKUP_DIR=backups/<id> bun run scripts/backup-restore-drill.ts restore`.
4. Reconcile the new project using `POST /v1/provisioning/:projectRef/reconcile`.
5. Run P0-16 live fixture and admin smoke test before accepting the restore.

## Incident Triage

- Auth timeouts: check SupaCloud runtime health, GoTrue health, Postgres active connections, memory, and swap.
- `supabase-js` session failures: run `tests/integration/supabase-compat/supabase-js.test.ts` with live env and inspect `/auth/v1/token`, `/auth/v1/user`, JWKS, and issuer alignment.
- OAuth consent issues: inspect `supaoauth.user_consents`, application bindings, and audit events `consent.grant` / `consent.revoke`.
- RBAC/RLS issues: verify `supaoauth.authorize(...)` and `supaoauth.has_org_permission(...)` grants, then run the RLS migration assistant.
- Storage asset failures: verify `branding` is public, `avatars` is private, and signed URLs are generated on demand.

## Recovery Objectives

- Staging RPO: 24 hours.
- Staging RTO: 2 hours.
- Production target RPO: 1 hour after external backup automation is connected.
- Production target RTO: 30 minutes after release and restore automation is connected.
