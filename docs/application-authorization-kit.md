# Application Authorization Kit

## Boundary

SupAuth has two deliberately separate authorization products:

| Layer | Source of truth | Purpose |
| --- | --- | --- |
| SupaCloud-authoritative RBAC | SupaCloud Management API, projected by SupAuth | SupAuth's platform control plane and compatibility surface |
| Application-local authorization kit | Each application's PostgreSQL schema and resolver | Business data-plane authorization for FA and other independent systems |

The npm packages do not move business memberships, assignments, roles, or audit ownership into SupAuth or SupaCloud. SupaCloud/GoTrue is the standard identity boundary; SupAuth is an optional management and OAuth/UX integration layer. The application resolves authorization from its own current data after validating issuer, subject, principal kind, application, and domain.

## Packages

- `@supauth/authorization-core` defines canonical `resource:action` permissions, verified request context, 403 versus 503 errors, and one current effective-grant resolution per request.
- `@supauth/authorization-postgres` generates review-only PostgreSQL/Supabase SQL that consumes an application-owned effective-grant view and produces hardened scope helpers and RLS policies.
- `@supauth/authorization-conformance` runs the application's negative-scenario harness and checks SQL safety plus parsed authenticated execution plans.

The packages are published independently on npm. Install only the layers the application uses:

```sh
# Runtime dependency for API/resolver decisions
npm install @supauth/authorization-core

# Build/migration and CI dependencies for PostgreSQL/RLS adopters
npm install --save-dev @supauth/authorization-postgres @supauth/authorization-conformance
```

Native SupaCloud applications do not install SupAuth to use these packages. `authorization-postgres` is normally a development or migration dependency; generated SQL runs in the application's PostgreSQL database, not in a package-provided service.

The public contract intentionally has no wildcard, explicit deny, role inheritance, ABAC, remote PDP, database connection, automatic migration, or cross-application role store. Applications may use those policy features internally, but they must resolve them to exact effective allow grants before crossing the adapter boundary.

## Revocation And JWT Consistency

Identity claims come from the verified JWT. Business permission claims in a JWT are only a UI hint and must not be the current authorization fact. API resolvers read current local policy once per request and return only exact effective allow grants. The core package has no cross-request cache or stale-snapshot contract. A resolver outage or malformed grant list is 503; it must never be converted to an ordinary 403. Missing, inactive, revoked, ambiguous, cross-domain, cross-application, denied, or unknown permission state produces an empty grant set and 403.

PostgreSQL helpers read the application's ordinary effective-grant view once per statement. Under normal READ COMMITTED operation, revocation must deny on the next request or statement without waiting for token refresh. Applications using a stronger transaction isolation level must account for that transaction's visibility rules.

## PostgreSQL And RLS Invariants

