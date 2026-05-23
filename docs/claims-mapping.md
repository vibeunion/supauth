# Claims Mapping — SupaOAuth to Supabase-compatible JWT

This document defines how SupaOAuth roles, scopes, organizations, and permissions map to JWT claims, and how they interact with Supabase RLS policies.

## Baseline: GoTrue Claims (runtime_mode=gotrue)

When GoTrue is the token issuer, the JWT contains these claims by default:

| Claim | Type | Description |
| --- | --- | --- |
| `sub` | `string` | User UUID — primary identity in RLS |
| `role` | `string` | `anon` or `authenticated` — used by PostgREST role switching |
| `aud` | `string` | `authenticated` — token audience |
| `iss` | `string` | GoTrue issuer URL |
| `exp` | `number` | Token expiry timestamp |
| `iat` | `number` | Token issued-at timestamp |
| `app_metadata` | `object` | Admin-set metadata — often used in RLS (e.g. `app_metadata.tenant_id`) |
| `user_metadata` | `object` | User-set profile metadata |
| `session_id` | `string` | GoTrue session identifier |
| `aal` | `string` | Authentication assurance level |
| `amr` | `array` | Authentication methods references |

**Rule**: SupaOAuth must never remove or alter these claims. They are required by Supabase RLS, PostgREST, Storage, and Realtime.

## SupaOAuth Namespaced Claims

SupaOAuth adds claims under the `supaoauth` namespace to avoid collisions:

| Claim | Type | Mode | Description |
| --- | --- | --- | --- |
| `supaoauth:roles` | `string[]` | external_oidc | SupaOAuth role names assigned to the user |
| `supaoauth:org_id` | `string` | external_oidc | Current organization context |
| `supaoauth:org_role` | `string` | external_oidc | User's role within the current organization |
| `supaoauth:scopes` | `string[]` | external_oidc | Granted API scopes for the current resource |
| `supaoauth:permissions` | `string[]` | external_oidc | Resolved permission set |

### Why namespaced?

- Avoids collision with GoTrue claims or custom `app_metadata` keys
- Makes it clear which claims are SupaOAuth-managed vs GoTrue-managed
- Allows RLS policies to explicitly opt into SupaOAuth claims

### When are SupaOAuth claims present?

**gotrue mode**: SupaOAuth claims are NOT present in the JWT. GoTrue controls all claims. SupaOAuth metadata (roles, organizations, scopes) is only accessible through the Management API.

**external_oidc mode**: SupaOAuth (or the external IdP) controls token issuance and can inject `supaoauth:*` claims. These claims are available in RLS policies only if the Supabase project is configured to trust the external issuer.

## RLS Integration Examples

### Using GoTrue's `app_metadata` (gotrue mode)

This works today without any SupaOAuth-specific claims:

```sql
-- RLS policy using app_metadata set by SupaOAuth through GoTrue
CREATE POLICY "tenant_isolation" ON documents
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
```

SupaOAuth can set `app_metadata` through the SupaCloud adapter (GoTrue admin API), which is the recommended way to pass organization/tenant context in gotrue mode.

### Using SupaOAuth claims (external_oidc mode)

When running in external_oidc mode, RLS policies can reference namespaced claims:

```sql
-- RLS policy using SupaOAuth organization context
CREATE POLICY "org_isolation" ON documents
  USING (org_id = (auth.jwt() -> 'supaoauth:org_id')::uuid);

-- RLS policy using SupaOAuth roles
CREATE POLICY "admin_only" ON sensitive_data
  USING ((auth.jwt() -> 'supaoauth:roles')::jsonb ? 'admin');
```

### Claims mapping strategy

| SupaOAuth Concept | gotrue mode | external_oidc mode |
| --- | --- | --- |
| Roles | `app_metadata.supaoauth_roles` (set via GoTrue admin API) | `supaoauth:roles` claim |
| Organization | `app_metadata.org_id` (set via GoTrue admin API) | `supaoauth:org_id` claim |
| Scopes | Not in JWT; query Management API | `supaoauth:scopes` claim |
| Permissions | Not in JWT; query Management API | `supaoauth:permissions` claim |

### Syncing SupaOAuth metadata to app_metadata (gotrue mode)

When a user's organization or role changes in SupaOAuth, the BFF should sync these to `app_metadata` through the SupaCloud adapter:

```typescript
// In auth-server, after org/role change:
await adapter.updateUser(userId, {
  app_metadata: {
    supaoauth_roles: userRoles,
    org_id: currentOrgId,
  },
});
```

This keeps existing Supabase RLS policies working without modification.

## Token Size Considerations

- Avoid adding large arrays to JWT claims — tokens are sent with every request
- Keep `supaoauth:permissions` and `supaoauth:scopes` to essential entries only
- For users with many roles/permissions, consider a "resolve on demand" pattern where the Management API returns the full set and the JWT only carries the current context
