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
  // Optional browser, worker, test, or authenticated admin transport.
  fetch: (input, init) => fetch(input, init),
});

// Check service health
const health = await client.health();
console.log(health);

// List applications
const apps = await client.listApplications();

// Create an application
const app = await client.createApplication({
  client_name: 'My Web App',
  client_type: 'public',
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

The SDK exposes 141 existing domain methods, all backed by the shared TypeBox
endpoint map. This is **not** the complete public API: 139 of the 220 operations
in the September 8, 2026 baseline have SDK methods. The two legacy sync methods
are hidden/unavailable server routes. See [CONTRACTS.md](./CONTRACTS.md) for the
complete 81-operation gap list, protocol evidence, and compatibility notes.

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

Every existing domain method validates its input against `sdkEndpoints` before
transport. All 127 JSON-result operations decode successful responses against
their concrete shared TypeBox schema; 13 declared void methods discard successful
response bodies, and one audit download method returns a `Blob`. Types are inferred
using `Static`, not caller-selected generic assertions. This is shape validation,
not JWT signature verification or authorization.

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

There is no private unchecked `request<T>` compatibility transport. Optional
`SupaOAuthClientOptions.fetch` accepts a `SupaOAuthFetch` implementation using only
standard Fetch API types. Authentication refresh remains owned by an injected
transport, and SDK code never automatically retries a request.

### Request Contracts

`client.execute(contract, input)` validates input before sending a request and
validates the JSON receipt before resolving. `RequestContract<Input, Result>`
contains `input` and `result` decoders plus
`request(input): { path, options?: RequestInit }`. Types are inferred from the
contract, not from a generic assertion at the call site. Pass idempotency headers
and cancellation through `options` in the request mapping.

Invalid input throws `SupaOAuthRequestContractError` with
`SUPAUTH_REQUEST_CONTRACT_INVALID`, without including decoder errors or input.
Malformed receipts retain `SupaOAuthResponseContractError`; neither failure
clears the access token or retries a write.

Permission responses require `roles`, `permissions`, and `scopes` string arrays.
A malformed payload rejects rather than silently becoming an empty permission
set. This is not token verification or an authorization decision, and does not
imply that routes outside the current SDK surface have SDK methods.

### Shared Endpoint Map

```typescript
import { sdkEndpoints, decodeSchema, type SdkEndpointInput } from '@supauth/shared';

const operation = sdkEndpoints.createRole;
const input: SdkEndpointInput<'createRole'> = {
  body: { name: 'Reader', description: null, permissions: ['documents.read'] },
};
decodeSchema(operation.input, input);
// operation.method, operation.path, operation.input, operation.result,
// and operation.responseKind are shared with server/admin/OpenAPI.
```

Input sections are `params`, `query`, `body`, and `headers` when applicable.
When a consumer-void method discards a real JSON receipt, optional `wireResult`
describes that response for server/OpenAPI without changing SDK return behavior.
`SdkEndpointResult<K>` describes the schema's wire value. For the blob operation
the schema is OpenAPI `string/binary`; the SDK method returns the platform `Blob`.
The shared package itself does not depend on DOM, Worker, Node, or Bun globals.

Run SDK `build`, `typecheck:contracts`, and `test` after the shared package build.
Contract checks include published browser and Worker declarations with
`types: []`, plus deliberate negative type cases. Tests include strict compilation
and independent positive/negative protocol fixtures for all current SDK methods.

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
