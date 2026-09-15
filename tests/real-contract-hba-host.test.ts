import { describe, expect, test } from 'bun:test';
import {
  CONTRACT_HBA_RULES, effectiveConfigQuerySucceeded, executeHbaExchange, parsePostmasterArguments, parsePostmasterProcess,
  planContractHba, postmasterProofHash, validateEffectivePostgresPaths,
  type HbaExchangeIO, type HbaVersion, type PostmasterProof,
} from '../scripts/real-contract-hba-host.js';

describe('exact test-project platform HBA plan, no database connection', () => {
  test('preserves all original bytes and adds only two password-authenticated loopback rules', () => {
    const original = '# existing\nlocal all postgres ident\n';
    const plan = planContractHba(original);
    expect(plan.next.startsWith(original)).toBe(true);
    expect(plan.beforeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.afterHash).not.toBe(plan.beforeHash);
    const added = plan.next.slice(original.length).split('\n').filter(line => line && !line.startsWith('#'));
    expect(added).toEqual([...CONTRACT_HBA_RULES]);
    expect(added.every(line => /^host supa_npdxmbxmnnzkdqlwtizu (?:role|authenticator)_npdxmbxmnnzkdqlwtizu 127\.0\.0\.1\/32 scram-sha-256$/.test(line))).toBe(true);
  });
  test('does not grant a second write on rerun or overwrite an existing project rule', () => {
    const plan = planContractHba('# existing');
    expect(() => planContractHba(plan.next)).toThrow('HBA_INPUT_CONFLICT');
    expect(() => planContractHba(`${CONTRACT_HBA_RULES[0]}\n`)).toThrow('HBA_INPUT_CONFLICT');
  });
  test('rejects ambiguous or missing input', () => {
    for (const value of ['', '\0', '# windows\r\n']) {
      expect(() => planContractHba(value)).toThrow('HBA_INPUT_CONFLICT');
    }
  });
});

const executable = '/usr/pgsql-19/bin/postgres';
const pidFile = '98115\n/pg/data\n1788900000\n5432\n/var/run/postgresql\nlocalhost\n1 2\nready\n';
const processStatus = 'Name:\tpostgres\nUid:\t26\t26\t26\t26\nGid:\t26\t26\t26\t26\n';
const bootId = '12345678-1234-4123-8123-123456789abc';
function procStat(pid = '98115', ticks = '456789') {
  return `${pid} (postgres) S ${Array.from({ length: 18 }, () => '0').join(' ')} ${ticks} 0 0\n`;
}
function proof(): PostmasterProof {
  return {
    pid: 98115, startTimeTicks: '456789', pidFileStartTime: '1788900000', bootId,
    executable, executableIdentity: 'exe-inode',
    argvHash: 'argv-hash', directoryIdentity: 'directory-inode', pidFileIdentity: 'pidfile-inode',
    hbaFile: '/pg/data/pg_hba.conf', configFile: '/pg/data/postgresql.conf',
  };
}

