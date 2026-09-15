# SDK Contracts and Coverage

Snapshot: September 8, 2026. This is SDK coverage, not whole-server coverage or
authenticated upstream acceptance.

## Single Source

`@supauth/shared` exports `sdkEndpoints`, `SdkEndpoint`, `SdkHttpMethod`,
`SdkEndpointName`, `SdkEndpointInput<K>`, and `SdkEndpointResult<K>`.
Each operation has literal `method`/`path`, TypeBox `input`/`result`, and
`responseKind`. The map imports entity schemas directly from `core.js` and
SDK-specific schemas from `sdk-models.js`; neither module imports the package
index. Local SDK interfaces were moved to schema definitions and `Static` types.
There is no second handwritten SDK input/result interface collection.

Three consumer-void operations also declare `wireResult`: organization deletion,
organization member removal, and tenant collaborator removal return JSON
`{ deleted, organization/member/collaborator }` on the wire. Server/OpenAPI must
use that schema while the existing SDK continues discarding successful receipts.

The SDK retains its six previously exported policy/compiler type names.
Transport adds `SupaOAuthClientOptions` and `SupaOAuthFetch`, with optional
constructor `fetch`. Standard `Headers`, tuple headers, cancellation, explicit
token updates, API errors, JSON failures, and empty-result semantics are tested.
There is no SDK retry or automatic session refresh.

The operation input is an object with the applicable `params`, `query`, `body`,
and `headers` sections. Optional query values are omitted, path values are
encoded once, and the original query omission behavior for empty strings/zero
is retained. `testWebhook` and `bindOrganizationApplication` accept an omitted
body for admin consumers; existing SDK methods continue to send `{}`.

`SdkEndpointResult<'getAuditExportDownload'>` is the OpenAPI wire string/binary
description. `client.getAuditExportDownload()` returns `Promise<Blob>` in the
consumer environment; shared contracts have no DOM/Bun/Node requirement.

## Counts and Gates

- 141 existing SDK domain methods and 141 distinct method/path pairs.
- 127 JSON responses, 13 explicit void responses, one binary response.
- 139 pairs match the independent 220-operation OpenAPI baseline.
- 81 public baseline operations have no SDK method.
- Two SDK methods target hidden legacy sync routes that now return capability
  errors: `POST /v1/sync/user/:userId` and `POST /v1/sync/org/:orgId`.
- The SDK fixture/invocation maps have exhaustive compile-time key checks and a
  runtime check against the client's public method inventory.
- Fixtures are hand-authored protocol examples, not `Value.Create(schema)`.
  Every JSON method rejects malformed roots and unexpected 204/205 responses.
  Additional negative cases mutate nested user, permission, audit export,
  provisioning, tenant member, webhook, hook, and compiler fields.
- `build`, `typecheck:contracts`, and `test` run with strict,
  noUncheckedIndexedAccess, and exactOptionalPropertyTypes inherited from the
  repository base config. Tests themselves are typechecked. Browser/Worker
  consumers import built package declarations with `types: []` and include
  negative assertions against Bun, Node, DOM-in-Worker, wrong input/output
  fields, unchecked indexing, and explicit undefined optional properties.

Recompute the full-server difference using an independently exported document:

```sh
bun packages/sdks/typescript/scripts/contract-coverage.ts /path/to/baseline-openapi.json
```

## Protocol Evidence and Compatibility

The authoritative source inspection included:

| Domain | Evidence |
| --- | --- |
| OAuth clients/consent | `auth-server/src/routes/applications.ts`, `repositories/application-control.ts` |
| Binding/scopes/resources | `repositories/bindings.ts`, `repositories/resources.ts`, `db/schema.ts` |
| Users/MFA | `routes/users.ts`, `routes/user-update-policy.ts`, SupaCloud `routes/auth-users.ts` |
| Organizations | `routes/organizations.ts`, SupaCloud `services/project-organization.service.ts`, `db/platform-v2.ts` |
| RBAC | `routes/roles.ts`, SupaCloud `services/project-rbac.service.ts` |
| Tenant collaborators | SupaCloud `routes/project-collaborators.ts`, `services/project-collaborator.service.ts` |
| Audit | SupaCloud `routes/project-audit.ts`, `services/audit.service.ts`; BFF download URL rewriting in `supacloud/adapter.ts` |
| Webhooks | `routes/webhooks.ts`, SupaCloud `services/webhook-delivery.service.ts`, `db/platform-v2.ts` |
| Auth hook diagnostics | `routes/auth-hooks.ts`, SupaCloud `services/gotrue-auth-hook-runtime.service.ts` |
| Provisioning/templates/config | `routes/provisioning.ts`, `repositories/organization-templates.ts`, `db/schema.ts` |

SupaCloud evidence refers to the local sibling source inspected during the
migration, not a deployment version assertion.

Compatibility changes correct previously unverified declarations:

- Application create/get/update results are OAuth client DTOs, not the
  historical `Application` interface. Inputs also expose actual GoTrue
  `client_name`/`client_type` fields; old name/type fields remain accepted.
- Connector listing is a paged provider result, not `unknown[]`. Preflight
  returns a runtime authorization diagnostic; unavailable authorization URI
  has a distinct union branch.
- Resource and scope repository rows use camelCase timestamps/resourceId.
  Resource updates omit the scopes attachment. These are explicit variants
  alongside historical shared DTOs; no normalization changes response keys.
