# `@supauth/authorization-postgres`

This package generates reviewable SQL strings. It never connects to PostgreSQL and never applies migrations automatically. This preset targets Supabase/PostgREST PostgreSQL with `auth.jwt()`, plus the standard `anon` and `authenticated` roles; it is not a generic bare-PostgreSQL identity layer.

Each application chooses and owns its authorization schema. Before applying the generated installation SQL, the application must create these adapter views in that schema:

- `active_memberships(membership_key TEXT, principal_kind TEXT, principal_issuer TEXT, principal_subject TEXT, application_id TEXT, domain_type TEXT, domain_id TEXT)`
- `active_role_assignments(membership_key TEXT, role_key TEXT)`

The adapter views are the normalization boundary: cast UUID or numeric keys to the exact `TEXT` columns above. They must expose only current, active rows from application-owned membership and assignment tables, with at most one active membership for a principal/application/domain tuple. The helper counts candidates before role resolution and denies a domain when duplicate active memberships exist. The kit creates only `permission_catalog`, `role_permissions`, and a hardened `authorization_allowed_scope_ids` function; it does not copy or become the source of truth for memberships, roles, or assignments.

The helper uses signed JWT identity (`iss`, `sub`) and a trusted application identity from OAuth `client_id` or `app_metadata.authorization_context`. Service principals must place their distinct kind and subject under that signed `app_metadata` object. Never derive authorization from `user_metadata`. Supabase `service_role` bypasses RLS by default; service principals that must be policy-isolated need a non-bypass signed JWT and must not reuse the `service_role` credential.

Generated RLS uses an uncorrelated `IN (SELECT ...)` scope subplan that PostgreSQL can hash once. `domainIdType` keeps the target UUID or text column uncast so its index remains usable. The row's domain ID is never passed into a permission helper. Unknown permissions and missing identity/application context return an empty scope set. Applications that can grant more than 1,000 scopes to one principal must capture an authenticated `EXPLAIN (ANALYZE, BUFFERS)` for representative queries before release.

Source tables need partial or equivalent indexes for active membership lookup by principal/application/domain, active assignment lookup by `membership_key`, role-permission lookup by `(role_key, permission_name)`, and the target table's domain column. Because adapters vary by application, the generator cannot safely invent those source-table index definitions.

Apply SQL through an immutable application migration after reviewing it. Revocation is immediate because the helper reads active adapter views on every statement; JWT permissions are deliberately not used as the current authorization fact.
