# Claims Mapping — SupaOAuth to Supabase-compatible JWT

This document defines how SupaOAuth roles, OAuth scopes, organizations, and permissions map to JWT metadata, Management API lookups, and Supabase RLS policies.

## Recommendation

For `runtime_mode=gotrue`, use SupaCloud RBAC as the source model and project it into GoTrue `app_metadata.supaoauth`. RLS should call helper functions such as `supaoauth.has_permission(...)` or `supaoauth.authorize(...)` instead of depending on large JWT permission arrays or local RBAC source tables.

The top-level JWT `role` claim must remain a Supabase runtime role such as `anon`, `authenticated`, or `service_role`. SupaOAuth business roles are owned by SupaCloud RBAC and projected under `app_metadata.supaoauth`.

## Baseline: GoTrue Claims (runtime_mode=gotrue)

When GoTrue is the token issuer, the Supabase Custom Access Token Hook contract requires these claims to be preserved:

| Claim | Type | Description |
| --- | --- | --- |
| `sub` | `string` | User UUID — primary identity in RLS |
| `role` | `string` | `anon`, `authenticated`, or `service_role` — used by PostgREST role switching |
| `aud` | `string` | `authenticated` — token audience |
| `iss` | `string` | GoTrue issuer URL |
| `exp` | `number` | Token expiry timestamp |
| `iat` | `number` | Token issued-at timestamp |
| `session_id` | `string` | GoTrue session identifier |
| `aal` | `string` | Authentication assurance level |
| `email` | `string` | User email claim |
| `phone` | `string` | User phone claim |
| `is_anonymous` | `boolean` | Anonymous-user flow marker |

**Rule**: SupaOAuth must never remove or alter these claims. They are required by Supabase RLS, PostgREST, Storage, and Realtime.

OAuth 2.1 access tokens additionally carry `user_id` and `client_id`. Treat them as part of the OAuth token shape, including tokens returned from the refresh-token grant, but do not require them on every password/session access token. `user_id` should match `sub`, and `client_id` lets RLS and application APIs distinguish the OAuth client without changing Supabase's runtime `role`.

OAuth response `scope` is response metadata, not an enterprise permission claim. Preserve the granted standard scope string (`openid`, `email`, `profile`, `phone`) on token responses so UserInfo and ID-token behavior stays Supabase-compatible, but keep database authorization in RLS using `auth.jwt() ->> 'client_id'`, `auth.uid()`, and SupaOAuth permission-version lookups.

GoTrue tokens commonly include additional claims such as `amr`, `app_metadata`, and `user_metadata`. SupaOAuth preserves those claims when present, and enterprise authorization metadata is namespaced under `app_metadata.supaoauth` instead of top-level JWT claims.

## SupaOAuth Metadata Namespace

In the default `runtime_mode=gotrue`, SupaOAuth does not add top-level JWT claims. Enterprise metadata is projected under `app_metadata.supaoauth`:

| Field | Type | Description |
| --- | --- | --- |
| `roles` | `string[]` | Bounded compact SupaOAuth role names assigned to the user; empty when truncated |
| `rbac_version` | `number` | RBAC projection version for cache invalidation |
| `roles_count` | `number` | Total resolved role count |
| `roles_truncated` | `boolean` | Present when the role set exceeds the projection limit |
| `roles_projection_limit` | `number` | Maximum roles copied into the JWT projection |
| `permissions_version` | `number` | Permission projection version for cache invalidation |
| `permissions_count` | `number` | Total resolved permission count |
| `permissions` | `string[]` | Bounded RLS helper projection only; empty when truncated |
| `permissions_truncated` | `boolean` | Present when the permission set exceeds the projection limit |
| `permissions_projection_limit` | `number` | Maximum permissions copied into the JWT projection |
| `current_org_id` | `string` | Current organization context |
| `current_org_role` | `string` | User's role within the current organization |

### Why `app_metadata.supaoauth`?

- Avoids collision with GoTrue claims or custom `app_metadata` keys
- Keeps the top-level `role` claim as a Supabase runtime role
- Lets RLS policies explicitly opt into SupaOAuth helpers while existing `auth.uid()` / `auth.jwt()` policies keep working
- Lets broad enterprise APIs use `rbac_version` / `permissions_version` and resolve full permissions outside the JWT

### When are SupaOAuth claims present?

**gotrue mode**: SupaOAuth namespaced top-level claims are NOT present in the JWT. GoTrue controls token issuance. SupaCloud RBAC projection is available through the Management API and `app_metadata.supaoauth`; RLS helpers read that projection.

