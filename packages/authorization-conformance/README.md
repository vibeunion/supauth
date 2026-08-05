# `@supauth/authorization-conformance`

Pure, deterministic harnesses for application authorization adapters, generated SQL, and parsed PostgreSQL plans. The package has no CLI and performs no network or database access itself.

## Installation

```sh
npm install --save-dev @supauth/authorization-conformance
# or
bun add --dev @supauth/authorization-conformance
```

In CI, pass an application fixture harness to `runAuthorizationConformance`. `runDenialScenario` must exercise the real adapter for every required denial, including inactive principals, explicit-deny precedence, ambiguous membership, and identity/application/domain isolation. `runRevocationVisibilityScenario` must first observe an allowed request, revoke its grant in the fixture, and then observe a 403 on the next request. An unavailable adapter must return 503 rather than masquerading as an ordinary denial.

Pass the reviewed projection preflight, installation, and RLS SQL to `checkAuthorizationSql` as separate `projectionPreflightSql`, `installSql`, and `rlsSql` fields. Pass `legacyCleanupSql` only for an upgrade that removes the old three-argument helper. The checker requires a read-only, machine-readable preflight; fixed application binding; helper hardening; authenticated policy clauses; and the uncorrelated allowed-scope shape. It rejects top-level procedural `DO` blocks, projection checks hidden inside installation SQL, mutating preflights, package-owned permission tables, legacy role adapters, caller-controlled application IDs, row-scoped helpers, row-column casts, tautological policies, `array_agg`/`ANY` defaults, and cascading legacy cleanup.

`checkAuthorizationSql` validates structure; it does not execute the preflight. Before submitting a migration, the client must execute the preflight separately and require zero `rule`/`message` rows. Never append the preflight to a migration and ignore its query result.

This structural lint accepts the generator's canonical SQL shape; it is not a general SQL parser or authorization proof. Release acceptance also requires real negative observations from the target database. Tables near or above 250,000 rows, or principals with more than 1,000 scopes, must run authenticated `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with representative data and pass the parsed JSON value to `checkAuthorizationExplain`; each helper node must report `Actual Loops = 1` and belong to the hashed subplan referenced by its ancestor filter.

See the [Application Authorization Kit](https://github.com/zuohuadong/supauth/blob/main/docs/application-authorization-kit.md) for the required scenario and release evidence contract.

## License

MIT
