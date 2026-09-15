import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { Type, decodeSchema } from '../packages/shared/src/schema.js';

export interface PostgresAcceptanceResult {
  phase: 'postgres';
  status: 'passed' | 'failed' | 'blocked';
  checks: number;
  code: string;
}

export const POSTGRES_IMAGE = 'postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382';
export const OVERLAY_CASES = 10;
const LABEL = 'io.supauth.real-contract.run';
const ROOT = resolve(import.meta.dir, '..');
const DOCKER = '/usr/local/bin/docker';
const CONTEXT = 'orbstack';
const idSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
const runSchema = Type.String({ pattern: '^[a-f0-9]{32}$' });
const processSchema = Type.Object({
  exitCode: Type.Integer(),
  stdout: Type.String(),
  stderr: Type.String(),
  timedOut: Type.Boolean(),
});

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface PostgresRun {
  id: string;
  directory: string;
  home: string;
  password: string;
  bun: string;
}

export interface PostgresRuntime {
  command(args: string[], env: Record<string, string>, cleanup?: boolean): Promise<CommandResult>;
  readAllocatedId(): Promise<string | null>;
  verifyDatabase(url: string, runId: string): Promise<void>;
  pause(): Promise<void>;
  record?(event: PostgresEvidence): void;
}

type PostgresEvidence =
  | { stage: 'container_created' | 'container_removed'; id: string }
  | { stage: 'rls' | 'overlay'; exitCode: number; timedOut: boolean; passes: number | null;
      failures: number | null; executed: number | null; passLines: number; failLines: number;
      faults: string[] };

export function summarizePostgresTestOutput(result: CommandResult, stage: 'rls' | 'overlay'): PostgresEvidence {
  const output = `${result.stdout}\n${result.stderr}`;
  const number = (pattern: RegExp) => {
    const match = pattern.exec(output)?.[1];
    return match === undefined ? null : Number(match);
  };
  const faults = [
    { pattern: /Cannot find (?:package|module)|Could not resolve|ModuleNotFound/i, code: 'module_resolution' },
    { pattern: /SyntaxError|syntax error at or near/, code: 'syntax_error' },
    { pattern: /No tests found/, code: 'no_tests' },
    { pattern: /Connection refused|ECONNREFUSED/, code: 'connection_refused' },
    { pattern: /permission denied/, code: 'permission_denied' },
    { pattern: /does not exist/, code: 'missing_database_object' },
    { pattern: /toEqual|toBe|Expected:|Received:/, code: 'assertion_mismatch' },
    { pattern: /unknown option|unrecognized option|Could not find.*config/i, code: 'cli_configuration' },
    { pattern: /missing_postgres_constraint_error/, code: 'postgres_error_identity' },
  ].filter(fault => fault.pattern.test(output)).map(fault => fault.code);
  return {
    stage, exitCode: result.exitCode, timedOut: result.timedOut,
    passes: number(/^\s*(\d+) pass\s*$/m), failures: number(/^\s*(\d+) fail\s*$/m),
    executed: number(/^Ran (\d+) tests across 1 file\./m),
    passLines: [...output.matchAll(/^\(pass\) .+$/gm)].length,
    failLines: [...output.matchAll(/^\(fail\) .+$/gm)].length,
    faults,
  };
}

export function postgresSqlState(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const candidates = [error, error.cause];
  for (const candidate of candidates) {
    if (candidate instanceof Error && 'code' in candidate
      && typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return candidate.code;
    }
  }
  return null;
}

function json(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new Error('invalid_evidence');
  }
}

export function postgresChildEnvironment(home: string): Record<string, string> {
  return {
    HOME: home,
    PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    TZ: 'UTC',
    LANG: 'C.UTF-8',
  };
}

export function verifyLocalDockerContext(text: string, home: string): void {
  const endpoint = decodeSchema(Type.String(), json(text));
  if (endpoint !== `unix://${join(home, '.orbstack/run/docker.sock')}`) {
    throw new Error('docker_context_not_local');
  }
}

