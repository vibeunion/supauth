# `@supauth/authorization-conformance`

Pure, deterministic checks for application authorization adapters and generated SQL. The package has no CLI and performs no network or database access.

## Installation

```sh
npm install --save-dev @supauth/authorization-conformance
# or
bun add --dev @supauth/authorization-conformance
```

In CI, run the application's real resolver against fixtures for every `REQUIRED_AUTHORIZATION_SCENARIOS` entry, map the observed outcome to `{ scenario, allowed, status }`, then assert that `checkAuthorizationConformance(...).passed` is true. A missing/inactive/cross-domain/cross-application/unknown/revoked/service-vs-user case must deny with 403. A stale snapshot or unavailable adapter must fail with 503, never masquerade as an ordinary denial.

Pass reviewed installation and RLS SQL to `checkAuthorizationSql`. It strips comments and literals before enforcing hardened helper grants, schema access, authenticated policy bindings, and the hashed allowed-scope-set shape. It rejects row-scoped permission helpers, row-column casts, tautological policies, and `array_agg`/`ANY` defaults. This structural lint is not an SQL parser or authorization proof: release acceptance also requires real negative observations from the target database. Tables near or above 250,000 rows, or principals with more than 1,000 scopes, must run authenticated `EXPLAIN (ANALYZE, BUFFERS)` with representative data and pass its text to `checkAuthorizationExplain`; the helper's own plan node must report `loops=1`.

See the [Application Authorization Kit](https://github.com/zuohuadong/supauth/blob/main/docs/application-authorization-kit.md) for the required scenario and release evidence contract.

## License

MIT
