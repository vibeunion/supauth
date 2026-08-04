# Application Authorization Kit

## Boundary

SupAuth has two deliberately separate authorization products:

| Layer | Source of truth | Purpose |
| --- | --- | --- |
| SupaCloud-authoritative RBAC | SupaCloud Management API, projected by SupAuth | SupAuth's platform control plane and compatibility surface |
| Application-local authorization kit | Each application's PostgreSQL schema and resolver | Business data-plane authorization for FA and other independent systems |

The npm packages do not move business memberships, assignments, roles, or audit ownership into SupAuth or SupaCloud. SupaCloud/GoTrue is the standard identity boundary; SupAuth is an optional management and OAuth/UX integration layer. The application resolves authorization from its own current data after validating issuer, subject, principal kind, application, and domain.

## Packages

- `@supauth/authorization-core` defines canonical `resource:action` permissions, request/snapshot contracts, 403 versus 503 errors, and one-resolution-per-request in-memory decisions.
- `@supauth/authorization-postgres` generates review-only PostgreSQL/Supabase SQL for an application-owned permission catalog, role-permission mapping, adapter views, hardened scope helpers, and RLS policies.
- `@supauth/authorization-conformance` provides pure CI checks for negative authorization cases, SQL safety, and authenticated execution plans.

The packages are published independently on npm. Install only the layers the application uses:

```sh
# Runtime dependency for API/resolver decisions
npm install @supauth/authorization-core

# Build/migration and CI dependencies for PostgreSQL/RLS adopters
npm install --save-dev @supauth/authorization-postgres @supauth/authorization-conformance
```

Native SupaCloud applications do not install SupAuth to use these packages. `authorization-postgres` is normally a development or migration dependency; generated SQL runs in the application's PostgreSQL database, not in a package-provided service.

V1 intentionally has no wildcard, explicit deny, role inheritance, ABAC, remote PDP, database connection, automatic migration, or cross-application role store.

## Revocation And JWT Consistency

Identity claims come from the verified JWT. Business permission claims in a JWT are only an eventually consistent UI/cache hint and must not be the current authorization fact. API resolvers read current local membership and assignment state once per request. PostgreSQL helpers read the application's active adapter views once per statement. A revocation therefore denies immediately without waiting for access-token refresh.

`policyVersion` and `assignmentVersion` are monotonic cache keys. Cache entries must also include principal kind, issuer, subject, application ID, domain type, and domain ID. A resolver outage, invalid response, malformed permission list, future-dated response, or stale snapshot is 503; it must never be converted to an ordinary 403. Missing, inactive, revoked, cross-domain, cross-application, or unknown permission state is 403. Each resolver sets and enforces its risk-appropriate maximum TTL; high-risk commands resolve current state without a cross-request cache.

## PostgreSQL And RLS Invariants

- The application supplies `active_memberships` and `active_role_assignments` adapter views over its own tables. UUID or numeric keys are normalized to the documented `TEXT` adapter contract.
- Duplicate active memberships for the same principal/application/domain fail closed.
- Generated helpers are `STABLE SECURITY DEFINER SET search_path=''`; the schema revokes `PUBLIC`, grants `USAGE` to `authenticated`, and grants helper execution only to `authenticated` without table access.
- RLS sends permission, domain type, and application constants to `authorization_allowed_scope_ids`; a row ID is never a helper argument.
- The RLS application constant is always the membership boundary. A native SupaCloud/GoTrue JWT may omit application claims; if signed `client_id` or `app_metadata.authorization_context.application_id` exists, it must exactly match the constant. `client_id` has presence-based precedence, so empty or JSON `null` values fail closed instead of falling back.
- Authorization reads only signed JWT `iss`, `sub`, root `client_id`, and `app_metadata.authorization_context`. It never trusts `user_metadata` or a JWT header.
- The target domain column remains UUID or text without a cast, and an uncorrelated `IN (SELECT ...)` allows a hashed scope subplan.
- Source tables need indexes for active principal/application/domain membership, active assignment by membership, role permissions, and each protected table's domain column.
- Structural SQL checks strip comments and literals but are not a parser or authorization proof. Releases require real negative database observations. Large tables (250,000 or more rows) and principals with more than 1,000 scopes also require authenticated `EXPLAIN (ANALYZE, BUFFERS)` with the helper plan node at `loops=1`.

The PostgreSQL preset depends on Supabase/PostgREST `auth.jwt()` and the `anon` / `authenticated` roles. A bare PostgreSQL deployment needs a separately reviewed identity adapter and is not represented by this preset.

Native SupaCloud applications do not need SupAuth or a runtime package that adds JWT claims. They may install `@supauth/authorization-postgres` only as a development/migration tool to generate the standard helper and RLS policies. SupAuth/OAuth applications use the same SQL and gain the extra token application consistency check automatically.

## Existing SupAuth Compatibility Compiler

The existing compiler still targets the SupaCloud-authoritative schema-v2 JWT projection. Organization policies now build uncorrelated declared and allowed organization sets from `current_permission_claims()` instead of calling `has_org_permission(row.organization_id, permission)` for every row. An explicit organization projection overrides root permissions; an organization without an explicit projection preserves V11 root-permission inheritance. Hosted migration v13 grants authenticated callers direct execution of that function, revokes `PUBLIC` and `anon`, and fixes its `SECURITY DEFINER` search path to empty. It reads only the caller's own signed JWT projection, so the grant exposes no server-side RBAC tables or other users' state.

## Adoption

FA adoption is a separate application PR: create its adapter views over FA-owned membership/assignment tables, install a dedicated FA authorization schema through a new immutable migration, integrate the resolver, run conformance, and capture authenticated plans. This package release does not modify FA or connect it to unrelated systems.

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
