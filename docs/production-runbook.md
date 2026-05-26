# Production Runbook

This runbook covers release, rollback, restore, and incident triage for SupaOAuth and the underlying Supabase-compatible runtime.

## Release Gate

1. Run local gate: `bun run release:gate`.
2. For live cutover, set `RUN_LIVE_RELEASE_GATE=1`, `OAUTH_RUNTIME_URL`, `SUPABASE_ANON_KEY`, and fixture credentials.
3. Confirm the generated `artifacts/<release>/release-manifest.json` contains commit, OpenAPI hash, and live gate status.
4. Deploy the artifact to the new release directory or image tag.
5. Switch traffic only after `/v1/health`, `/auth/v1/health`, OIDC discovery, JWKS, PostgREST, and Storage smoke checks pass.

## Rollback

1. Stop the new SupaOAuth service instance.
2. Repoint the service symlink or deployment tag to the previous release.
3. Restart SupaOAuth and verify `https://auth.example.com/api/v1/health`.
4. Do not modify GoTrue/Kong routes during rollback unless the release changed runtime routing.
5. If provisioning records drifted, run `POST /v1/provisioning/:projectRef/rollback` to reset reconcile state.

## Backup And Restore

1. Backup metadata: `DATABASE_URL=... BACKUP_DIR=backups/<id> bun run backup:drill`.
2. Store the SQL dump and manifest with project config, Kong route/cert inventory, OAuth client secret inventory, webhook secret inventory, and storage object inventory.
3. Restore to a new target: `RESTORE_DATABASE_URL=... BACKUP_DIR=backups/<id> bun run scripts/backup-restore-drill.ts restore`.
4. Reconcile the new project using `POST /v1/provisioning/:projectRef/reconcile`.
5. Run P0-16 live fixture and admin smoke test before accepting the restore.

## Incident Triage

- Auth timeouts: check GoTrue, Kong upstream health, Postgres active connections, memory, and swap.
- `supabase-js` session failures: run `tests/integration/supabase-compat/supabase-js.test.ts` with live env and inspect `/auth/v1/token`, `/auth/v1/user`, JWKS, and issuer alignment.
- OAuth consent issues: inspect `supaoauth.user_consents`, application bindings, and audit events `consent.grant` / `consent.revoke`.
- RBAC/RLS issues: verify `supaoauth.authorize(...)` and `supaoauth.has_org_permission(...)` grants, then run the RLS migration assistant.
- Storage asset failures: verify `branding` is public, `avatars` is private, and signed URLs are generated on demand.

## Recovery Objectives

- Staging RPO: 24 hours.
- Staging RTO: 2 hours.
- Production target RPO: 1 hour after external backup automation is connected.
- Production target RTO: 30 minutes after release and restore automation is connected.
