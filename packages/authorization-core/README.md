# `@supauth/authorization-core`

Dependency-free TypeScript authorization contracts and in-memory decisions. Authentication remains the identity provider's responsibility; this package resolves one current application-and-domain grant set per request and never acts as a remote PDP. It accepts stable principals from native SupaCloud/GoTrue or SupAuth/OAuth; SupAuth is not a runtime prerequisite.

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

The resolver receives the verified principal, application, and domain and returns only the application's current effective exact allow grants. Missing, inactive, revoked, ambiguous, or denied memberships therefore resolve to an empty permission list and a 403. Infrastructure failure or a malformed grant list raises `AuthorizationUnavailableError` with status 503.

The package deliberately has no cross-request cache or snapshot-expiry contract. Resolve current state once for every request; revocation must be visible to the next request. `canAll([])` denies so an empty configuration cannot grant access.

V1 permissions are exactly `resource:action`. There are no wildcards, explicit deny rules, role inheritance, ABAC expressions, remote PDP calls, or implicit grants.

See the [Application Authorization Kit](https://github.com/zuohuadong/supauth/blob/main/docs/application-authorization-kit.md) for ownership, caching, revocation, and release boundaries.

## License

MIT