**external_oidc mode**: SupaOAuth (or the external IdP) controls token issuance only in this advanced and opt-in mode, but tokens that are meant to work with Supabase APIs should still preserve the Supabase access-token shape. The default external OIDC recommendation is still `app_metadata.supaoauth` plus Management API lookups for full permissions. Top-level `supaoauth:*` claims are a legacy/advanced escape hatch only when a project documents why app metadata and helper functions are insufficient.

## RLS Integration Examples

### Using GoTrue's `app_metadata` (gotrue mode)

This works today without SupaOAuth-specific top-level claims:

```sql
-- RLS policy using app_metadata set by SupaOAuth through GoTrue
CREATE POLICY "tenant_isolation" ON documents
  USING (tenant_id = (auth.jwt() -> 'app_metadata' -> 'supaoauth' ->> 'current_org_id')::uuid);
```

SupaOAuth can set `app_metadata.supaoauth` through the SupaCloud adapter (GoTrue admin API). This is useful for lightweight UI and tenant-context hints, but authoritative permission checks should use RLS helper functions.

### Using SupaOAuth projection helpers (gotrue mode)

This is the recommended RLS pattern:

```sql
CREATE POLICY "rbac_project_update" ON projects
  FOR UPDATE
  TO authenticated
  USING (
    supaoauth.has_permission('project.update', org_id)
  );
```

### External OIDC mode

When running in external_oidc mode, prefer the same app metadata shape used by gotrue mode:

```sql
CREATE POLICY "external_org_isolation" ON documents
  USING (org_id = (auth.jwt() -> 'app_metadata' -> 'supaoauth' ->> 'current_org_id')::uuid);
```

If a legacy project explicitly enables top-level namespaced claims, RLS policies can reference them after a project-specific review:

```sql
-- RLS policy using SupaOAuth organization context
CREATE POLICY "org_isolation" ON documents
  USING (org_id = (auth.jwt() ->> 'supaoauth:org_id')::uuid);

-- RLS policy using SupaOAuth roles
CREATE POLICY "admin_only" ON sensitive_data
  USING ((auth.jwt() -> 'supaoauth:roles')::jsonb ? 'admin');
```

### Claims mapping strategy

| SupaOAuth Concept | gotrue mode | external_oidc mode |
| --- | --- | --- |
| Roles | `app_metadata.supaoauth.roles` projected from SupaCloud RBAC | `app_metadata.supaoauth.roles` by default; legacy explicit mode may use `supaoauth:roles` |
| Organization | `app_metadata.supaoauth.current_org_id` projected from SupaCloud organization membership | `app_metadata.supaoauth.current_org_id` by default; legacy explicit mode may use `supaoauth:org_id` |
| Scopes | Not in JWT; query Management API | Not in JWT by default; query Management API |
| Permissions | Bounded `app_metadata.supaoauth.permissions` for RLS helpers; full set via Management API | Bounded `app_metadata.supaoauth.permissions` for RLS helpers; full set via Management API |

### Syncing SupaOAuth metadata to app_metadata (gotrue mode)

When a user's organization or role changes in SupaCloud RBAC, the BFF should sync these to `app_metadata` through the SupaCloud adapter:

```typescript
// In auth-server, after org/role change:
await adapter.updateUser(userId, {
  app_metadata: {
    supaoauth: {
      rbac_version,
      permissions_version,
      roles: userRoles,
      current_org_id: currentOrgId,
      current_org_role: currentOrgRole,
    },
  },
});
```

This keeps existing Supabase RLS policies working without modification.

## Token Size Considerations

- Avoid adding large arrays to JWT claims — tokens are sent with every request
- Keep `app_metadata.supaoauth.roles` bounded for role summaries only
- Keep `app_metadata.supaoauth.permissions` bounded for RLS helper compatibility only
- If the resolved role count exceeds the projection limit, write `roles_truncated`, `roles_count`, and `rbac_version`; full role display and governance must resolve through the Management API
- If the resolved permission count exceeds the projection limit, write `permissions_truncated`, `permissions_count`, and `permissions_version`; RLS helpers fail closed for truncated projections, and full permission checks must resolve through the Management API or an application-side cache keyed by `permissions_version`
- In gotrue mode, prefer `supaoauth.has_permission(...)` / `supaoauth.authorize(...)` for RLS and use `permissions_version` for API cache invalidation