describe('Postmaster and effective config proof, offline only', () => {
  test('accepts successful config queries with absent, undefined or null signalCode', () => {
    expect(effectiveConfigQuerySucceeded({ exitCode: 0, success: true })).toBe(true);
    expect(effectiveConfigQuerySucceeded({ exitCode: 0, success: true, signalCode: undefined })).toBe(true);
    expect(effectiveConfigQuerySucceeded({ exitCode: 0, success: true, signalCode: null })).toBe(true);
  });
  test('still rejects nonzero exit, false success and an actual termination signal', () => {
    expect(effectiveConfigQuerySucceeded({ exitCode: 1, success: true })).toBe(false);
    expect(effectiveConfigQuerySucceeded({ exitCode: 0, success: false })).toBe(false);
    expect(effectiveConfigQuerySucceeded({ exitCode: 0, success: true, signalCode: 'SIGHUP' })).toBe(false);
    expect(effectiveConfigQuerySucceeded({ exitCode: 1, success: false, signalCode: null })).toBe(false);
  });
  test('binds PID and starttime, not only the same numeric PID', () => {
    const current = parsePostmasterProcess({
      pidFile, processStat: procStat(), status: processStatus, bootId,
    });
    expect(current).toEqual({
      pid: 98115, startTimeTicks: '456789', pidFileStartTime: '1788900000', bootId,
    });
    expect(postmasterProofHash({ ...proof(), startTimeTicks: '456790' })).not.toBe(postmasterProofHash(proof()));
  });
  test('accepts only an exact -D pair and a matching executable argv', () => {
    expect(parsePostmasterArguments(
      `${executable}\0-D\0/pg/data\0-c\0config_file=/pg/data/postgresql.conf\0`, executable,
    )).toEqual(['-D', '/pg/data', '-c', 'config_file=/pg/data/postgresql.conf']);
  });
  test('accepts the actual Pigsty long options and verified argv0 symlink resolution', () => {
    const args = [
      '-D', '/pg/data', '--config-file=/pg/data/postgresql.conf',
      '--listen_addresses=0.0.0.0', '--port=5432', '--cluster_name=pg-meta',
      '--wal_level=logical', '--hot_standby=on', '--max_connections=500',
      '--max_wal_senders=50', '--max_prepared_transactions=0',
      '--max_locks_per_transaction=1000', '--track_commit_timestamp=on',
      '--max_replication_slots=50', '--max_worker_processes=24', '--wal_log_hints=on',
    ];
    const cmdline = `/usr/pgsql/bin/postgres\0${args.join('\0')}\0`;
    expect(parsePostmasterArguments(cmdline, executable, executable)).toEqual(args);
    expect(() => parsePostmasterArguments(cmdline, executable, '/other/postgres')).toThrow();
    expect(() => parsePostmasterArguments(cmdline, executable)).toThrow();
  });
  for (const suffix of [
    '--config-file=/tmp/alternate.conf', '--hba_file=/tmp/hba', '--shared_preload_libraries=other',
    '--port=5433', '--listen_addresses=example.com', '--cluster_name=other',
    '--max_connections=500 --single', '--max_connections=-1', '--unknown=1',
    '--config-file=/pg/data/postgresql.conf\0--config-file=/pg/data/postgresql.conf',
  ]) {
    test(`rejects unauthorized long option ${suffix.split('=')[0]}`, () => {
      expect(() => parsePostmasterArguments(`${executable}\0-D\0/pg/data\0${suffix}\0`, executable)).toThrow();
    });
  }
  for (const [index, cmdline] of [
    `${executable}\0-c\0some_setting=/pg/data\0`,
    `${executable}\0/pg/data\0`,
    `${executable}\0-D\0/pg/other\0`,
    `${executable}\0-D\0/pg/data\0-D\0/pg/data\0`,
    `${executable}\0-D\0/pg/data\0-C\0hba_file\0`,
    `${executable}\0-D\0/pg/data\0--single\0`,
    `/tmp/postgres\0-D\0/pg/data\0`,
    `${executable}\0-D\0/pg/data`,
  ].entries()) {
    test(`rejects ambiguous or different process arguments ${index}`, () => {
      expect(() => parsePostmasterArguments(cmdline, executable)).toThrow('POSTMASTER_ARGUMENTS_REJECTED');
    });
  }
  for (const [index, input] of [
    { pidFile: pidFile.replace('/pg/data', '/other'), processStat: procStat(), status: processStatus, bootId },
    { pidFile, processStat: procStat('98116'), status: processStatus, bootId },
    { pidFile, processStat: procStat('98115', '0'), status: processStatus, bootId },
    { pidFile, processStat: procStat().replace('postgres', 'other'), status: processStatus, bootId },
    { pidFile, processStat: procStat(), status: processStatus.replace('Uid:\t26', 'Uid:\t0'), bootId },
    { pidFile, processStat: procStat(), status: processStatus, bootId: 'not-a-boot-id' },
  ].entries()) {
    test(`rejects invalid proc/pidfile identities ${index}`, () => {
      expect(() => parsePostmasterProcess(input)).toThrow('POSTMASTER_IDENTITY_REJECTED');
    });
  }
  test('effective hba_file overrides cannot silently point to a different file', () => {
    const paths = {
      hbaFile: '/pg/data/pg_hba.conf', dataDirectory: '/pg/data', configFile: '/pg/data/postgresql.conf',
    };
    expect(() => validateEffectivePostgresPaths(paths)).not.toThrow();
    expect(() => validateEffectivePostgresPaths({ ...paths, hbaFile: '/etc/postgresql/pg_hba.conf' })).toThrow();
    expect(() => validateEffectivePostgresPaths({ ...paths, dataDirectory: '/other/data' })).toThrow();
    expect(() => validateEffectivePostgresPaths({ ...paths, configFile: '../postgresql.conf' })).toThrow();
  });
});

