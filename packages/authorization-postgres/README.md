# `@supauth/authorization-postgres`

This package generates reviewable SQL strings. It never connects to PostgreSQL and never applies migrations automatically. This preset targets Supabase/PostgREST PostgreSQL with `auth.jwt()`, plus the standard `anon` and `authenticated` roles; it is not a generic bare-PostgreSQL identity layer.

## Installation

```sh
npm install --save-dev @supauth/authorization-postgres
# or
bun add --dev @supauth/authorization-postgres
```

Use it while authoring an immutable migration; the deployed application does not need this package at request time.

Each application chooses and owns its authorization schema. Install that schema for exactly one application by passing its fixed `applicationId` to `generateAuthorizationSchemaSql`. Before applying the generated installation SQL, the application must create this projection view in that schema:

- `effective_permission_grants(principal_kind TEXT, principal_issuer TEXT, principal_subject TEXT, application_id TEXT, domain_type TEXT, domain_id TEXT, permission_name TEXT)`

The projection view is the normalization and ownership boundary. Cast UUID or numeric keys to the exact `TEXT` columns above and expose one row for each current, effective allow grant. The application remains responsible for its permission catalog, role mappings, direct grants, explicit-deny precedence, inheritance, and other policy rules; resolve all of them in the view. The package never creates or owns those facts.

The application must also resolve ambiguous memberships fail-closed before rows enter the projection. If multiple active memberships conflict for one principal/application/domain tuple, the view must omit that tuple entirely. The helper deliberately does not reinterpret or partially validate the application's final decision. Duplicate projected rows are harmless because the helper returns distinct domains, but applications should still keep the projection distinct and indexed at its source. Missing identities, missing grants, and malformed application context yield an empty scope set.

The generated installation SQL creates only the schema when absent and a hardened `authorization_allowed_scope_ids` function. Projection validation is a separate read-only gate: run `generateAuthorizationProjectionPreflightSql`, read its `rule` and `message` rows, and proceed only when it returns zero rows. Its stable rules are `projection_missing`, `projection_kind`, `projection_columns`, `projection_column_types`, and `projection_privileges`. This rejects missing projections, tables or materialized views, an inexact seven-column `TEXT` contract, and direct `anon` or `authenticated` read access.

Run the preflight as a separate query before submitting the installation migration. Do not append it to a migration or discard its result: a migration executor may successfully run a `SELECT` while ignoring returned rows, which is not a contract gate. This command/query separation also keeps installation, RLS, cleanup, and preflight SQL free of top-level procedural `DO` blocks and compatible with SupaCloud's project-scoped SQL policy.

For this breaking upgrade, first apply an immutable application migration that creates the authorization schema and projection. Then execute the preflight and require zero result rows. Only after it passes, submit a second immutable migration that runs `generateAuthorizationSchemaSql`, replaces every generated policy with `generateRlsPoliciesSql`, and finally runs `generateLegacyAuthorizationCleanupSql` when upgrading from the old three-argument helper. Fresh installations omit cleanup. Cleanup uses `DROP FUNCTION IF EXISTS` without `CASCADE`, so any missed old-policy dependency fails the migration closed.

The helper uses signed JWT identity (`iss`, `sub`) and always treats the application ID embedded in the authorization-schema installation as the membership boundary. Callers cannot select or override it. A native SupaCloud/GoTrue token does not need an application claim. If the signed token does contain OAuth `client_id` or `app_metadata.authorization_context.application_id`, that value must exactly match the installed application ID or the helper returns an empty scope set. `client_id` takes precedence whenever its key is present; an empty or JSON `null` value is present-but-invalid and cannot fall back to `app_metadata`.

Applications that require an OAuth client boundary can opt in when generating the installation SQL:

```ts
generateAuthorizationSchemaSql({
  schema: 'application_authorization',
  applicationId: 'your-oauth-client-id',
  requireOAuthApplicationClaim: true,
});
```

In this strict mode, the signed JWT must contain a root `client_id` or `azp` claim. Every one of those claims that is present must be a JSON string and exactly match the installed application ID, so conflicting claims fail closed. A matching `app_metadata.authorization_context.application_id` cannot replace the required root OAuth claim. The option defaults to `false`, preserving the native-token behavior above.

This makes one preset usable in both modes:

- Native SupaCloud/GoTrue users rely on verified `iss` and `sub`, plus the authorization schema's static application ID.
- SupAuth/OAuth users can require strict root `client_id`/`azp` token-to-schema application consistency.

Only claims returned by `auth.jwt()` are read. User principals always bind to the signed root `sub`; an `app_metadata` subject cannot replace a user's identity. Service principals must place both their distinct `kind: "service"` and a non-blank `subject` under signed `app_metadata.authorization_context`; a missing or whitespace-only service subject fails closed instead of falling back to `sub`. `user_metadata` and JWT headers are never authorization inputs. Supabase `service_role` bypasses RLS by default; service principals that must be policy-isolated need a non-bypass signed JWT and must not reuse the `service_role` credential.

Generated RLS uses an uncorrelated `IN (SELECT ...)` scope subplan that PostgreSQL can hash once. `domainIdType` keeps the target UUID or text column uncast so its index remains usable. The row's domain ID is never passed into a permission helper. Unknown permissions, missing identity, and mismatched application context return an empty scope set. Applications that can grant more than 1,000 scopes to one principal must capture an authenticated `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for representative queries before release.

Projection source tables need partial or equivalent indexes for lookup by principal/application/domain, permission resolution, and the target table's domain column. Because policy storage and projection queries vary by application, the generator cannot safely invent those source-table index definitions.

Apply installation, RLS, and applicable cleanup SQL through an immutable application migration after reviewing it and observing an empty preflight result. Revocation is immediate because the helper reads the effective projection on every statement; JWT permissions are deliberately not used as the current authorization fact.

RLS policies declare their clauses explicitly: `select` and `delete` require `usingPermission`, `insert` requires `checkPermission`, and `update` requires both. This allows an update to use different permissions for existing-row visibility and new-row validity. Generated policy SQL drops only its deterministic command policy name immediately before recreating it, so the replacement can stay in the same transaction.

`@supauth/authorization-postgres` is an install-time SQL generator, not a runtime token wrapper. A native SupaCloud application may use it as a development/migration dependency, but ordinary users do not need an extra runtime service or a package that mutates GoTrue JWTs.

The real PostgreSQL/RLS test is opt-in so local unit tests do not silently connect to a database. Run it only against a disposable loopback database whose name ends in `authorization_test`:

```sh
RUN_AUTHORIZATION_POSTGRES_TESTS=1 \
AUTHORIZATION_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/supauth_authorization_test \
bun test packages/authorization-postgres/src/postgres.integration.test.ts
```

See the [Application Authorization Kit](https://github.com/zuohuadong/supauth/blob/main/docs/application-authorization-kit.md) for the complete dual-mode and ownership contract.

## License

MIT
