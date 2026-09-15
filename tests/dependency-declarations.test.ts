import { expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '..');

const positive = `
import Elysia, { t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import type { ComposeElysiaResponse, MacroToContext } from "elysia/types";
import type { SelectiveStatus } from "elysia/error";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { PgDialect, pgTable, integer } from "drizzle-orm/pg-core";
import type { PgRelationalQuery } from "drizzle-orm/pg-core/query-builders/query";
import type { PgSession } from "drizzle-orm/pg-core/session";
import { PostgresJsSession, PostgresJsTransaction, type PostgresJsQueryResultHKT, type PostgresJsTransactionSession } from "drizzle-orm/postgres-js/session";
import type { Sql } from "postgres";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const users = pgTable("users", { id: integer().notNull() });
type Id = Assert<Equal<typeof users.$inferSelect.id, number>>;
declare const query: PgRelationalQuery<{ id: number }[]>;
const statement: SQL = query.getSQL();
const wrapper: SQLWrapper = query;
type Disabled = MacroToContext<{ auth: { resolve: () => { user: string } } }, { auth: false }>;
type DisabledResolve = Assert<Equal<Disabled["resolve"], {}>>;
type DisabledReturn = Assert<Equal<Disabled["return"], {}>>;
type QuotedResponse = ComposeElysiaResponse<{ response: { "200": { id: number } } }, () => string, {}>;
type SchemaWins = Assert<Equal<QuotedResponse[200], { id: number }>>;
declare const quotedStatus: SelectiveStatus<{ "200": { id: number }; "404": { missing: true } }>;
const ok = quotedStatus(200, { id: 1 });
type StatusCode = Assert<Equal<typeof ok.code, 200>>;
quotedStatus("Not Found", { missing: true });
new Elysia().use(swagger()).macro({ auth: { resolve: () => ({ user: { id: 1 } }) } })
  .get("/selected", ({ user }) => { type UserId = Assert<Equal<typeof user.id, number>>; return user.id; }, { auth: true });
new Elysia().get("/quoted", ({ status }) => status(200, { id: 1 }), { response: { "200": t.Object({ id: t.Number() }) } });
const app = new Elysia().model({ User: t.Object({ id: t.Number() }) });
type Parsed = Assert<Equal<ReturnType<typeof app.models.User.parse>, { id: number }>>;
const parsed = app.models.User.safeParse({ id: 1 });
if (parsed.success) { const id: number = parsed.data.id; const error: null = parsed.error; }
else { const empty: null = parsed.data; const error: string | undefined = parsed.error; }
declare const rootSession: PostgresJsSession<Sql, {}, {}>;
const rootBase: PgSession<PostgresJsQueryResultHKT, {}, {}> = rootSession;
const rootResult: Promise<number> = rootBase.transaction(async () => 1);
const nestedResult: Promise<number> = rootSession.transaction(async tx => tx.transaction(async () => 1));
declare const transactionView: PostgresJsTransactionSession<{}, {}>;
transactionView.prepareQuery({ sql: "select 1", params: [] }, undefined, undefined, false);
new PostgresJsTransaction(new PgDialect(), transactionView, undefined).transaction(async () => 1);
`;

const negative = `
import Elysia, { t } from "elysia";
import type { SelectiveStatus } from "elysia/error";
import type { SQL } from "drizzle-orm";
import { PgDialect, pgPolicy, pgRole } from "drizzle-orm/pg-core";
import type { PgSession } from "drizzle-orm/pg-core/session";
import { PostgresJsSession, type PostgresJsQueryResultHKT, type PostgresJsTransactionSession } from "drizzle-orm/postgres-js/session";
import type { TransactionSql } from "postgres";
declare const transactionClient: TransactionSql;
const nested = new PostgresJsSession(transactionClient, new PgDialect(), undefined); // DIAGNOSTIC 2345
const widened: PgSession<PostgresJsQueryResultHKT, Record<string, unknown>, {}> = nested;
widened.transaction(async () => 1);
declare const transactionView: PostgresJsTransactionSession<Record<string, unknown>, {}>;
const widenedView: PgSession<PostgresJsQueryResultHKT, Record<string, unknown>, {}> = transactionView; // DIAGNOSTIC 2739
transactionView.transaction(async () => 1); // DIAGNOSTIC 2339
transactionView.client.end(); // DIAGNOSTIC 2339
const wrongSql: SQL = 1; // DIAGNOSTIC 2322
new Elysia().macro({ auth: { resolve: () => ({ user: { id: 1 } }) } })
  .get("/selected", ({ user }) => { const wrong: string = user.id; return wrong; }, { auth: true }); // DIAGNOSTIC 2322
new Elysia().macro({ auth: { resolve: () => ({ user: { id: 1 } }) } })
  .get("/disabled", context => context.user.id, { auth: false }); // DIAGNOSTIC 2339
declare const quotedStatus: SelectiveStatus<{ "200": { id: number } }>;
quotedStatus(200, { id: "bad" }); // DIAGNOSTIC 2322
quotedStatus("200", { id: 1 }); // DIAGNOSTIC 2345
const app = new Elysia().model({ User: t.Object({ id: t.Number() }) });
const wrongParsed: string = app.models.User.parse({ id: 1 }).id; // DIAGNOSTIC 2322
pgPolicy("invalid", { as: undefined }); // DIAGNOSTIC 2379
pgRole("invalid", { createDb: undefined }); // DIAGNOSTIC 2379
`;