export function verifyOwnedContainer(text: string, id: string, runId: string): void {
  const evidence = decodeSchema(Type.Object({
    id: idSchema,
    name: Type.String(),
    image: Type.String(),
    labels: Type.Record(Type.String(), Type.String()),
    tmpfs: Type.Record(Type.String(), Type.String()),
    privileged: Type.Boolean(),
    binds: Type.Union([Type.Null(), Type.Array(Type.String())]),
  }), json(text));
  if (evidence.id !== id || evidence.name !== `/supauth-contract-${runId}`
    || evidence.image !== POSTGRES_IMAGE || evidence.labels[LABEL] !== runId
    || evidence.privileged || (evidence.binds !== null && evidence.binds.length !== 0)
    || Object.keys(evidence.tmpfs).length !== 1
    || !Object.hasOwn(evidence.tmpfs, '/var/lib/postgresql')) {
    throw new Error('container_ownership_mismatch');
  }
}

export function parsePostgresPort(text: string): number {
  const ports = decodeSchema(Type.Array(Type.Object({
    HostIp: Type.Literal('127.0.0.1'),
    HostPort: Type.String({ pattern: '^[1-9][0-9]{0,4}$' }),
  }), { minItems: 1, maxItems: 1 }), json(text));
  const port = Number(ports[0]?.HostPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port');
  return port;
}

export function parsePostgresTestCount(result: CommandResult, expected: number): number {
  const checked = decodeSchema(processSchema, result);
  if (checked.exitCode !== 0 || checked.timedOut) throw new Error('tests_failed');
  // 同时核对逐项 PASS、汇总和实际执行数；缺失、重复汇总及 skip 都不能变绿。
  const output = `${checked.stdout}\n${checked.stderr}`;
  const passed = [...output.matchAll(/^\s*(\d+) pass\s*$/gm)];
  const failed = [...output.matchAll(/^\s*(\d+) fail\s*$/gm)];
  const ran = [...output.matchAll(/^Ran (\d+) tests across 1 file\..*$/gm)];
  const cases = [...output.matchAll(/^\(pass\) .+$/gm)];
  if (passed.length !== 1 || failed.length !== 1 || ran.length !== 1
    || Number(passed[0]?.[1]) !== expected || Number(failed[0]?.[1]) !== 0
    || Number(ran[0]?.[1]) !== expected || cases.length !== expected
    || /^\s*\d+ (?:skip|todo)|^\((?:skip|todo|fail)\)/m.test(output)) {
    throw new Error('test_count_mismatch');
  }
  return expected;
}

export function postgresDatabaseName(runId: string): string {
  return `supa_${decodeSchema(runSchema, runId)}_authorization_test`;
}

export function verifyPostgresTarget(urlText: string, runId: string): URL {
  let url: URL;
  try { url = new URL(urlText); }
  catch { throw new Error('database_target_mismatch'); }
  if (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1'
    || !/^[1-9][0-9]{0,4}$/.test(url.port) || Number(url.port) > 65535
    || url.pathname !== `/${postgresDatabaseName(runId)}`
    || url.username !== 'postgres' || !url.password || url.search || url.hash) {
    throw new Error('database_target_mismatch');
  }
  return url;
}

const inspectOwnership = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},'
  + '"labels":{{json .Config.Labels}},"tmpfs":{{json .HostConfig.Tmpfs}},'
  + '"privileged":{{json .HostConfig.Privileged}},"binds":{{json .HostConfig.Binds}}}';

