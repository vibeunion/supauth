# RBAC Supabase Compatibility

## Decision

SupaOAuth uses a product RBAC source model plus a Supabase-compatible projection layer.

This is the default RBAC architecture for `runtime_mode=gotrue`:

```text
SupaOAuth product RBAC
  roles / permissions / organizations / applications / scopes

        -> project into Supabase

supaoauth schema
  roles
  permissions
  role_assignments
  authorize(permission_name, organization_id)
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
- It avoids putting large permission arrays into JWTs.
- Permission revocation becomes database-state driven instead of waiting for token refresh.
- It keeps SupaOAuth's Logto-like RBAC model independent from Supabase runtime internals.

## Non-Negotiable Rules

- Do not write business roles such as `admin`, `owner`, or `editor` into the top-level JWT `role` claim.
- Do not replace `auth.users` as the primary user identity source in `runtime_mode=gotrue`.
- Do not expose service-role or SupaCloud master credentials to browser code.
- Do not require existing projects to rewrite all RLS policies in one migration.
- Do not store full permission sets in JWTs by default.

## Canonical Data Locations

| Data | Location | Notes |
| --- | --- | --- |
| Primary user identity | `auth.users.id` | GoTrue/Supabase owns this. |
| Product roles | `supaoauth.roles` | SupaOAuth owns this. |
| Product permissions | `supaoauth.permissions` | SupaOAuth owns this. |
| Role assignments | `supaoauth.role_assignments` | User, organization, or application scoped. |
| Lightweight JWT hint | `app_metadata.supaoauth` | Small, non-authoritative hints only. |
| RLS authorization | `supaoauth.authorize(...)` | Source of truth for database authorization. |

## JWT Strategy

In `runtime_mode=gotrue`, JWTs keep the standard Supabase claims:

- `sub`
- `role`
- `aud`
- `iss`
- `exp`
- `app_metadata`
- `user_metadata`

SupaOAuth may write a small namespaced object:

```json
{
  "app_metadata": {
    "supaoauth": {
      "rbac_version": 1700000000000,
      "roles": ["admin"],
      "current_org_id": "00000000-0000-0000-0000-000000000000",
      "current_org_role": "owner"
    }
  }
}
```

This object is a hint for UI and lightweight checks. RLS should call database helper functions for authoritative authorization.

## RLS Migration Patterns

### Existing Owner Policy

```sql
CREATE POLICY "owner can read"
ON public.projects
FOR SELECT
TO authenticated
USING (owner_id = auth.uid());
```

### Wrapper Policy During Migration

```sql
CREATE POLICY "owner or rbac can read"
ON public.projects
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR supaoauth.authorize('project.read')
);
```

### Organization-Scoped Policy

```sql
CREATE POLICY "org member can update"
ON public.projects
FOR UPDATE
TO authenticated
USING (
  supaoauth.has_org_permission(org_id, 'project.update')
);
```

## Helper Functions

The migration creates:

```sql
supaoauth.authorize(permission_name text, target_organization_id uuid default null)
supaoauth.has_org_permission(organization_id uuid, permission_name text)
```

The functions are:

- `STABLE`
- `SECURITY DEFINER`
- executable by `authenticated`
- backed by `supaoauth.role_assignments` and `supaoauth.permissions`

Authenticated users should execute the helpers but should not receive direct table privileges on SupaOAuth metadata tables.

## Migration Levels

1. **Inspect**
   Connect SupaOAuth to an existing Supabase project and inspect users, claims, runtime routes, and existing RLS.

2. **Shadow**
   Create the `supaoauth` schema and populate roles/permissions/assignments without changing existing RLS.

3. **Wrapper**
   Add `OR supaoauth.authorize(...)` or `supaoauth.has_org_permission(...)` to selected policies.

4. **Managed**
   Let SupaOAuth generate and apply RBAC-aware policy migrations for selected tables.

5. **External OIDC**
   Optional advanced mode. Only use when the project explicitly wants a non-GoTrue issuer with OIDC discovery and asymmetric JWKS.

## Implementation Tasks

- [x] Define canonical app metadata namespace: `app_metadata.supaoauth`.
- [x] Add Supabase-compatible RLS helper functions to migration.
- [x] Keep JWT `role` semantics untouched.
- [ ] Add live integration test that applies a sample RLS policy using `supaoauth.authorize(...)`.
- [ ] Add migration assistant that converts common owner/team policies into wrapper policies.
- [ ] Add Admin Console checks that flag unsafe use of top-level JWT `role` for business RBAC.
- [ ] Add compatibility inspector checks for helper function presence and grants.
