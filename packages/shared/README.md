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
  GOTRUE_CLAIMS_STRATEGY,
  EXTERNAL_OIDC_CLAIMS_STRATEGY,
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
- **Runtime types**: `RuntimeMode`, `CompatibilityCheckResult`
- **Claims mapping**: `SupaOAuthJWTClaims`, `SupaOAuthAppMetadata`, `ClaimsMappingStrategy`

## License

MIT
