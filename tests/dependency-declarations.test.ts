import { expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '..');

const positive = `
import Elysia, { t } from "elysia";
import type { ComposeElysiaResponse, MacroToContext } from "elysia/types";
import type { SelectiveStatus } from "elysia/error";
import { SQL, type TransactionSQL } from "bun";
import { drizzle, type BunSQLDatabase } from "drizzle-orm/bun-sql";
import { BunSQLSession, BunSQLTransaction, type BunSQLQueryResultHKT } from "drizzle-orm/bun-sql/session";
import type { SQL as DrizzleSQL, SQLWrapper } from "drizzle-orm";
import { PgDialect, pgTable, integer } from "drizzle-orm/pg-core";
import type { PgRelationalQuery } from "drizzle-orm/pg-core/query-builders/query";
import type { PgSession } from "drizzle-orm/pg-core/session";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const users = pgTable("users", { id: integer().notNull() });
type Id = Assert<Equal<typeof users.$inferSelect.id, number>>;
declare const query: PgRelationalQuery<{ id: number }[]>;
const statement: DrizzleSQL = query.getSQL();
const wrapper: SQLWrapper = query;
type Disabled = MacroToContext<{ auth: { derive: () => { user: string } } }, { auth: false }>;
type DisabledDerive = Assert<Equal<Disabled["derive"], {}>>;
type DisabledReturn = Assert<Equal<Disabled["return"], {}>>;
type QuotedResponse = ComposeElysiaResponse<{ response: { 200: { id: number } } }, () => string, {}>;
type SchemaWins = Assert<Equal<QuotedResponse[200], { id: number }>>;
declare const quotedStatus: SelectiveStatus<{ 200: { id: number }; 404: { missing: true } }>;
const ok = quotedStatus(200, { id: 1 });
type StatusCode = Assert<Equal<typeof ok.status, 200>>;
quotedStatus("Not Found", { missing: true });
new Elysia().macro({ auth: { derive: () => ({ user: { id: 1 } }) } })
  .get("/selected", { auth: true }, ({ user }) => { type UserId = Assert<Equal<typeof user.id, number>>; return user.id; });
new Elysia().get("/quoted", { response: { 200: t.Object({ id: t.Number() }) } }, ({ status }) => status(200, { id: 1 }));
const app = new Elysia().model({ User: t.Object({ id: t.Number() }) });
const userModel: typeof app.models.User = app.models.User;
const modelKind: "Object" = app.models.User["~kind"];
declare const client: SQL;
const db: BunSQLDatabase = drizzle({ client });
const transactionResult: Promise<number> = client.begin(async () => 1);
declare const rootSession: BunSQLSession<SQL, {}, {}>;
const rootBase: PgSession<BunSQLQueryResultHKT, {}, {}> = rootSession;
const rootResult: Promise<number> = rootBase.transaction(async () => 1);
const nestedResult: Promise<number> = rootSession.transaction(async tx => tx.transaction(async () => 1));
declare const transactionView: BunSQLSession<TransactionSQL, {}, {}>;
transactionView.prepareQuery({ sql: "select 1", params: [] }, undefined, undefined, false);
new BunSQLTransaction(new PgDialect(), transactionView, undefined).transaction(async () => 1);
`;

const negative = `
import Elysia, { t } from "elysia";
import type { SelectiveStatus } from "elysia/error";
import type { SQL } from "drizzle-orm";
import { pgPolicy, pgRole } from "drizzle-orm/pg-core";
const wrongSql: SQL = 1; // DIAGNOSTIC 2322
new Elysia().macro({ auth: { derive: () => ({ user: { id: 1 } }) } })
  .get("/selected", { auth: true }, ({ user }) => { const wrong: string = user.id; return wrong; }); // DIAGNOSTIC 2322
new Elysia().macro({ auth: { derive: () => ({ user: { id: 1 } }) } })
  .get("/disabled", { auth: false }, context => context.user.id); // DIAGNOSTIC 2339
declare const quotedStatus: SelectiveStatus<{ 200: { id: number } }>;
quotedStatus(200, { id: "bad" }); // DIAGNOSTIC 2322
quotedStatus("200", { id: 1 }); // DIAGNOSTIC 2345
const app = new Elysia().model({ User: t.Object({ id: t.Number() }) });
const wrongModel: "Array" = app.models.User["~kind"]; // DIAGNOSTIC 2322
pgPolicy("invalid", { as: undefined }); // DIAGNOSTIC 2379
pgRole("invalid", { createDb: undefined }); // DIAGNOSTIC 2379
`;

it('checks installed declarations and rejects unsafe consumers', () => {
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
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['bun'],
    typeRoots: [join(root, 'node_modules', '@types')],
  };
  const consumerRoot = join(root, 'packages', 'auth-server');
  const positivePath = join(consumerRoot, '.dependency-positive.ts');
  const negativePath = join(consumerRoot, '.dependency-negative.ts');
  const fixtures = new Map([[positivePath, positive], [negativePath, negative]]);
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

  const expected = negative.split('\n').flatMap((line, index) => {
    const code = /\/\/ DIAGNOSTIC (\d+)$/.exec(line)?.[1];
    return code === undefined ? [] : [{ line: index + 1, code: Number(code) }];
  });
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
    '/elysia/dist/index.d.ts',
    '/drizzle-orm/bun-sql/session.d.ts',
    '/drizzle-orm/pg-core/query-builders/query.d.ts',
  ]) {
    expect(inputPaths.some(path => path.endsWith(suffix))).toBe(true);
  }
}, 60_000);