export async function executePostgresAcceptance(
  run: PostgresRun,
  runtime: PostgresRuntime,
): Promise<PostgresAcceptanceResult> {
  let status: PostgresAcceptanceResult['status'] = 'blocked';
  let code = 'preflight_failed';
  let checks = 0;
  let containerId: string | null = null;
  let allocationAttempted = false;
  const env = postgresChildEnvironment(run.home);
  const docker = async (args: string[], cleanup = false) => {
    const result = decodeSchema(processSchema, await runtime.command(
      [DOCKER, '--context', CONTEXT, ...args], env, cleanup,
    ));
    if (result.exitCode !== 0 || result.timedOut) throw new Error('docker_command_failed');
    return result.stdout.trim();
  };
  try {
    decodeSchema(runSchema, run.id);
    code = 'docker_context_unavailable';
    verifyLocalDockerContext(await docker(['context', 'inspect', CONTEXT, '--format', '{{json .Endpoints.docker.Host}}']), run.home);
    code = 'postgres_image_unavailable';
    const digests = decodeSchema(Type.Array(Type.String()), json(
      await docker(['image', 'inspect', POSTGRES_IMAGE, '--format', '{{json .RepoDigests}}']),
    ));
    if (!digests.includes(POSTGRES_IMAGE)) throw new Error('image_mismatch');
    const database = postgresDatabaseName(run.id);
    status = 'failed';
    code = 'container_allocation_failed';
    allocationAttempted = true;
    const created = await docker([
      'create', '--pull=never', '--name', `supauth-contract-${run.id}`,
      '--label', `${LABEL}=${run.id}`, '--cidfile', join(run.directory, 'container.id'),
      '--env-file', join(run.directory, 'postgres.env'),
      '--tmpfs', '/var/lib/postgresql:rw,noexec,nosuid,size=536870912',
      '--publish', '127.0.0.1::5432', '--memory', '768m', '--cpus', '1',
      '--restart=no', '--stop-timeout', '5', POSTGRES_IMAGE,
      'postgres', '-c', `real_contract.run_id=${run.id}`,
    ]);
    containerId = decodeSchema(idSchema, created);
    const recordedId = await runtime.readAllocatedId();
    if (recordedId?.trim() !== containerId) throw new Error('allocation_id_mismatch');
    runtime.record?.({ stage: 'container_created', id: containerId });
    code = 'container_ownership_mismatch';
    verifyOwnedContainer(await docker(['inspect', containerId, '--format', inspectOwnership]), containerId, run.id);
    code = 'container_start_failed';
    await docker(['start', containerId]);
    code = 'database_not_ready';
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await runtime.command(
        [DOCKER, '--context', CONTEXT, 'exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', database],
        env,
      );
      if (result.timedOut) throw new Error('readiness_timeout');
      if (result.exitCode === 0) { ready = true; break; }
      await runtime.pause();
    }
    if (!ready) throw new Error('readiness_timeout');
    code = 'database_target_mismatch';
    const port = parsePostgresPort(await docker([
      'inspect', containerId, '--format', '{{json (index .NetworkSettings.Ports "5432/tcp")}}',
    ]));
    const target = new URL(`postgres://postgres@127.0.0.1:${port}/${database}`);
    target.password = run.password;
    verifyPostgresTarget(target.href, run.id);
    await runtime.verifyDatabase(target.href, run.id);

    const childEnv = {
      ...postgresChildEnvironment(run.directory),
      RUN_AUTHORIZATION_POSTGRES_TESTS: '1',
      AUTHORIZATION_POSTGRES_URL: target.href,
      REAL_CONTRACT_POSTGRES_RUN: run.id,
      SUPACLOUD_DATABASE_URL: target.href,
    };
    for (const suite of [
      { file: 'packages/authorization-postgres/src/postgres.integration.test.ts', count: 15, code: 'rls_tests_failed', stage: 'rls' },
      { file: 'tests/integration/real-contract-postgres-overlay.test.ts', count: OVERLAY_CASES, code: 'overlay_tests_failed', stage: 'overlay' },
    ] satisfies Array<{ file: string; count: number; code: string; stage: 'rls' | 'overlay' }>) {
      code = suite.code;
      const result = await runtime.command([
        run.bun, 'test', '--no-env-file', '--no-install', '--no-orphans',
        `--config=${join(run.directory, 'bunfig.toml')}`, '--isolate', '--timeout=30000',
        join(ROOT, suite.file),
      ], childEnv);
      runtime.record?.(summarizePostgresTestOutput(result, suite.stage));
      checks += parsePostgresTestCount(result, suite.count);
    }
    code = 'postgres_contracts_passed';
    status = 'passed';
  } catch {
    // Docker/SQL/测试原始输出可能含凭据；只返回固定阶段码。
  } finally {
    try {
      if (!containerId && allocationAttempted) {
        const recordedId = await runtime.readAllocatedId();
        if (recordedId) containerId = decodeSchema(idSchema, recordedId.trim());
        else throw new Error('allocation_unconfirmed');
      }
      if (containerId) {
        verifyOwnedContainer(
          await docker(['inspect', containerId, '--format', inspectOwnership], true), containerId, run.id,
        );
        await docker(['rm', '--force', containerId], true);
        const remaining = await docker(['ps', '-aq', '--no-trunc', '--filter', `id=${containerId}`], true);
        if (remaining) throw new Error('container_remains');
        runtime.record?.({ stage: 'container_removed', id: containerId });
      }
    } catch {
      status = 'failed';
      code = 'cleanup_failed';
    }
  }
  return { phase: 'postgres', status, checks, code };
}