- Application binding/consent and template/config/SSO records retain their
  repository field names. Nullable storage fields are represented explicitly.
- Organization rows and members have explicit SupaCloud variants alongside
  historical DTOs. Accepting an organization invitation returns a member;
  revocation returns `{ revoked, invitation }`; removing an application
  binding returns `{ deleted, binding }`.
- Role creation supports `permissions` and nullable descriptions; role and
  permission readback allows nullable optional fields. User permissions/roles
  support optional application scope.
- Role input length applies after trimming, so 255-character names and
  permissions wrapped in whitespace remain accepted without SDK normalization.
  User updates validate known fields but preserve JSON extension fields, as
  the server sanitizer delegates these to the upstream runtime.
- Webhook test/replay results are queued acknowledgements; delivery fields
  have concrete database types rather than an arbitrary log object.
- Provisioning may return structured failure/success steps and an
  `error/project_ref` result for invalid project references. PostgreSQL audit
  checkpoint counts can serialize as a number or decimal string.
- Audit actor types include platform principal types (`project`, `anonymous`)
  in addition to BFF actors, as emitted by SupaCloud's audit append service.
- User/config/custom metadata remains a JSON dictionary where the protocol is
  deliberately extensible. Functions, undefined values and non-JSON metadata
  are rejected. This is not an authorization policy or secret-redaction layer.

## Remaining Evidence Gap

`checkTenantDomain` has a concrete diagnostic envelope (`domain`, `status`,
`checked_at`, optional `error`) from the BFF catch branch. The inspected sibling
SupaCloud source does not implement `/domains/:domain/health`; the optional live
test only records capability presence and contains no successful response
fixture. No successful upstream variant was invented. A live, authorized
fixture or provider source is still needed before claiming this response
contract preserves every deployed domain-health success variant.

All automated evidence here is local. Independent verifier review, full-server
integration, authentication acceptance, release, and deployment remain separate
gates owned by the parent task.

## Public Operations Not in SDK

```text
DELETE /v1/enterprise-sso/{id}
DELETE /v1/org-templates/{templateId}
DELETE /v1/public/account/
DELETE /v1/public/account/grants/{clientId}
DELETE /v1/public/account/identities/{identityId}
DELETE /v1/public/account/mfa/{factorId}
DELETE /v1/sign-in-experience/custom-ui-assets
GET /
GET /account
GET /account/password
GET /admin
GET /change-password
GET /claim
GET /login
GET /logout
GET /oauth/authorize
GET /oauth/sso/authorize
GET /v1/account-provisioning/records
GET /v1/account-provisioning/sync/status
GET /v1/api-versions/
GET /v1/api-versions/{version}
GET /v1/audit/export
GET /v1/auth-config/runtime-consistency
GET /v1/auth-hooks/custom-access-token/config
GET /v1/auth/health
GET /v1/auth/identity
GET /v1/enterprise-sso/domain/{domain}
GET /v1/enterprise-sso/{id}
GET /v1/org-templates/default
GET /v1/org-templates/{templateId}
GET /v1/public/account-claims/config
GET /v1/public/account/config
GET /v1/public/account/grants
GET /v1/public/account/identities
GET /v1/public/account/me
GET /v1/public/account/mfa
GET /v1/public/account/permissions
GET /v1/public/admin-sso-config
GET /v1/public/connectors/{connectorId}/authorize
GET /v1/public/oauth/authorizations/{authorizationId}
GET /v1/public/oauth/sso/authorize
GET /v1/rbac-bridge/compatibility-helper
GET /v1/rbac-bridge/default-policy
GET /v1/route-gate/
GET /v1/route-gate/routes
GET /v1/security-config/
GET /v1/sign-in-experience/custom-ui-assets
GET /v1/storage/branding/{assetType}
GET /v1/storage/buckets
GET /v1/users/{userId}/grants
PATCH /v1/auth-hooks/custom-access-token/config
PATCH /v1/public/account/email
PATCH /v1/public/account/phone
PATCH /v1/public/account/profile
POST /v1/account-provisioning/import
POST /v1/account-provisioning/sync
POST /v1/account-provisioning/sync/reconcile
POST /v1/api-versions/
POST /v1/auth-hooks/before-user-created
POST /v1/auth-hooks/custom-access-token
POST /v1/auth/login
POST /v1/auth/logout
POST /v1/connectors/from-factory/{factoryId}
POST /v1/provisioning/{projectRef}/rollback
POST /v1/public/account-claims/claim
POST /v1/public/account-password/change
POST /v1/public/account/identities/authorize
POST /v1/public/account/logout
POST /v1/public/account/mfa/totp/enroll
POST /v1/public/account/mfa/{factorId}/verify
POST /v1/public/oauth/authorizations/{authorizationId}/consent
POST /v1/rbac-bridge/dry-run
POST /v1/rbac-bridge/import
POST /v1/sign-in-experience/custom-ui-assets
POST /v1/storage/avatar/{userId}
POST /v1/storage/branding/{assetType}
POST /v1/storage/buckets/{bucketId}
POST /v1/users/{userId}/unsuspend
PUT /v1/enterprise-sso/{id}
PUT /v1/org-templates/{templateId}
PUT /v1/security-config/
```
