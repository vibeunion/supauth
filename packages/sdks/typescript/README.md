# @supauth/sdk-typescript

TypeScript SDK for the SupaOAuth Management API and public sign-in experience APIs.

## Installation

```bash
npm install @supauth/sdk-typescript
# or
bun add @supauth/sdk-typescript
```

## Quick Start

```typescript
import { SupaOAuthClient } from '@supauth/sdk-typescript';

const client = new SupaOAuthClient({
  baseUrl: 'https://auth.your-domain.com',
  accessToken: '<your-admin-access-token>',
});

// Check service health
const health = await client.health();
console.log(health);

// List applications
const apps = await client.listApplications();

// Create an application
const app = await client.createApplication({
  name: 'My Web App',
  type: 'web',
  redirect_uris: ['https://your-domain.com/callback'],
});

// Resolve sign-in experience for a specific application
const experience = await client.resolvePublicSignInExperience({
  application_id: app.client_id,
});

// Get i18n phrases
const phrases = await client.getPublicPhrases('zh-CN');
```

## API Coverage

The SDK provides methods for all SupaOAuth Management API endpoints:

| Domain | Methods |
|---|---|
| Health / Project | `health()`, `getProject()` |
| Runtime | `getRuntimeHealth()`, `getOAuthServerStatus()`, `getDiscovery()`, `getJWKS()` |
| Applications | `listApplications()`, `createApplication()`, `getApplication()`, `updateApplication()`, `deleteApplication()`, `rotateApplicationSecret()`, `getApplicationConsentSettings()`, `updateApplicationConsentSettings()` |
| Application Bindings | `listApplicationBindings()`, `createApplicationBinding()`, `deleteApplicationBinding()`, `listApplicationScopes()` |
| Connectors | `listConnectors()`, `getConnector()`, `updateConnector()`, `testConnector()`, `getConnectorAuthorizationUri()`, `listConnectorFactories()`, `upsertConnectorFactory()` |
| API Resources | `listResources()`, `createResource()`, `getResource()`, `updateResource()`, `deleteResource()` |
| Scopes | `addScope()`, `removeScope()` |
| Users | `listUsers()`, `getUser()`, `updateUser()`, `suspendUser()`, `deleteUser()`, `resetUserMfa()` |
| Organizations | `listOrganizations()`, `createOrganization()`, `getOrganization()`, `updateOrganization()`, `deleteOrganization()`, `addOrganizationMember()`, `removeOrganizationMember()`, `updateOrganizationMemberRole()`, `listOrganizationInvitations()`, `createOrganizationInvitation()`, `acceptOrganizationInvitation()`, `revokeOrganizationInvitation()`, `getOrganizationJitSettings()`, `updateOrganizationJitSettings()`, `listOrganizationApplications()`, `bindOrganizationApplication()`, `removeOrganizationApplication()` |
| Roles | `listRoles()`, `createRole()`, `getRole()`, `updateRole()`, `deleteRole()` |
| Permissions | `listRolePermissions()`, `createRolePermission()`, `deleteRolePermission()`, `assignRole()`, `revokeRole()`, `getOrgRoleAssignments()` |
| Sign-in Experience | `getSignInExperience()`, `resolveSignInExperience()`, `resolvePublicSignInExperience()`, `getPublicPhrases()`, `updateSignInExperience()`, `getApplicationSignInExperience()`, `updateApplicationSignInExperience()`, `deleteApplicationSignInExperience()` |
| Auth Config | `getAuthConfig()`, `updateAuthConfig()` |
| Organization Templates | `listOrgTemplates()`, `createOrgTemplate()`, `instantiateOrgTemplate()` |
| Webhooks | `listWebhooks()`, `createWebhook()`, `getWebhook()`, `updateWebhook()`, `deleteWebhook()`, `rotateWebhookSecret()`, `listWebhookLogs()`, `testWebhook()`, `replayWebhookDelivery(webhookId, deliveryId)`, `listWebhookEvents()` |
| Audit | `listAuditLogs()` |
| Sync | `syncUserMetadata()`, `syncOrgMetadata()` |
| Tenant Config | `listTenantConfigs()`, `getTenantConfig()`, `upsertTenantConfig()`, `deleteTenantConfig()`, `checkTenantDomain()` |
| Enterprise SSO | `listEnterpriseSSOConfigs()`, `createEnterpriseSSOConfig()` |
| Security / Provisioning | `getSecurityStatus()`, `getProvisioningStatus()`, `reconcileProject()`, `getCompatibilityReport()` |
| Auth Hooks | `getAuthHookRegistrationGuide()` |
| Admin Tools | `compileAuthorizationPlan()`, `getAuthorizationCompilerDemo()`, `generateRLSMigration()`, `getRLSMigrationDemo()` |

## Error Handling

```typescript
import { SupaOAuthClient, SupaOAuthAPIError } from '@supauth/sdk-typescript';

try {
  await client.deleteApplication('nonexistent-id');
} catch (err) {
  if (err instanceof SupaOAuthAPIError) {
    console.log(`Status: ${err.status}`);
    console.log(`Path: ${err.path}`);
    console.log(`Body: ${err.body}`);
  }
}
```

## Response Validation

`health()`, `getRuntimeHealth()`, `getOAuthServerStatus()`, `getDiscovery()` and
`getJWKS()` validate successful JSON responses at runtime. Their result types are
inferred from the decoders. This is response-shape validation, not JWT signature
verification or authorization.

For an application-specific endpoint, use `requestDecoded(path, decoder, options?)`.
The decoder accepts `unknown`, must throw on invalid data, and determines the
return type. `options` supports `AbortSignal`. Do not replace validation with a
type assertion inside the decoder.

Malformed JSON, unexpected 204/205 responses and invalid decoded payloads throw
`SupaOAuthResponseContractError` with `code`, `path`, `status`, and `reason`. The
error does not include the response body or decoder error. HTTP failures retain
`SupaOAuthAPIError`; neither transport nor contract failures automatically replay
writes. Explicit void deletion methods resolve to `undefined`, including 204/205.

Compatibility note: deletion methods previously returned runtime `null` for 204
despite declaring `void`; callers must not depend on that value. Data-returning
methods now reject unexpected 204/205 instead of resolving an unchecked null.

Other existing management methods still use the private compatibility transport
and have not yet migrated to per-endpoint decoders. This change does not implement
automatic session refresh or cross-tab session coordination.

## Token Management

```typescript
// Initialize without token
const client = new SupaOAuthClient({ baseUrl: 'https://auth.your-domain.com' });

// Set token after login
client.setAccessToken('eyJhbGci...');

// Clear token
client.setAccessToken(null);
```

## License

MIT