function fixture(mode: 'apply' | 'rollback' = 'apply') {
  const before = '# original HBA\nlocal all postgres ident\n';
  const planned = planContractHba(before);
  const files = new Map<string, HbaVersion>();
  files.set('active', { text: mode === 'apply' ? before : planned.next, identity: 'original-inode' });
  if (mode === 'rollback') files.set('backup', { text: before, identity: 'backup-inode' });
  const events: Array<{ phase: string; beforeHash: string; afterHash: string; retainedPath: string | null }> = [];
  const state = {
    reads: 0, exchanges: 0, signals: 0,
    events,
    beforeExchange: () => {},
    afterExchange: () => {},
    onReadPostmaster: (_count: number): PostmasterProof => proof(),
    onRecord: (_phase: string) => {},
    onSignal: () => {},
  };
  function read(path: string): HbaVersion {
    const value = files.get(path);
    if (!value) throw new Error('MISSING_FIXTURE');
    return { ...value };
  }
  const io: HbaExchangeIO = {
    async readPostmaster() { return state.onReadPostmaster(++state.reads); },
    async readActive() { return read('active'); },
    async readBackup() { return read('backup'); },
    async saveBackup(text) {
      if (files.has('backup')) throw new Error('BACKUP_EXISTS');
      files.set('backup', { text, identity: 'backup-inode' });
    },
    async stage(text, original) {
      files.set('retained.before', { text: original, identity: 'before-inode' });
      files.set('retained.candidate', { text, identity: 'candidate-image-inode' });
      files.set('retained.exchange', { text, identity: 'candidate-inode' });
      return 'retained.exchange';
    },
    async readStage(path) { return read(path); },
    exchange(path) {
      state.beforeExchange();
      const current = read('active');
      const candidate = read(path);
      files.set('active', candidate);
      files.set(path, current);
      state.exchanges++;
      state.afterExchange();
    },
    async sync() {},
    async record(event) {
      state.onRecord(event.phase);
      state.events.push(event);
    },
    signalBoundPostmaster() { state.onSignal(); state.signals++; },
  };
  const request = {
    mode, expectedHash: mode === 'apply' ? planned.beforeHash : planned.afterHash,
    expectedPostmasterHash: postmasterProofHash(proof()), maintenanceExclusive: true,
  };
  return { io, state, files, request, before, planned, read };
}

