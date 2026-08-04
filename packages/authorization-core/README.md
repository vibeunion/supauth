# `@supauth/authorization-core`

Dependency-free TypeScript authorization contracts and in-memory decisions. Authentication remains the identity provider's responsibility; this package resolves one application-and-domain-scoped snapshot per request and never acts as a remote PDP. It accepts stable principals from native SupaCloud/GoTrue or SupAuth/OAuth; SupAuth is not a runtime prerequisite.

## Installation

```sh
npm install @supauth/authorization-core
# or
bun add @supauth/authorization-core
```

## Usage

```ts
import { assertCan, permission, resolveAuthorization } from '@supauth/authorization-core';

const authorization = await resolveAuthorization(requestContext, localAuthorizationResolver);
assertCan(authorization, permission('invoice:read'));
```

The resolver must read the application's current local membership and role state. Missing, inactive, and revoked memberships resolve to an empty permission list and therefore a 403. Infrastructure failure or a stale, future-dated, malformed, or mismatched snapshot raises `AuthorizationUnavailableError` with status 503. Every snapshot has a required `expiresAt`; the application resolver must enforce its own maximum TTL, and high-risk commands should resolve current state without a cross-request cache. The request and snapshot must match on principal kind, issuer, subject, application, domain type, and domain ID, which prevents reusing a cache entry across users, services, applications, or domains. Monotonic non-negative `policyVersion` and `assignmentVersion` values make cache invalidation explicit; `canAll([])` denies so an empty configuration cannot grant access.

V1 permissions are exactly `resource:action`. There are no wildcards, explicit deny rules, role inheritance, ABAC expressions, remote PDP calls, or implicit grants.

See the [Application Authorization Kit](https://github.com/zuohuadong/supauth/blob/main/docs/application-authorization-kit.md) for ownership, caching, revocation, and release boundaries.

## License

MIT
