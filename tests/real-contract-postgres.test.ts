import { describe, expect, test } from 'bun:test';
import {
  OVERLAY_CASES, POSTGRES_IMAGE, executePostgresAcceptance, parsePostgresPort,
  parsePostgresTestCount, postgresChildEnvironment, postgresDatabaseName,
  verifyLocalDockerContext, verifyOwnedContainer, verifyPostgresTarget,
  summarizePostgresTestOutput,
  postgresSqlState,
  type CommandResult, type PostgresRun, type PostgresRuntime,
} from '../scripts/real-contract-postgres.js';

const run: PostgresRun = {
  id: 'a'.repeat(32), password: 'synthetic-password', directory: '/tmp/fake-postgres-run',
  home: '/Users/test', bun: '/test/bun',
};
const containerId = 'b'.repeat(64);
const label = 'io.supauth.real-contract.run';

function success(stdout = ''): CommandResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function testOutput(count: number): string {
  return `${Array.from({ length: count }, (_, index) => `(pass) test ${index}`).join('\n')}
 ${count} pass
 0 fail
Ran ${count} tests across 1 file. [100ms]
`;
}

function ownership(id = containerId, runId = run.id): string {
  return JSON.stringify({
    id, name: `/supauth-contract-${runId}`, image: POSTGRES_IMAGE, labels: { [label]: runId },
    tmpfs: { '/var/lib/postgresql': 'rw,noexec,nosuid,size=536870912' }, privileged: false, binds: null,
  });
}

function fakeRuntime(
  transform: (args: string[], result: CommandResult, cleanup: boolean) => CommandResult = (_args, result) => result,
) {
  const calls: Array<{ args: string[]; env: Record<string, string>; cleanup: boolean }> = [];
  let allocated = false;
  let verifiedDatabase = false;
  const runtime: PostgresRuntime = {
    command: async (args, env, cleanup = false) => {
      calls.push({ args, env, cleanup });
      let response = success();
      if (args[0] === run.bun) {
        response = success(testOutput(args.some(arg => arg.endsWith('postgres.integration.test.ts')) ? 15 : OVERLAY_CASES));
      } else if (args[3] === 'context') {
        response = success(JSON.stringify('unix:///Users/test/.orbstack/run/docker.sock'));
      } else if (args[3] === 'image') {
        response = success(JSON.stringify([POSTGRES_IMAGE]));
      } else if (args[3] === 'create') {
        allocated = true;
        response = success(containerId);
      } else if (args[3] === 'inspect') {
        response = success(args.some(arg => arg.includes('NetworkSettings'))
          ? JSON.stringify([{ HostIp: '127.0.0.1', HostPort: '34567' }]) : ownership());
      }
      return transform(args, response, cleanup);
    },
    readAllocatedId: async () => allocated ? containerId : null,
    verifyDatabase: async (url, runId) => {
      verifyPostgresTarget(url, runId);
      verifiedDatabase = true;
    },
    pause: async () => {},
  };
  return { runtime, calls, verified: () => verifiedDatabase };
}

