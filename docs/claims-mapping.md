# Claims Mapping — SupaOAuth to Supabase-compatible JWT

This document defines how SupaOAuth roles, OAuth scopes, organizations, and permissions map to JWT metadata, Management API lookups, and Supabase RLS policies.

## Recommendation

For `runtime_mode=gotrue`, use SupaCloud RBAC as the source model and project it into the current project's entry at `app_metadata.supaoauth.projects[projectRef]`. RLS should call helper functions such as `supaoauth.has_permission(...)` or `supaoauth.authorize(...)` instead of depending on raw JWT paths or local RBAC source tables.

The top-level JWT `role` claim must remain a Supabase runtime role such as `anon`, `authenticated`, or `service_role`. SupaOAuth business roles are owned by SupaCloud RBAC and projected under the project entry. The `supaoauth` root contains only `schema_version`, `projects`, and valid `hook` metadata.

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

OAuth 2.1 access tokens additionally carry `client_id` and `scope`. Treat them as part of the OAuth token shape, including tokens returned from the refresh-token grant, but do not require them on every password/session access token. The standard `sub` claim remains the user identifier; stock GoTrue v2.192+ does not add a separate required `user_id` claim. `client_id` lets RLS and application APIs distinguish the OAuth client without changing Supabase's runtime `role`.

OAuth `scope` is protocol metadata, not an enterprise permission claim. Preserve the granted standard scope string (`openid`, `email`, `profile`, `phone`) in OAuth access tokens so UserInfo and ID-token behavior stays Supabase-compatible. The token endpoint response may omit `scope` when it is unchanged from the request, so compatibility checks validate the JWT claim and accept an optional matching response field. Keep database authorization in RLS using `auth.jwt() ->> 'client_id'`, `auth.uid()`, and SupaOAuth permission-version lookups.

GoTrue tokens commonly include additional claims such as `amr`, `app_metadata`, and `user_metadata`. SupaOAuth preserves those claims when present, and current enterprise authorization metadata lives in the schema-v2 `app_metadata.supaoauth.projects[projectRef]` entry instead of top-level JWT claims.

## SupaOAuth Metadata Namespace

In the only supported `runtime_mode=gotrue`, SupaOAuth does not add top-level JWT claims. The metadata container is versioned and project-scoped so several SupaCloud projects can safely share one GoTrue authority:

```json
{
  "app_metadata": {
    "provider": "email",
    "providers": ["email"],
    "supaoauth": {
      "schema_version": 2,
      "projects": {
        "project-ref": {
          "roles": [],
          "permissions": [],
          "scopes": [],
          "organization_ids": [],
          "organizations": {},
          "applications": {},
          "rbac_version": 1,
          "rbac_synced_at": "2026-07-19T00:00:00.000Z"
        }
      },
      "hook": {
        "version": 1,
        "authentication_method": "password",
        "processed_at": "2026-07-19T00:00:00.000Z"
      }
    }
  }
}
```

GoTrue-owned keys such as `app_metadata.provider` and `app_metadata.providers` remain untouched. Legacy root-level RBAC fields are never read or dual-written. A missing project entry, a schema version other than `2`, or `projection_unavailable: true` must fail closed.

The following fields live inside each `projects[projectRef]` entry:

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
| `organizations` | `record` | Organization-scoped bounded permission projections |
| `applications` | `record` | Application and application-organization bounded projections |
| `organization_memberships` | `array` | GoTrue Custom Access Token Hook JIT membership snapshot; separate from the RBAC `organizations` map |
| `projection_unavailable` | `boolean` | Empty fail-closed projection because a size or synchronization boundary was exceeded |

### Why `app_metadata.supaoauth.projects[projectRef]`?

- Avoids collision with GoTrue claims or custom `app_metadata` keys
- Prevents one child project from overwriting another child project's RBAC projection on a shared GoTrue user
- Keeps the top-level `role` claim as a Supabase runtime role
- Lets RLS policies explicitly opt into SupaOAuth helpers while existing `auth.uid()` / `auth.jwt()` policies keep working
- Lets broad enterprise APIs use `rbac_version` / `permissions_version` and resolve full permissions outside the JWT

### When are SupaOAuth claims present?

Legacy SupaOAuth `supaoauth:*` top-level claims are NOT present in the JWT. GoTrue controls token issuance. The current schema-v2 SupaCloud RBAC projection is available through the Management API and `app_metadata.supaoauth.projects[projectRef]`; RLS helpers derive `projectRef` from the current `supa_<projectRef>` database and read only that entry.

## RLS Integration Examples

### Using GoTrue's `app_metadata` (gotrue mode)

Use the installed helper instead of hard-coding a project reference in a policy:

```sql
    -- The helper returns {} for legacy schema-v1, missing-project, or unavailable projections.
CREATE POLICY "tenant_isolation" ON documents
  USING (
    tenant_id = (supaoauth.current_project_claims() ->> 'current_org_id')::uuid
  );
```

`supaoauth.current_project_claims()` is installed by hosted migration V8 and is executable by `authenticated`. Native `auth.uid()` policies remain valid; enterprise permission checks should use the higher-level helpers below.

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

### Claims mapping strategy

| SupaOAuth Concept | GoTrue-only mapping |
| --- | --- |
| Roles | `app_metadata.supaoauth.projects[projectRef].roles` projected from SupaCloud RBAC |
| Organization | `app_metadata.supaoauth.projects[projectRef].current_org_id` projected from SupaCloud organization membership |
| Scopes | Standard OAuth `scope` remains protocol metadata; enterprise scopes use the project entry and Management API |
| Permissions | Bounded `app_metadata.supaoauth.projects[projectRef].permissions` for RLS helpers; full set via Management API |

### Projection ownership and synchronization

SupaCloud is the only RBAC projection writer. It serializes project-config mutations and shared-authority user metadata updates with advisory locks, replaces only `projects[projectRef]`, preserves other project entries and non-SupaOAuth metadata, and verifies the complete `app_metadata` through a GoTrue read-back. SupaOAuth's Custom Access Token Hook may add bounded `organization_memberships*` and valid `hook` metadata; it does not overwrite the RBAC `organizations` map.

This is an intentional non-backward-compatible migration. Tokens containing only the old root-level projection lose enterprise authorization. After deploying schema v2, refresh or revoke existing sessions so GoTrue issues a token with the current project entry.

## Token Size Considerations

- Avoid adding large arrays to JWT claims — tokens are sent with every request
- Keep each `projects[projectRef].roles` array at or below 64 entries
- Keep each `projects[projectRef].permissions` array at or below 256 entries
- Keep the complete project projection within the writer's 16 KiB budget; oversize projections become an empty `projection_unavailable` entry
- If the resolved role count exceeds the projection limit, write `roles_truncated`, `roles_count`, and `rbac_version`; full role display and governance must resolve through the Management API
- If the resolved permission count exceeds the projection limit, write `permissions_truncated`, `permissions_count`, and `permissions_version`; RLS helpers fail closed for truncated projections, and full permission checks must resolve through the Management API or an application-side cache keyed by `permissions_version`
- In gotrue mode, prefer `supaoauth.has_permission(...)` / `supaoauth.authorize(...)` for RLS and use `permissions_version` for API cache invalidation
