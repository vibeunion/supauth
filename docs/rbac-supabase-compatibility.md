# RBAC Supabase Compatibility

## Decision

SupaOAuth uses SupaCloud-owned product RBAC plus a Supabase-compatible projection layer. See `docs/enterprise-iam-supabase-boundary.md` for the broader enterprise IAM boundary.

This document describes the SupaCloud-authoritative control-plane compatibility layer. Independent business systems use the application-local data-plane kit in `docs/application-authorization-kit.md`; their memberships and assignments do not become SupaCloud RBAC records.

The application-local kit has two compatible identity modes:

| Mode | Principal identity | Application boundary | Requires SupAuth |
| --- | --- | --- | --- |
| Native SupaCloud/GoTrue | Signed JWT `iss` + `sub` | Static application ID embedded in the reviewed RLS policy | No |
| SupAuth/OAuth | Signed JWT `iss` + `sub` | The same static policy ID plus exact signed `client_id` / authorization-context consistency | Optional |

Both modes resolve current membership, role assignment, and audit facts from the business application's own database. They do not copy those facts into SupaCloud control-plane RBAC, and ordinary SupaCloud users do not need an additional runtime service or JWT-mutating package.

This is the default RBAC architecture for `runtime_mode=gotrue`:

```text
SupaCloud Management API
  roles / permissions / organizations / applications / scopes

        -> project into Supabase

GoTrue app_metadata.supaoauth (schema-v2 namespace root)
  schema_version = 2
  projects[projectRef]
    roles / permissions / organizations

supaoauth schema
  authorize(permission_name, organization_id)
  has_permission(permission_name, organization_id)
  has_org_permission(organization_id, permission_name)

        -> consumed by RLS

Supabase runtime
  auth.uid()
  auth.jwt()
  role = authenticated
```

## Why This Is the Default

- It preserves Supabase semantics for `auth.users`, `auth.uid()`, `auth.jwt()`, and the JWT `role` claim.
- It lets existing Supabase projects migrate RLS policies gradually.
- It avoids putting large, unbounded permission arrays into JWTs.
- Permission revocation is driven by SupaCloud RBAC state and projected into GoTrue metadata.
- Shared-authority users keep one isolated projection per SupaCloud project.
- It keeps SupaOAuth's Logto-like RBAC surface independent from Supabase runtime internals.

## Non-Negotiable Rules

- Do not write business roles such as `admin`, `owner`, or `editor` into the top-level JWT `role` claim.
- Do not replace `auth.users` as the primary user identity source in `runtime_mode=gotrue`.
- Do not expose service-role or SupaCloud master credentials to browser code.
- Do not require existing projects to rewrite all RLS policies in one migration.
- Do not store full, unbounded permission sets in JWTs by default. Use role/permission versions for API caches, and keep any RLS `permissions` projection bounded.
- Do not read or dual-write the legacy root-level RBAC fields. A legacy schema-v1 token, missing project entry, truncated permission list, or unavailable projection must deny enterprise authorization.

## Canonical Data Locations

| Data | Location | Notes |
| --- | --- | --- |
| Primary user identity | `auth.users.id` | GoTrue/Supabase owns this. |
| Product roles | SupaCloud Management API `/rbac/roles` | SupaCloud owns this. |
| Product permissions | SupaCloud Management API `/rbac/roles/:id/permissions` | SupaCloud owns this. |
| Role assignments | SupaCloud Management API RBAC assignment APIs | User, organization, or application scoped. |
| Supabase projection | `app_metadata.supaoauth.projects[projectRef]` | Synced from SupaCloud RBAC; used by RLS helpers and UI hints. |
| RLS authorization | `supaoauth.authorize(...)` / `supaoauth.has_permission(...)` | Reads only the current database's project entry; no local RBAC source tables. |

## JWT Strategy

In `runtime_mode=gotrue`, JWTs keep the standard Supabase claims:

- `sub`
- `role`
- `aud`
- `iss`
- `exp`
- `app_metadata`
- `user_metadata`

SupaOAuth may write a small schema-v2 namespace whose authorization data is isolated under `projects[projectRef]`:

```json
{
  "app_metadata": {
    "provider": "email",
    "providers": ["email"],
    "supaoauth": {
      "schema_version": 2,
      "projects": {
        "project-ref": {
          "rbac_version": 1700000000000,
          "permissions_version": 1700000000000,
          "roles": ["admin"],
          "roles_count": 1,
          "permissions": ["project.read"],
          "organization_ids": ["00000000-0000-0000-0000-000000000000"],
          "current_org_id": "00000000-0000-0000-0000-000000000000",
          "current_org_role": "owner"
        }
      }
    }
  }
}
```