async function verifyDatabase(url: string, runId: string): Promise<void> {
  verifyPostgresTarget(url, runId);
  const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT current_database() AS database, current_user AS username,
        current_setting('real_contract.run_id') AS run_id,
        current_setting('server_version_num')::integer AS version
    `;
    const schema = Type.Object({
      database: Type.Literal(postgresDatabaseName(runId)),
      username: Type.Literal('postgres'), run_id: Type.Literal(runId),
      version: Type.Integer({ minimum: 180000, maximum: 189999 }),
    });
    if (rows.length !== 1) throw new Error('database_target_mismatch');
    decodeSchema(schema, rows[0]);
  } finally {
    await sql.end({ timeout: 3 });
  }
}

async function command(
  args: string[], env: Record<string, string>, directory: string, signal: AbortSignal, cleanup = false,
): Promise<CommandResult> {
  const child = Bun.spawn(args, { cwd: directory, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const cancel = () => { timedOut = true; child.kill('SIGKILL'); };
  const timeout = setTimeout(cancel, args[0] === DOCKER ? 15_000 : 120_000);
  if (!cleanup) {
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  }
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

export async function runPostgresAcceptance(): Promise<PostgresAcceptanceResult> {
  let directory: string | undefined;
  let result: PostgresAcceptanceResult = { phase: 'postgres', status: 'blocked', checks: 0, code: 'runner_unavailable' };
  const abort = new AbortController();
  const cancel = () => abort.abort();
  const events: PostgresEvidence[] = [];
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    directory = await mkdtemp(join(tmpdir(), 'supauth-real-postgres-'));
    const workingDirectory = directory;
    const run: PostgresRun = {
      id: randomUUID().replaceAll('-', ''), password: randomBytes(32).toString('hex'),
      directory, home: homedir(), bun: process.execPath,
    };
    await writeFile(join(directory, 'postgres.env'),
      `POSTGRES_PASSWORD=${run.password}\nPOSTGRES_DB=${postgresDatabaseName(run.id)}\n`, { mode: 0o600 });
    await writeFile(join(directory, 'bunfig.toml'), '', { mode: 0o600 });
    result = await executePostgresAcceptance(run, {
      command: (args, env, cleanup) => command(args, env, workingDirectory, abort.signal, cleanup),
      readAllocatedId: async () => {
        try { return await readFile(join(workingDirectory, 'container.id'), 'utf8'); }
        catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
          throw error;
        }
      },
      verifyDatabase,
      pause: () => new Promise<void>(resolve => setTimeout(resolve, 500)),
      record: event => { events.push(event); },
    });
    await writeFile(join(tmpdir(), `supauth-real-postgres-evidence-${run.id}.json`),
      JSON.stringify({ result, runId: run.id, image: POSTGRES_IMAGE, events }), { mode: 0o600 });
  } catch {
    result = { phase: 'postgres', status: 'failed', checks: 0, code: 'runner_failed' };
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    if (directory) {
      try {
        await rm(join(directory, 'postgres.env'), { force: true });
        if (result.code === 'cleanup_failed') {
          await writeFile(join(directory, 'recovery.json'), JSON.stringify(result), { mode: 0o600 });
        } else {
          await rm(directory, { recursive: true, force: true });
        }
      } catch {
        result = { ...result, status: 'failed', code: 'local_cleanup_failed' };
      }
    }
  }
  return result;
}

if (import.meta.main) {
  const result = await runPostgresAcceptance();
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'passed' ? 0 : 1;
}
