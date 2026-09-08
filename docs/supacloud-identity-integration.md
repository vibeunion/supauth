# SupaCloud Identity Integration

This contract targets the SupaCloud identity adapter introduced by PR #1220,
commit `66a77caea086bb1282772dd9401bd2adb9c04342`. A merged commit is not proof that
an npm version contains the adapter: select an actually published version exposing
`createSupAuthRequestContext` before updating a deployed application's dependencies.

## Ownership And IDs

SupAuth is the external user-center product integration; stock GoTrue remains the
OAuth/OIDC runtime and token issuer. SupaCloud verifies identity and runs declared
application adapters. FA and other applications own memberships, object access,
transactions, receipts, audits and RLS. Do not introduce a second user center or
move application authorization facts into JWT projections.

| Value | Meaning | Source |
| --- | --- | --- |
| `issuer` | Exact trusted GoTrue token issuer | Reviewed deployment configuration |
| `audience` | Expected access-token audience, often `authenticated` | Reviewed token contract, not the OAuth client ID |
| `clientId` | OAuth application binding | Registered client's ID; matches root `client_id` or `azp` |
| `projectId` | SupaCloud project/access boundary | Host configuration and authoritative application access |
| authorization-core `applicationId` | Business authorization namespace | Explicit server-side mapping, for example `xigu-fa` |
| `tenantId` / authorization domain | Application-owned tenant/data boundary | Current local membership, never a request header |

These values are not interchangeable. In particular a successful audience check
does not prove application binding. In the current authorization-postgres preset,
`requireOAuthApplicationClaim: true` compares token claims directly with the
schema's installed `applicationId`; that installed value must therefore equal the
OAuth client ID. It does not translate an OAuth UUID into a business slug.
Model any separate authorization-core namespace through trusted application
configuration rather than assuming those two `applicationId` fields are equal.

## Host Adapter

```ts
import { createSupAuthRequestContext, type SupAuthContextOptions } from '@supacloud/elysia';

export function applicationIdentity(
  resolveAccess: SupAuthContextOptions['resolveAccess'],
) {
  return createSupAuthRequestContext({
    issuer: 'https://identity.example.test/auth/v1',
    audience: 'authenticated',
    clientId: 'registered-oauth-client-id',
    projectId: 'application-project-ref',
    jwksUrl: 'https://identity.example.test/auth/v1/.well-known/jwks.json',
    resolveAccess,
  });
}
```

`resolveAccess` reads current membership and returns `{ projectId, tenantId,
permissions }`, or `null` when access is denied. Throw a sanitized unavailable
error for a resolver outage rather than returning `null`. The host can use
`resolveAuthorization` and `assertCan` from `@supauth/authorization-core` where
appropriate; domain-specific authorization timing still belongs to the
application. Recheck current authorization when replaying an idempotent command.

SupaCloud does not expose arbitrary errors merely because they have a `status`.
When using authorization-core, explicitly map its known error classes at the host
boundary; otherwise these errors correctly remain generic 500 responses:

```ts
import { createApplication } from '@supacloud/elysia';
import {
  AuthorizationForbiddenError,
  AuthorizationUnavailableError,
} from '@supauth/authorization-core';

const app = createApplication({
  modules,
  requestContext: applicationIdentity(resolveAccess),
  errorMapper(error) {
    if (error instanceof AuthorizationForbiddenError) {
      return Response.json({ code: 'APPLICATION_ACCESS_DENIED' }, { status: 403 });
    }
    if (error instanceof AuthorizationUnavailableError) {
      return Response.json({ code: 'AUTHORIZATION_UNAVAILABLE' }, { status: 503 });
    }
    return undefined;
  },
});
```

Here `modules` and `resolveAccess` are application-owned. Do not map every error
with a `status` or echo its message: unknown failures must remain sanitized.

The user adapter requires signed `sub`, `exp`, `iat`, matching issuer/audience,
an allowed asymmetric signature, `role: "authenticated"`, and matching
`client_id` or `azp`. If both application claims exist, both must be strings and
match the expected client. Missing, conflicting, null or wrong-application claims
are denied before membership lookup. Do not use ID tokens, service-role tokens,
unverified decoded payloads or forwarded subject/tenant headers as a fallback.

`SupaOAuthJWTClaims.azp` is an optional payload type, not an instruction to mint
that claim. GoTrue OAuth access tokens continue to preserve `client_id` and
`scope`. Native GoTrue sessions without application claims are outside this strict
OAuth adapter; do not add a permissive fallback to make them pass.

| Failure | HTTP status | Meaning |
| --- | --- | --- |
| Invalid/expired token, wrong application or non-user role | 401 | Identity contract not satisfied |
| Verified identity but no current membership/object permission | 403 | Application access denied |
| JWKS verification service unavailable | 503 | Identity verification unavailable |
| Application authorization resolver unavailable, explicitly mapped by the host | 503 | Current authorization cannot be established |

Do not collapse outages into ordinary denials. Do not return tokens, resolver
causes, private endpoints or raw claims in public errors. Revocation must take
effect on the next application request without waiting for token refresh.

## Deterministic Contract Gate

The `SupaCloud Identity Contract` workflow builds the pinned upstream runtime,
uses SupAuth's real custom-access-token hook, signs its output using ephemeral
ES256 keys and exercises the real SupaCloud HTTP adapter with the real SupAuth
authorization-core resolver. No deployed endpoint, database or credential is used.
The SupAuth runtime does not gain a dependency on `@supacloud/elysia`.

To repeat locally, install/build SupAuth shared and the pinned runtime, then run:

```sh
bun --no-env-file scripts/check-supacloud-identity.ts /path/to/supacloud/packages/elysia
```

The dedicated gate fails if the built runtime is absent; it cannot silently skip.
Ordinary contract tests do not require an unrelated checkout. Cross-project cases
cover matching claims, wrong application, missing/conflicting claims, malformed
`azp`, forged identity headers, invalid signatures/issuer/audience/expiry,
membership and permission revocation, and sanitized 401/403/503 behavior.

This is not live GoTrue issuance/refresh proof, a real FA migration, database
transaction/RLS proof, or deployment acceptance. Existing strict live-auth and
PostgreSQL gates remain separate. FA should adopt the matching packages and its
POST command migration in an application PR; no legacy DELETE alias is added here.