const cjsPositive = `
import type { SQL, SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PgRelationalQuery } from "drizzle-orm/pg-core/query-builders/query";
import type { PgSession } from "drizzle-orm/pg-core/session";
import { PostgresJsSession, PostgresJsTransaction, type PostgresJsQueryResultHKT, type PostgresJsTransactionSession } from "drizzle-orm/postgres-js/session";
import type { Sql } from "postgres";
declare const query: PgRelationalQuery<{ id: number }[]>;
const statement: SQL = query.getSQL();
const wrapper: SQLWrapper = query;
declare const rootSession: PostgresJsSession<Sql, {}, {}>;
const rootBase: PgSession<PostgresJsQueryResultHKT, {}, {}> = rootSession;
const rootResult: Promise<number> = rootBase.transaction(async () => 1);
const nestedResult: Promise<number> = rootSession.transaction(async tx => tx.transaction(async () => 1));
declare const transactionView: PostgresJsTransactionSession<{}, {}>;
transactionView.prepareQuery({ sql: "select 1", params: [] }, undefined, undefined, false);
new PostgresJsTransaction(new PgDialect(), transactionView, undefined).transaction(async () => 1);
`;

const cjsNegative = `
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PgSession } from "drizzle-orm/pg-core/session";
import { PostgresJsSession, type PostgresJsQueryResultHKT, type PostgresJsTransactionSession } from "drizzle-orm/postgres-js/session";
import type { TransactionSql } from "postgres";
declare const transactionClient: TransactionSql;
const nested = new PostgresJsSession(transactionClient, new PgDialect(), undefined); // DIAGNOSTIC 2345
const widened: PgSession<PostgresJsQueryResultHKT, Record<string, unknown>, {}> = nested;
widened.transaction(async () => 1);
declare const transactionView: PostgresJsTransactionSession<Record<string, unknown>, {}>;
const widenedView: PgSession<PostgresJsQueryResultHKT, Record<string, unknown>, {}> = transactionView; // DIAGNOSTIC 2739
transactionView.transaction(async () => 1); // DIAGNOSTIC 2339
transactionView.client.end(); // DIAGNOSTIC 2339
const wrongSql: SQL = 1; // DIAGNOSTIC 2322
`;

// Elysia/Swagger follow auth-server's Bundler contract; Drizzle also ships CJS declarations.
for (const mode of [
  {
    name: 'ESM', extension: 'ts', module: ts.ModuleKind.ESNext, resolution: ts.ModuleResolutionKind.Bundler,
    positive, negative, expectedCount: 12,
    entries: ['/elysia/dist/index.d.ts', '/@elysiajs/swagger/dist/index.d.ts'],
  },
  {
    name: 'CJS', extension: 'cts', module: ts.ModuleKind.NodeNext, resolution: ts.ModuleResolutionKind.NodeNext,
    positive: cjsPositive, negative: cjsNegative, expectedCount: 5, entries: [],
  },
]) {
  it(`checks installed declarations and rejects unsafe consumers (${mode.name})`, () => {
    const options: ts.CompilerOptions = {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noPropertyAccessFromIndexSignature: true,
      noFallthroughCasesInSwitch: true,
      skipLibCheck: false,
      skipDefaultLibCheck: false,
      noCheck: false,
      noEmit: true,
      target: ts.ScriptTarget.ESNext,
      module: mode.module,
      moduleResolution: mode.resolution,
      types: ['bun'],
      typeRoots: [join(root, 'node_modules', '@types')],
    };
    const consumerRoot = join(root, 'packages', 'auth-server');
    const positivePath = join(consumerRoot, `.dependency-positive.${mode.extension}`);
    const negativePath = join(consumerRoot, `.dependency-negative.${mode.extension}`);
    const fixtures = new Map([[positivePath, mode.positive], [negativePath, mode.negative]]);
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = fixtures.get(fileName);
      return source === undefined
        ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, source, languageVersion, true);
    };
    const program = ts.createProgram([...fixtures.keys()], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const format = (diagnostic: ts.Diagnostic) => ({
      code: diagnostic.code,
      file: diagnostic.file?.fileName,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    });
    const libraryDiagnostics = diagnostics.filter(diagnostic =>
      diagnostic.file === undefined || !fixtures.has(diagnostic.file.fileName));
    expect(libraryDiagnostics.map(format)).toEqual([]);
    expect(diagnostics.filter(diagnostic => diagnostic.file?.fileName === positivePath).map(format)).toEqual([]);

    const expected = mode.negative.split('\n').flatMap((line, index) => {
      const code = /\/\/ DIAGNOSTIC (\d+)$/.exec(line)?.[1];
      return code === undefined ? [] : [{ line: index + 1, code: Number(code) }];
    });
    expect(expected).toHaveLength(mode.expectedCount);
    const actual = diagnostics.filter(diagnostic => diagnostic.file?.fileName === negativePath)
      .map(diagnostic => ({
        line: diagnostic.file !== undefined && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
          : 0,
        code: diagnostic.code,
      }));
    expect(actual).toEqual(expected);

    const inputPaths = program.getSourceFiles().map(source => source.fileName.replaceAll('\\', '/'));
    for (const suffix of [
      ...mode.entries,
      `/drizzle-orm/postgres-js/session.d.${mode.extension}`,
      `/drizzle-orm/pg-core/query-builders/query.d.${mode.extension}`,
    ]) {
      expect(inputPaths.some(path => path.endsWith(suffix))).toBe(true);
    }
  }, 60_000);
}