describe('real PostgreSQL acceptance safety', () => {
  test('only the exact local OrbStack socket is accepted', () => {
    expect(() => verifyLocalDockerContext(JSON.stringify('unix:///Users/test/.orbstack/run/docker.sock'), run.home)).not.toThrow();
    for (const value of ['ssh://host', 'tcp://127.0.0.1:2375', 'unix:///var/run/docker.sock', 'unix:///another/socket', {}]) {
      expect(() => verifyLocalDockerContext(JSON.stringify(value), run.home)).toThrow();
    }
  });

  test('container ownership requires exact ID, run label, image and isolated mounts', () => {
    expect(() => verifyOwnedContainer(ownership(), containerId, run.id)).not.toThrow();
    expect(() => verifyOwnedContainer(ownership('c'.repeat(64)), containerId, run.id)).toThrow();
    expect(() => verifyOwnedContainer(ownership(containerId, 'd'.repeat(32)), containerId, run.id)).toThrow();
    for (const changed of [
      { image: 'postgres:latest' }, { labels: {} }, { privileged: true },
      { binds: ['/host:/var/lib/postgresql'] }, { tmpfs: {} },
    ]) {
      const source: unknown = JSON.parse(ownership());
      if (typeof source !== 'object' || source === null) throw new Error('invalid_fixture');
      expect(() => verifyOwnedContainer(JSON.stringify({ ...source, ...changed }), containerId, run.id)).toThrow();
    }
  });

  test('published database port must be a single valid IPv4 loopback binding', () => {
    expect(parsePostgresPort(JSON.stringify([{ HostIp: '127.0.0.1', HostPort: '34567' }]))).toBe(34567);
    for (const candidate of [
      [], null, [{ HostIp: '0.0.0.0', HostPort: '34567' }],
      [{ HostIp: '127.0.0.1', HostPort: '0' }], [{ HostIp: '127.0.0.1', HostPort: '99999' }],
      [{ HostIp: '127.0.0.1', HostPort: '3000' }, { HostIp: '::', HostPort: '3000' }],
    ]) expect(() => parsePostgresPort(JSON.stringify(candidate))).toThrow();
  });

  test('database target must match the run, local port and explicit identity with no URL overrides', () => {
    const target = `postgres://postgres:synthetic@127.0.0.1:34567/${postgresDatabaseName(run.id)}`;
    expect(verifyPostgresTarget(target, run.id).hostname).toBe('127.0.0.1');
    for (const invalid of [
      target.replace('127.0.0.1', 'db.example.test'), target.replace('34567', '99999'),
      target.replace(run.id, 'f'.repeat(32)), target.replace('postgres:synthetic@', 'another:synthetic@'),
      `${target}?host=elsewhere`, `${target}#fragment`, target.replace(':synthetic@', '@'),
    ]) expect(() => verifyPostgresTarget(invalid, run.id)).toThrow();
    expect(() => postgresDatabaseName('unvalidated-name')).toThrow();
    try {
      verifyPostgresTarget('private-password-not-a-url', run.id);
      throw new Error('expected_target_rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toBe('database_target_mismatch');
      expect(error.message).not.toContain('private-password');
    }
  });

  test('child environment is an explicit allowlist without inherited DB or auth credentials', () => {
    expect(Object.keys(postgresChildEnvironment(run.home)).sort()).toEqual([
      'FORCE_COLOR', 'HOME', 'LANG', 'NO_COLOR', 'PATH', 'TZ',
    ]);
  });

  test('test evidence requires pass lines, matching summary and matching executed count', () => {
    expect(parsePostgresTestCount(success(testOutput(15)), 15)).toBe(15);
    for (const invalid of [
      '', '0 pass\n0 fail\n', testOutput(14), testOutput(16),
      testOutput(15).replace('(pass)', '(skip)'),
      `${testOutput(15)} 1 skip\n`, `${testOutput(15)} 0 todo\n`,
      `${testOutput(15)} 15 pass\n`, testOutput(15).replace('across 1 file', 'across 2 files'),
      testOutput(15).replace(' 0 fail', ' 1 fail'),
    ]) expect(() => parsePostgresTestCount(success(invalid), 15)).toThrow();
    expect(() => parsePostgresTestCount({ ...success(testOutput(15)), exitCode: 1 }, 15)).toThrow();
    expect(() => parsePostgresTestCount({ ...success(testOutput(15)), timedOut: true }, 15)).toThrow();
  });

  test('failure evidence contains only numeric facts and fixed diagnostic categories', () => {
    const result = summarizePostgresTestOutput({
      exitCode: 1, timedOut: false, stdout: '',
      stderr: 'Cannot find module private-password\n0 pass\n1 fail\n',
    }, 'rls');
    expect(JSON.stringify(result)).not.toContain('private-password');
    expect(result).toMatchObject({ stage: 'rls', faults: ['module_resolution'], passes: 0, failures: 1 });
  });

  test('SQLSTATE accepts real Error boundaries across driver copies but rejects invented error shapes', () => {
    const driverError = Object.assign(new Error('synthetic constraint'), { code: '23505' });
    expect(postgresSqlState(driverError)).toBe('23505');
    expect(postgresSqlState(new Error('query failed', { cause: driverError }))).toBe('23505');
    expect(postgresSqlState({ code: '23505' })).toBeNull();
    expect(postgresSqlState(Object.assign(new Error('bad code'), { code: 'private-value' }))).toBeNull();
    expect(postgresSqlState(null)).toBeNull();
  });

  test('successful lifecycle runs the two required suites and removes only its verified ID', async () => {
    const fake = fakeRuntime();
    expect(await executePostgresAcceptance(run, fake.runtime)).toEqual({
      phase: 'postgres', status: 'passed', checks: 25, code: 'postgres_contracts_passed',
    });
    expect(fake.verified()).toBe(true);
    const create = fake.calls.find(call => call.args[3] === 'create');
    expect(create?.args).toContain('--pull=never');
    expect(create?.args).toContain('127.0.0.1::5432');
    expect(create?.args).toContain(`${label}=${run.id}`);
    const children = fake.calls.filter(call => call.args[0] === run.bun);
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.args).toContain('--no-env-file');
      expect(child.args).toContain('--isolate');
      expect(child.args[1]).toBe('test');
      expect(child.args).toContain('--no-install');
      expect(child.args.join(' ')).not.toContain(run.password);
      expect(child.env['DATABASE_URL']).toBeUndefined();
      expect(child.env['PGPASSWORD']).toBeUndefined();
      expect(child.env['AUTHORIZATION_POSTGRES_URL']).toContain(`/${postgresDatabaseName(run.id)}`);
    }
    const removal = fake.calls.filter(call => call.args[3] === 'rm');
    expect(removal.map(call => call.args.slice(3))).toEqual([['rm', '--force', containerId]]);
    expect(removal.every(call => call.cleanup)).toBe(true);
  });

  test('missing cached image blocks before allocating any container', async () => {
    const fake = fakeRuntime((args, result) => args[3] === 'image' ? { ...result, exitCode: 1 } : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({
      status: 'blocked', checks: 0, code: 'postgres_image_unavailable',
    });
    expect(fake.calls.some(call => call.args[3] === 'create' || call.args[3] === 'rm')).toBe(false);
  });

  test('nonlocal context blocks before Docker allocation', async () => {
    const fake = fakeRuntime((args, result) => args[3] === 'context' ? success(JSON.stringify('ssh://remote')) : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({ status: 'blocked', checks: 0 });
    expect(fake.calls).toHaveLength(1);
  });

  test('ownership mismatch refuses start, SQL and cleanup of an unproven target', async () => {
    const fake = fakeRuntime((args, result) => args[3] === 'inspect' ? success(ownership('c'.repeat(64))) : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({ status: 'failed', code: 'cleanup_failed' });
    expect(fake.verified()).toBe(false);
    expect(fake.calls.some(call => call.args[3] === 'rm' || call.args[3] === 'start')).toBe(false);
  });

  test('failed allocation with an owned CID is reconciled before cleanup', async () => {
    const fake = fakeRuntime((args, result) => args[3] === 'create'
      ? { ...result, exitCode: 1, stdout: '', stderr: 'private-database-url' } : result);
    const result = await executePostgresAcceptance(run, fake.runtime);
    expect(result).toMatchObject({ status: 'failed', checks: 0, code: 'container_allocation_failed' });
    expect(fake.calls.filter(call => call.args[3] === 'rm')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('private-database-url');
  });

  test('unready database fails boundedly and still cleans its container', async () => {
    const fake = fakeRuntime((args, result) => args[3] === 'exec' ? { ...result, exitCode: 1 } : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({
      status: 'failed', checks: 0, code: 'database_not_ready',
    });
    expect(fake.calls.filter(call => call.args[3] === 'exec')).toHaveLength(30);
    expect(fake.calls.filter(call => call.args[3] === 'rm')).toHaveLength(1);
    expect(fake.verified()).toBe(false);
  });

  test('database identity mismatch cannot reach either destructive test suite', async () => {
    const fake = fakeRuntime();
    fake.runtime.verifyDatabase = async () => { throw new Error('identity_mismatch'); };
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({ status: 'failed', code: 'database_target_mismatch' });
    expect(fake.calls.some(call => call.args[0] === run.bun)).toBe(false);
    expect(fake.calls.filter(call => call.args[3] === 'rm')).toHaveLength(1);
  });

  test('skipped RLS suite cannot pass or proceed to overlay', async () => {
    const fake = fakeRuntime((args, result) => args[0] === run.bun ? success('0 pass\n15 skip\n0 fail\n') : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({
      status: 'failed', checks: 0, code: 'rls_tests_failed',
    });
    expect(fake.calls.filter(call => call.args[0] === run.bun)).toHaveLength(1);
    expect(fake.calls.filter(call => call.args[3] === 'rm')).toHaveLength(1);
  });

  test('overlay timeout keeps only the completed RLS count and performs cleanup', async () => {
    const fake = fakeRuntime((args, result) => args.some(arg => arg.endsWith('real-contract-postgres-overlay.test.ts'))
      ? { ...result, timedOut: true } : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({
      status: 'failed', checks: 15, code: 'overlay_tests_failed',
    });
    expect(fake.calls.filter(call => call.args[3] === 'rm')).toHaveLength(1);
  });

  test('cleanup failure overrides successful checks and never reports passed', async () => {
    const fake = fakeRuntime((args, result) => args[3] === 'rm' ? { ...result, exitCode: 1 } : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toEqual({
      phase: 'postgres', status: 'failed', checks: 25, code: 'cleanup_failed',
    });
  });

  test('a container remaining after removal is reported as cleanup failure', async () => {
    const fake = fakeRuntime((args, result) => args[3] === 'ps' ? success(containerId) : result);
    expect(await executePostgresAcceptance(run, fake.runtime)).toMatchObject({ status: 'failed', code: 'cleanup_failed' });
  });
});