describe('retaining atomic-exchange protocol with injected native operation, no live HBA', () => {
  for (const mode of ['apply', 'rollback'] as const) {
    test(`${mode} retains expected, candidate and displaced versions before pidfd signal`, async () => {
      const f = fixture(mode);
      const old = f.read('active');
      const result = await executeHbaExchange(f.io, f.request);
      expect(f.read('retained.exchange')).toEqual(old);
      expect(f.read('retained.before').text).toBe(old.text);
      expect(f.read('active').text).toBe(mode === 'apply' ? f.planned.next : f.before);
      expect(f.read('retained.candidate').text).toBe(f.read('active').text);
      expect(f.state.exchanges).toBe(1);
      expect(f.state.signals).toBe(1);
      expect(result.runtimeAcceptancePassed).toBe(false);
      expect(f.state.events.at(-1)?.phase).toBe('signal-sent-not-runtime-acceptance');
    });
    test(`${mode} detects the compare/exchange race and preserves the foreign version without signal`, async () => {
      const f = fixture(mode);
      const foreign = { text: '# concurrent operator edit\n', identity: 'foreign-inode' };
      f.state.beforeExchange = () => { f.files.set('active', foreign); };
      await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('HBA_EXCHANGE_CONFLICT');
      expect(f.read('retained.exchange')).toEqual(foreign);
      expect(f.read('retained.before').text).toBe(mode === 'apply' ? f.before : f.planned.next);
      expect(f.read('retained.candidate').text).toBe(f.read('active').text);
      expect(f.state.exchanges).toBe(1);
      expect(f.state.signals).toBe(0);
      expect(f.state.events.at(-1)?.phase).toBe('exchange-conflict-no-signal');
    });
    test(`${mode} detects identical bytes in a concurrently replaced inode`, async () => {
      const f = fixture(mode);
      f.state.beforeExchange = () => { f.files.set('active', { ...f.read('active'), identity: 'other-inode' }); };
      await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('HBA_EXCHANGE_CONFLICT');
      expect(f.state.signals).toBe(0);
      expect(f.read('retained.exchange').identity).toBe('other-inode');
    });
  }
  test('rejects missing exclusive-maintenance acknowledgement before any IO', async () => {
    const f = fixture();
    await expect(executeHbaExchange(f.io, { ...f.request, maintenanceExclusive: false }))
      .rejects.toThrow('HBA_MAINTENANCE_WINDOW_REQUIRED');
    expect(f.state.reads).toBe(0);
  });
  test('rejects stale content and process plan hashes before staging', async () => {
    const f = fixture();
    await expect(executeHbaExchange(f.io, { ...f.request, expectedHash: '0'.repeat(64) }))
      .rejects.toThrow('HBA_EXPECTED_HASH_MISMATCH');
    await expect(executeHbaExchange(f.io, { ...f.request, expectedPostmasterHash: '0'.repeat(64) }))
      .rejects.toThrow('POSTMASTER_PLAN_MISMATCH');
    expect(f.files.has('retained.exchange')).toBe(false);
    expect(f.state.exchanges).toBe(0);
  });
  const changedProofs: PostmasterProof[] = [
    { ...proof(), startTimeTicks: '999999' },
    { ...proof(), bootId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { ...proof(), executableIdentity: 'replaced-executable' },
    { ...proof(), executable: '/other/postgres' },
    { ...proof(), argvHash: 'different-arguments' },
    { ...proof(), directoryIdentity: 'replaced-directory' },
    { ...proof(), pidFileIdentity: 'replaced-pidfile' },
    { ...proof(), hbaFile: '/other/pg_hba.conf' },
    { ...proof(), configFile: '/other/postgresql.conf' },
  ];
  for (const [index, changed] of changedProofs.entries()) {
    test(`rejects changed process/config identity before exchange ${index}`, async () => {
      const f = fixture();
      f.state.onReadPostmaster = count => count >= 2 ? changed : proof();
      await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('POSTMASTER_CHANGED_BEFORE_WRITE');
      expect(f.state.exchanges).toBe(0);
      expect(f.state.signals).toBe(0);
    });
  }
  test('same numeric PID with changed starttime after exchange is never signalled', async () => {
    const f = fixture();
    f.state.onReadPostmaster = count => count >= 3 ? { ...proof(), startTimeTicks: '999999' } : proof();
    await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('POSTMASTER_CHANGED_BEFORE_SIGNAL');
    expect(f.state.exchanges).toBe(1);
    expect(f.state.signals).toBe(0);
    expect(f.read('retained.exchange').text).toBe(f.before);
  });
  test('a third-party post-exchange edit does not get overwritten by automatic rollback', async () => {
    const f = fixture();
    const third = { text: '# subsequent operator version\n', identity: 'third-inode' };
    f.state.afterExchange = () => { f.files.set('active', third); };
    await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('HBA_ACTIVE_CHANGED_AFTER_EXCHANGE');
    expect(f.read('active')).toEqual(third);
    expect(f.read('retained.candidate').text).toBe(f.planned.next);
    expect(f.read('retained.exchange').text).toBe(f.before);
    expect(f.state.exchanges).toBe(1);
    expect(f.state.signals).toBe(0);
  });
  test('journal failure before exchange does not change active HBA', async () => {
    const f = fixture();
    f.state.onRecord = phase => { if (phase === 'exchange-intent') throw new Error('AUDIT_FAILED'); };
    await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('AUDIT_FAILED');
    expect(f.read('active').text).toBe(f.before);
    expect(f.state.signals).toBe(0);
  });
  test('journal failure after exchange retains both images and sends no signal', async () => {
    const f = fixture();
    f.state.onRecord = phase => { if (phase === 'signal-intent') throw new Error('AUDIT_FAILED'); };
    await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('AUDIT_FAILED');
    expect(f.read('retained.exchange').text).toBe(f.before);
    expect(f.read('active').text).toBe(f.planned.next);
    expect(f.state.signals).toBe(0);
  });
  test('pidfd failure never falls back to signalling a numeric PID', async () => {
    const f = fixture();
    f.state.onSignal = () => { throw new Error('POSTMASTER_SIGNAL_FAILED'); };
    await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('POSTMASTER_SIGNAL_FAILED');
    expect(f.state.signals).toBe(0);
    expect(f.state.events.at(-1)?.phase).toBe('signal-intent');
    expect(f.read('retained.exchange').text).toBe(f.before);
  });
  test('rollback refuses unrelated changes instead of reconstructing an old HBA', async () => {
    const f = fixture('rollback');
    f.files.set('backup', { text: '# different original\n', identity: 'other-backup' });
    await expect(executeHbaExchange(f.io, f.request)).rejects.toThrow('HBA_ROLLBACK_CONFLICT');
    expect(f.state.exchanges).toBe(0);
  });
});