The `supaoauth` root allows only `schema_version`, `projects`, and valid `hook` metadata. GoTrue-owned `provider` / `providers` and unrelated `app_metadata` keys are preserved. Each project object is projected from SupaCloud RBAC. Role and permission arrays are bounded summaries, not the full enterprise authorization graph. RLS should call database helper functions so policy SQL stays stable while SupaCloud remains the management source of truth. For broad enterprise APIs, prefer resolving roles and permissions by `rbac_version` / `permissions_version` through SupaCloud/SupaOAuth services instead of relying on a large token payload.

## RLS Migration Patterns

### Existing Owner Policy

```sql
CREATE POLICY "owner can read"
ON public.projects
FOR SELECT
TO authenticated
USING (owner_id = (SELECT auth.uid()));
```

### Wrapper Policy During Migration

```sql
CREATE POLICY "owner or rbac can read"
ON public.projects
FOR SELECT
TO authenticated
USING (
  owner_id = (SELECT auth.uid())
  OR (SELECT supaoauth.authorize('project.read'))
);
```

### Organization-Scoped Policy

The compiler emits two uncorrelated UUID sets: all explicitly projected organizations and the subset that grants the requested permission. The policy allows the explicit granted set, then applies the V11 root permission only to organization IDs absent from the declared set. This preserves root inheritance without letting a root grant override an explicit organization projection that omits or truncates the permission.

Do not call `has_org_permission(org_id, permission)` as the default for a large table: passing the row ID to a permission function can execute authorization work per row. The generated sets appear as hashed subplans or equivalent one-time plan nodes in authenticated `EXPLAIN (ANALYZE, BUFFERS)`.

## Helper Functions

The migration creates:

```sql
supaoauth.current_project_ref()
supaoauth.current_project_claims()
supaoauth.current_permission_claims(target_organization_id uuid default null)
supaoauth.authorize(permission_name text, target_organization_id uuid default null)
supaoauth.has_permission(permission_name text, target_organization_id uuid default null)
supaoauth.has_org_permission(organization_id uuid, permission_name text)
```

The functions are:

- `STABLE`
- `SECURITY DEFINER`
- executable by `authenticated`
- backed by `current_project_claims()`, which derives `projectRef` from the current `supa_<projectRef>` database
- fail-closed to `{}` when `schema_version != 2`, the project entry is missing, or the database is not a SupaCloud project database

Authenticated users should execute the helpers but should not receive direct table privileges on SupaOAuth overlay tables.
Hosted migration v13 grants direct execution of `current_permission_claims(UUID)` so the compiler can build uncorrelated scope sets. It explicitly revokes `PUBLIC` and `anon`, preserves `SECURITY DEFINER`, and sets an empty search path. The function reads only the caller's signed JWT projection and does not query or expose SupaCloud RBAC tables.

## Migration Levels

1. **Inspect**
   Connect SupaOAuth to an existing Supabase project and inspect users, claims, runtime routes, and existing RLS.

2. **Shadow**
   Create the `supaoauth` schema helpers and sync the SupaCloud RBAC projection into `app_metadata.supaoauth.projects[projectRef]` without changing existing RLS.

3. **Wrapper**
   Add InitPlan-wrapped `supaoauth.has_permission(...)` / `supaoauth.authorize(...)` checks or the compiler's organization scope-set policy to selected tables.

4. **Managed**
   Let SupaOAuth generate and apply RBAC-aware policy migrations for selected tables.

There is no fifth “external issuer” level. SupaOAuth accepts only
`runtime_mode=gotrue`; independent discovery/JWKS and alternate token signing
are outside the Supabase-compatible RBAC migration path.

## Enforced Contract

- Canonical enterprise metadata namespace is `app_metadata.supaoauth.projects[projectRef]`; its root is a versioned project map, not an authorization projection.
- Supabase-compatible RLS helper functions are installed through the ordered,
  idempotent hosted migration chain.
- JWT top-level `role` semantics remain unchanged.
- The compatibility inspector verifies helper existence and grants without
  treating a missing helper signature as a database connectivity failure.
- Management APIs validate assignment target existence and user/application
  XOR semantics; UI gating never substitutes for service-side authorization.