- One authorization schema belongs to one fixed application ID.
- The application supplies an ordinary `effective_permission_grants(principal_kind, principal_issuer, principal_subject, application_id, domain_type, domain_id, permission_name)` view. Every column is `TEXT`; every row is a current exact allow grant.
- `generateAuthorizationProjectionPreflightSql` returns one `rule`/`message` row per projection contract violation and zero rows on success. Clients execute it separately and require zero rows before submitting installation SQL; it is never appended to a migration whose query results are ignored.
- The view resolves profile/account state, membership activity and ambiguity, roles, direct grants, inheritance, wildcard expansion, and explicit-deny precedence. Missing, inactive, revoked, denied, or ambiguous facts do not project rows.
- The package creates no permission catalog, role mapping, membership, or assignment table. The projection must not be directly readable by `PUBLIC`, `anon`, or `authenticated`.
- Generated helpers are `STABLE SECURITY DEFINER SET search_path=''`; the schema revokes `PUBLIC`, grants `USAGE` to `authenticated`, and grants helper execution only to `authenticated` without table access.
- RLS sends permission and domain-type constants to `authorization_allowed_scope_ids`; the helper owns the installed application constant, and a row ID is never an argument.
- The application ID is fixed when the authorization schema is installed and is not a helper argument. A native SupaCloud/GoTrue JWT may omit application claims; if signed `client_id` or `app_metadata.authorization_context.application_id` exists, it must exactly match the installed value. `client_id` has presence-based precedence, so empty or JSON `null` values fail closed instead of falling back.
- Authorization reads only signed JWT `iss`, `sub`, root `client_id`, and `app_metadata.authorization_context`. It never trusts `user_metadata` or a JWT header.
- User principals always use root `sub`. Service principals require signed `kind: "service"` and a non-blank signed subject; they never fall back to root `sub`.
- The target domain column remains UUID or text without a cast, and an uncorrelated `IN (SELECT ...)` allows a hashed scope subplan.
- Source tables need indexes that support the application's effective-grant projection plus each protected table's domain column.
- Projection preflight, installation, RLS, and legacy cleanup are separate static SQL artifacts without top-level procedural `DO` blocks. Structural SQL checks accept only the generator's canonical shape and are not a general parser or authorization proof. Releases require an observed empty preflight result plus real negative database observations. Large tables (250,000 or more rows) and principals with more than 1,000 scopes also require authenticated `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` where each helper has `Actual Loops = 1` inside the hashed subplan referenced by its ancestor filter.

The PostgreSQL preset depends on Supabase/PostgREST `auth.jwt()` and the `anon` / `authenticated` roles. A bare PostgreSQL deployment needs a separately reviewed identity adapter and is not represented by this preset.

Native SupaCloud applications do not need SupAuth or a runtime package that adds JWT claims. They may install `@supauth/authorization-postgres` only as a development/migration tool to generate the standard helper and RLS policies. SupAuth/OAuth applications use the same SQL and gain the extra token application consistency check automatically.

## Adoption

Application adoption is a separate application PR: create the authorization schema and effective-grant view over application-owned facts in one immutable migration; execute the read-only projection preflight separately and require zero rows; then install the fixed-application helper, replace generated policies, and place any legacy cleanup last in a second immutable migration. Integrate the current-state resolver, run conformance, and capture authenticated plans. The conformance revocation scenario must observe allow, perform a real fixture revocation, then observe denial on the next request. The packages never modify or connect to application databases by themselves.

## npm Distribution And Release Boundary

The three package names are already bootstrapped and publicly installable. Consumers must not run repository publish commands; install a tagged npm version through the commands above.

Release Please versions and tags the packages independently. `.github/workflows/publish-release-assets.yml` dispatches `.github/workflows/release-please.yml` for the matching npm tag; that workflow builds every SDK dependency, runs package dry-runs, checks bootstrap state, and publishes only the tagged target when its version is absent. A newly named package still needs a one-time maintainer bootstrap before Trusted Publisher can manage later versions. A missing package must not block publication of unrelated packages.

Treat publishing evidence precisely:

- a merged release PR proves only that source versions and changelogs reached `main`;
- a GitHub tag or Release does not prove npm publication;
- an idempotent workflow that skips an existing version does not prove that version was published with OIDC provenance;
- release acceptance requires npm registry read-back, a clean install/import smoke, and provenance/attestation read-back when provenance is claimed.

Publishing these packages does not apply SQL, migrate an application, install SupAuth, or deploy a SupaCloud project.

## References

The kit borrows domain-scoped RBAC semantics and conformance ideas; it does not copy Casbin or Logto storage engines, policy languages, role inheritance, watchers, or remote authorization services.

- [Casbin RBAC with domains](https://casbin.org/docs/rbac-with-domains)
- [Casbin performance optimization](https://casbin.org/docs/performance)
- [Casbin watchers](https://casbin.org/docs/watchers)
- [Logto role-based access control](https://docs.logto.io/authorization/role-based-access-control)
- [Logto organization permissions](https://docs.logto.io/authorization/organization-permissions)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
