# @supauth/shared

Shared schemas and public types for SupaOAuth SDK packages.

## Installation

```bash
npm install @supauth/shared
# or
bun add @supauth/shared
```

## Usage

```typescript
import type {
  Application,
  ApiResource,
  Scope,
  Role,
  Permission,
  Organization,
  SignInExperience,
  RuntimeMode,
} from '@supauth/shared';

// Claims mapping utilities
import {
  SUPAOAUTH_CLAIMS_NAMESPACE,
  SUPAOAUTH_APP_METADATA_KEY,
  SUPABASE_REQUIRED_CLAIMS,
  SUPABASE_METADATA_CLAIMS,
  GOTRUE_CLAIMS_STRATEGY,
  type SupaOAuthJWTClaims,
  type SupaOAuthAppMetadata,
  type ClaimsMappingStrategy,
} from '@supauth/shared';
```

## Exports

- **Application types**: `Application`, `ApplicationType`, `CreateApplicationInput`
- **API Resource types**: `ApiResource`, `Scope`, `CreateResourceInput`
- **Connector types**: `Connector`, `ConnectorCategory`
- **Organization types**: `Organization`, `OrganizationMember`
- **Role/Permission types**: `Role`, `Permission`
- **Sign-in Experience types**: `SignInExperience`, `ApplicationSignInExperience`, `EffectiveSignInExperience`, `PublicEffectiveSignInExperience`
- **Audit types**: `AuditLogEntry`
- **Webhook types**: `Webhook`
- **Runtime types**: `RuntimeMode`（唯一值为 `gotrue`）、`CompatibilityCheckResult`
- **Claims mapping**: `SupaOAuthJWTClaims`, `SupaOAuthAppMetadata`, `ClaimsMappingStrategy`

`@supauth/shared` 不提供独立 issuer、独立 JWKS 或替代 Session/MFA 类型。
认证运行时始终由 stock GoTrue 提供，企业授权扩展只进入有界的
`app_metadata.supaoauth.projects[projectRef]`。`supaoauth` 根只包含
`schema_version`、`projects` 和合法 `hook` 元数据；旧根级 RBAC 字段不会读取或双写。

## License

MIT
