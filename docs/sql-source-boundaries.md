# SQL Source Boundaries

## Task Contract

- Source: Codex chat `01a0fd7e-04e5-7202-80ed-4f8091407d54`, applied to SupAuth rather than the FA application.
- Goal: separate historical hosted SQL from execution and current Drizzle schema, preserving the installed migration ledger.
- Non-goals: change database objects, remove legacy data, add another migration runner, publish, deploy, or modify the concurrent HTTP framework migration.
- Collaboration: pipeline (`explorer -> executor -> verifier -> orchestrator`). SQL delivery and permission history make delegation necessary.
- Scope: `packages/auth-server/src/db/migrate.ts`, a versioned migration directory, five migration-only consumers, one focused migration test and its baseline fixture, and this document.
- Conventions: existing Bun/TypeScript and SupaCloud Management API delivery; strict types, no `any`, no type suppression. Product acceptance follows the `pm-spec` skill.
- Verification: one focused migration test file and `git diff --check`; compare every original migration name, order, and SHA-256, and verify a self-contained bundle.
- Risk: changing even whitespace can alter an installed migration checksum; preserve exact SQL bytes. Rollback consists only of reverting this local source reorganization. No database rollback is required.
- Isolation: changes are implemented in a separate worktree. Existing changes in the main checkout are not part of this task.

## Acceptance

1. Given an existing installation, when it receives the refactored migration catalog, then all 16 names, their order, and their SQL bytes match the previous catalog.
2. Given current Drizzle models, when the application loads them, then they do not load historical migration SQL or an audit dump.
3. Given an installer or provisioning consumer, when it imports migration data, then it does not import the direct database executor.
4. Given a standalone Function bundle, when the migration catalog is bundled, then its SQL is included without runtime filesystem reads or extra deployment files.
5. Given a future database change, when it is implemented, then it adds a new reviewed migration rather than rewriting a recorded version.

## Source Ownership

`packages/auth-server/src/db/schema.ts` remains the current typed query model.
It includes explicitly classified legacy compatibility tables; it is not a
complete bootstrap definition and must not be used to recreate upstream
SupaCloud or GoTrue tables.

Historical migrations are deployment history, not the source for current model
types. Their function definitions and grants remain frozen together. A function
or permission change must use a new forward migration, not edit the old version
or substitute a mutable current function body during historical replay.

There is no full-database SQL snapshot or generated business RPC type pipeline
to retire in this repository. This refactor does not introduce a duplicate
function registry, an audit snapshot dependency, or a second Drizzle migration
ledger merely to mirror another project's directory structure.

## Layout

| Source | Responsibility |
| --- | --- |
| `src/db/schema.ts` | Current Drizzle query models, unchanged |
| `src/db/migrations/catalog.ts` | Names, ordered versions, raw SQL hashes and installation checksums; no imports of SQL or database drivers |
| `src/db/migrations/v*.ts` | Frozen historical SQL, one module per recorded version |
| `src/db/migrations/index.ts` | Statically assembled SQL for the installer and provisioning route; no database executor |
| `src/db/migrate.ts` | Compatibility exports and existing executor; direct CLI execution remains disabled |
| `tests/fixtures/hosted-migrations-baseline.json` | Independent pre-refactor checksum fixture |

The `src/` paths above are relative to `packages/auth-server/`.
Version numbers are `1, 4, 5, ..., 18`; v2 and v3 must not be invented.
The v16 forward repair re-exports the frozen v7 body, preserving both recorded
migration names. The catalog controls ordering, not directory enumeration.

SQL remains in static TypeScript string modules to preserve the existing
single-file Function bundle contract. There are no runtime SQL file reads,
asset loaders, new dependencies, or extra deployment files.

Manifest creation and artifact verification import metadata only. Installation
and provisioning import the SQL assembly directly. Existing historical SQL
tests may continue to import the compatibility facade; their permission and
upgrade assertions are not replaced with checks on the current schema.
The GoTrue/RLS regression suites still use historical migration bodies, and
this change does not claim they have become an independent current-function
contract suite.

## Verification Record

- Baseline commit: `4b241dbaf8e30a149d4a3af5c076850e0c33ae16`.
- Baseline hashes were captured from the original exported strings before extraction. Raw byte hashes and normalized installation checksums are distinct and both are checked.
- Explorer: confirmed that an independent current-function registry has no consumer in this scope; adding one would introduce duplicate maintenance.
- Executor: compared all 16 original and extracted SQL strings and compatibility exports. Aggregate SHA-256 before and after: `2d6d73789370d9cd39c663b5ac3f6613da18ff1d8784b2f9a4b5c1ec76fa0837`.
- Focused test: `bun --no-env-file test packages/auth-server/src/__tests__/migration.test.ts`.
- The test runs the real `installMigrationPlan()`, checks unchanged manifest declarations, bundles the SQL with a browser target and executes it without database configuration, records dependency graphs for metadata/schema boundaries, and checks the disabled direct CLI.
- Independent review found four TypeScript assertion incompatibilities that runtime tests alone did not catch. They were fixed with explicit structural types, without casting the baseline or weakening compiler options.
- The same focused test now includes project-configured syntactic and semantic checks on 24 changed SQL/tooling/test files. The provisioning route's pre-existing framework diagnostics were independently compared with the baseline and were unchanged; this is not a claim that the whole repository typechecks.
- Latest local result: 36 tests passed, no failures; `git diff --check` passed.
- Independent verifier reran the focused test and diff check after the type fixes: 36 passed, 142 assertions, no remaining findings. Local acceptance: PASS.
- This is local source and delivery-contract verification, not PostgreSQL replay, a production migration, a complete application release build, or online acceptance.
