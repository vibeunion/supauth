#!/usr/bin/env bun
import { dlopen, FFIType } from 'bun:ffi';
import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { open, readFile, readlink, realpath, stat } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

const PROJECT = 'npdxmbxmnnzkdqlwtizu';
const RUN = '7a91e5ac-961d-4537-9f79-901c50f214db';
const HBA = '/pg/data/pg_hba.conf';
const DATA = '/pg/data';
const BACKUP = `${HBA}.supauth-contract-${RUN}.bak`;
const MARKER = `# supauth-contract-${RUN}: temporary platform loopback access`;
export const CONTRACT_HBA_RULES = [
  `host supa_${PROJECT} role_${PROJECT} 127.0.0.1/32 scram-sha-256`,
  `host supa_${PROJECT} authenticator_${PROJECT} 127.0.0.1/32 scram-sha-256`,
] as const;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function planContractHba(current: string) {
  if (!current || current.includes('\0') || current.includes('\r')
    || current.includes(MARKER) || current.includes(PROJECT)) {
    throw new Error('HBA_INPUT_CONFLICT');
  }
  const next = `${current}${current.endsWith('\n') ? '' : '\n'}\n${MARKER}\n${CONTRACT_HBA_RULES.join('\n')}\n`;
  return { beforeHash: digest(current), afterHash: digest(next), next };
}

export interface HbaVersion {
  text: string;
  identity: string;
}

export interface PostmasterProof {
  pid: number;
  startTimeTicks: string;
  pidFileStartTime: string;
  bootId: string;
  executable: string;
  executableIdentity: string;
  argvHash: string;
  directoryIdentity: string;
  pidFileIdentity: string;
  hbaFile: string;
  configFile: string;
}

export function postmasterProofHash(proof: PostmasterProof): string {
  return digest(JSON.stringify(proof));
}

export function parsePostmasterArguments(
  cmdline: string, executable: string, resolvedArgv0?: string,
): string[] {
  const argv = cmdline.split('\0');
  const terminated = argv.pop() === '';
  const argv0 = argv.shift();
  if (!terminated || !argv0 || !isAbsolute(argv0)
    || (argv0 !== executable && resolvedArgv0 !== executable) || !isAbsolute(executable)
    || basename(executable) !== 'postgres' || executable.includes(' (deleted)')
    || /[\u0000-\u0020\u007f]/.test(executable)) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
  let dataCount = 0;
  const seen = new Set<string>();
  const numericKeys = new Set([
    'max_connections', 'max_wal_senders', 'max_prepared_transactions',
    'max_locks_per_transaction', 'max_replication_slots', 'max_worker_processes',
  ]);
  const switches = new Set(['hot_standby', 'track_commit_timestamp', 'wal_log_hints']);
  function option(key: string, value: string): void {
    const canonical = key === 'config-file' ? 'config_file' : key;
    if (seen.has(canonical)) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
    seen.add(canonical);
    const valid = canonical === 'config_file' ? value === `${DATA}/postgresql.conf`
      : canonical === 'port' ? value === '5432'
      : canonical === 'listen_addresses' ? value === '0.0.0.0'
      : canonical === 'cluster_name' ? value === 'pg-meta'
      : canonical === 'wal_level' ? value === 'logical'
      : switches.has(canonical) ? value === 'on'
      : numericKeys.has(canonical) ? /^(0|[1-9][0-9]{0,6})$/.test(value)
      : false;
    if (!valid) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
  }
  for (let index = 0; index < argv.length;) {
    const flag = argv[index];
    if (flag?.startsWith('--')) {
      const match = /^--([a-z_][a-z_-]*)=([^\u0000-\u0020\u007f]+)$/.exec(flag);
      const key = match?.[1];
      const value = match?.[2];
      if (!key || !value) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
      option(key, value);
      index++;
      continue;
    }
    const value = argv[index + 1];
    if (!flag || !value || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
    }
    if (flag === '-D') {
      if (value !== DATA || ++dataCount !== 1) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
    } else if (flag === '-c') {
      const match = /^([a-z_][a-z0-9_]*)=(.+)$/.exec(value);
      if (!match?.[1] || !match[2]) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
      option(match[1], match[2]);
    } else if (flag === '-p') option('port', value);
    else if (flag === '-h') option('listen_addresses', value);
    else {
      throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
    }
    index += 2;
  }
  if (dataCount !== 1) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
  return argv;
}

export function parsePostmasterProcess(input: {
  pidFile: string; processStat: string; status: string; bootId: string;
}): { pid: number; startTimeTicks: string; pidFileStartTime: string; bootId: string } {
  const lines = input.pidFile.split('\n');
  const pid = lines[0];
  const epoch = lines[2];
  if (!pid || !/^[1-9][0-9]*$/.test(pid) || lines[1] !== DATA
    || !epoch || !/^[1-9][0-9]*$/.test(epoch) || lines[3] !== '5432') {
    throw new Error('POSTMASTER_IDENTITY_REJECTED');
  }
  const number = Number(pid);
  const prefix = `${pid} (postgres) `;
  if (!Number.isSafeInteger(number) || !input.processStat.startsWith(prefix)
    || !/^Name:\s+postgres$/m.test(input.status)
    || !/^Uid:\s+26\s+26\s+26\s+26$/m.test(input.status)
    || !/^Gid:\s+26\s+26\s+26\s+26$/m.test(input.status)) {
    throw new Error('POSTMASTER_IDENTITY_REJECTED');
  }
  const fields = input.processStat.slice(prefix.length).trim().split(/\s+/);
  const startTimeTicks = fields[19];
  if (!startTimeTicks || !/^[1-9][0-9]*$/.test(startTimeTicks)
    || !fields[0] || !['R', 'S', 'D', 'I'].includes(fields[0])
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.bootId)) {
    throw new Error('POSTMASTER_IDENTITY_REJECTED');
  }
  return { pid: number, startTimeTicks, pidFileStartTime: epoch, bootId: input.bootId };
}

export function validateEffectivePostgresPaths(paths: {
  hbaFile: string; dataDirectory: string; configFile: string;
}): void {
  if (paths.hbaFile !== HBA || paths.dataDirectory !== DATA
    || !isAbsolute(paths.configFile) || /[\u0000-\u0020\u007f]/.test(paths.configFile)
    || paths.configFile.includes('/../') || paths.configFile.includes('/./')) {
    throw new Error('POSTMASTER_EFFECTIVE_CONFIG_REJECTED');
  }
}

function fileIdentity(info: Stats): string {
  // rename/exchange 本身可更新 ctime；inode、权限、mtime与完整内容用于交换后比对。
  return [info.dev, info.ino, info.uid, info.gid, info.mode, info.size, info.mtimeMs].join(':');
}

async function verifiedVersion(path: string): Promise<HbaVersion> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 1_000_000
      || info.uid !== 26 || info.gid !== 26 || (info.mode & 0o777) !== 0o600) {
      throw new Error('HBA_FILE_IDENTITY_REJECTED');
    }
    const bytes = await file.readFile();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (Buffer.byteLength(text) !== info.size || fileIdentity(await file.stat()) !== fileIdentity(info)) {
      throw new Error('HBA_FILE_CHANGED_DURING_READ');
    }
    return { text, identity: fileIdentity(info) };
  } finally { await file.close(); }
}

export interface HbaExchangeIO {
  readPostmaster(): Promise<PostmasterProof>;
  readActive(): Promise<HbaVersion>;
  readBackup(): Promise<HbaVersion>;
  saveBackup(text: string): Promise<void>;
  stage(text: string, before: string): Promise<string>;
  readStage(path: string): Promise<HbaVersion>;
  exchange(path: string): void;
  sync(): Promise<void>;
  record(event: { phase: string; beforeHash: string; afterHash: string; retainedPath: string | null }): Promise<void>;
  signalBoundPostmaster(): void;
}

function sameVersion(left: HbaVersion, right: HbaVersion): boolean {
  return left.identity === right.identity && left.text === right.text;
}

/** 交换保留被替换版本；并非能约束任意 root 写入者的线性化 CAS。 */
export async function executeHbaExchange(
  io: HbaExchangeIO,
  request: {
    mode: 'apply' | 'rollback'; expectedHash: string;
    expectedPostmasterHash: string; maintenanceExclusive: boolean;
  },
) {
  if (!request.maintenanceExclusive) throw new Error('HBA_MAINTENANCE_WINDOW_REQUIRED');
  const proof = await io.readPostmaster();
  const proofHash = postmasterProofHash(proof);
  if (proofHash !== request.expectedPostmasterHash) throw new Error('POSTMASTER_PLAN_MISMATCH');
  const current = await io.readActive();
  if (!/^[0-9a-f]{64}$/.test(request.expectedHash) || digest(current.text) !== request.expectedHash) {
    throw new Error('HBA_EXPECTED_HASH_MISMATCH');
  }
  let next: string;
  if (request.mode === 'apply') next = planContractHba(current.text).next;
  else {
    const backup = await io.readBackup();
    if (planContractHba(backup.text).next !== current.text) throw new Error('HBA_ROLLBACK_CONFLICT');
    next = backup.text;
  }
  const beforeHash = digest(current.text);
  const afterHash = digest(next);
  await io.record({ phase: `${request.mode}-intent`, beforeHash, afterHash, retainedPath: null });
  if (request.mode === 'apply') await io.saveBackup(current.text);
  const retainedPath = await io.stage(next, current.text);
  const candidate = await io.readStage(retainedPath);
  if (candidate.text !== next) throw new Error('HBA_STAGE_MISMATCH');
  await io.record({ phase: 'exchange-intent', beforeHash, afterHash, retainedPath });
  if (postmasterProofHash(await io.readPostmaster()) !== proofHash) throw new Error('POSTMASTER_CHANGED_BEFORE_WRITE');
  if (!sameVersion(await io.readActive(), current)) throw new Error('HBA_CONCURRENT_CHANGE');
  io.exchange(retainedPath);
  await io.sync();
  // 核对交换实际换出的版本，而不是依赖交换前读到的路径内容。
  const displaced = await io.readStage(retainedPath);
  if (!sameVersion(displaced, current)) {
    await io.record({
      phase: 'exchange-conflict-no-signal', beforeHash: digest(displaced.text), afterHash, retainedPath,
    });
    throw new Error('HBA_EXCHANGE_CONFLICT');
  }
  if (!sameVersion(await io.readActive(), candidate)) throw new Error('HBA_ACTIVE_CHANGED_AFTER_EXCHANGE');
  await io.record({ phase: 'signal-intent', beforeHash, afterHash, retainedPath });
  if (!sameVersion(await io.readActive(), candidate)) throw new Error('HBA_ACTIVE_CHANGED_BEFORE_SIGNAL');
  if (postmasterProofHash(await io.readPostmaster()) !== proofHash) throw new Error('POSTMASTER_CHANGED_BEFORE_SIGNAL');
  io.signalBoundPostmaster();
  await io.record({ phase: 'signal-sent-not-runtime-acceptance', beforeHash, afterHash, retainedPath });
  return { beforeHash, afterHash, retainedPath, postmasterHash: proofHash,
    reloadSignalSent: true, runtimeAcceptancePassed: false };
}

async function directoryProof(): Promise<string> {
  const canonical = await realpath(DATA);
  const directory = await open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = await directory.stat();
    if (!info.isDirectory() || info.uid !== 26 || info.gid !== 26 || (info.mode & 0o022) !== 0) {
      throw new Error('HBA_DIRECTORY_REJECTED');
    }
    // 文件创建改变目录mtime，目录身份只绑定路径、inode及权限。
    return [canonical, info.dev, info.ino, info.uid, info.gid, info.mode].join(':');
  } finally { await directory.close(); }
}

export function effectiveConfigQuerySucceeded(result: {
  exitCode: number; success: boolean; signalCode?: string | null | undefined;
}): boolean {
  return result.exitCode === 0 && result.success === true && result.signalCode == null;
}

function effectiveConfig(executable: string, args: string[], setting: string): string {
  const result = Bun.spawnSync({
    cmd: [executable, ...args, '-C', setting],
    cwd: DATA, uid: 26, gid: 26, env: { PATH: '/usr/bin:/bin', LANG: 'C' },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 5_000, maxBuffer: 16_384,
  });
  if (!effectiveConfigQuerySucceeded(result)) {
    throw new Error('POSTMASTER_EFFECTIVE_CONFIG_UNAVAILABLE');
  }
  const value = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  if (!value.endsWith('\n') || value.slice(0, -1).includes('\n')) {
    throw new Error('POSTMASTER_EFFECTIVE_CONFIG_REJECTED');
  }
  return value.slice(0, -1);
}

async function verifiedPostmaster(): Promise<PostmasterProof> {
  const pidFile = await verifiedVersion(join(DATA, 'postmaster.pid'));
  const pid = pidFile.text.split('\n')[0];
  if (!pid || !/^[1-9][0-9]*$/.test(pid)) throw new Error('POSTMASTER_IDENTITY_REJECTED');
  const root = `/proc/${pid}`;
  const processStat = await readFile(`${root}/stat`, 'utf8');
  const status = await readFile(`${root}/status`, 'utf8');
  const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const process = parsePostmasterProcess({ pidFile: pidFile.text, processStat, status, bootId });
  const executable = await readlink(`${root}/exe`);
  const cmdline = await readFile(`${root}/cmdline`, 'utf8');
  const argv0 = cmdline.split('\0')[0];
  if (!argv0 || !isAbsolute(argv0)) throw new Error('POSTMASTER_ARGUMENTS_REJECTED');
  const args = parsePostmasterArguments(cmdline, executable, await realpath(argv0));
  const exe = await open(executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  let executableIdentity: string;
  try {
    const info = await exe.stat();
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) !== 0
      || fileIdentity(await stat(`${root}/exe`)) !== fileIdentity(info)) {
      throw new Error('POSTMASTER_EXECUTABLE_REJECTED');
    }
    executableIdentity = fileIdentity(info);
  } finally { await exe.close(); }
  const paths = {
    hbaFile: effectiveConfig(executable, args, 'hba_file'),
    dataDirectory: effectiveConfig(executable, args, 'data_directory'),
    configFile: effectiveConfig(executable, args, 'config_file'),
  };
  validateEffectivePostgresPaths(paths);
  const directoryIdentity = await directoryProof();
  // 同次采样也必须覆盖 -C 子进程运行期间的重启/参数或pidfile变化。
  const finalProcess = parsePostmasterProcess({
    pidFile: (await verifiedVersion(join(DATA, 'postmaster.pid'))).text,
    processStat: await readFile(`${root}/stat`, 'utf8'),
    status: await readFile(`${root}/status`, 'utf8'), bootId,
  });
  if (JSON.stringify(finalProcess) !== JSON.stringify(process)
    || await readlink(`${root}/exe`) !== executable
    || await readFile(`${root}/cmdline`, 'utf8') !== cmdline
    || (await verifiedVersion(join(DATA, 'postmaster.pid'))).identity !== pidFile.identity) {
    throw new Error('POSTMASTER_IDENTITY_UNSTABLE');
  }
  return {
    ...process, executable, executableIdentity, argvHash: digest(cmdline), directoryIdentity,
    pidFileIdentity: `${pidFile.identity}:${digest(pidFile.text)}`,
    hbaFile: paths.hbaFile, configFile: paths.configFile,
  };
}

async function writePrivate(path: string, content: string): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT
    | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.chown(26, 26);
    await file.chmod(0o600);
    await file.writeFile(content);
    await file.sync();
  } finally { await file.close(); }
}

async function createHostIO(proof: PostmasterProof) {
  if (process.platform !== 'linux') throw new Error('HBA_LINUX_REQUIRED');
  // 无 syscall-number 猜测或非原子 fallback；缺少符号/内核支持立即拒绝。
  const libc = dlopen('libc.so.6', {
    renameat2: { args: [FFIType.i32, FFIType.cstring, FFIType.i32, FFIType.cstring, FFIType.u32], returns: FFIType.i32 },
    pidfd_open: { args: [FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    pidfd_send_signal: { args: [FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
  });
  const canonical = await realpath(DATA);
  const directory = await open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const anchored = `/proc/self/fd/${directory.fd}`;
  let pidfd = -1;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let audit: Awaited<ReturnType<typeof open>> | undefined;
  const operation = randomUUID();
  const journalName = `pg_hba.conf.supauth-contract-${RUN}.${operation}.journal.jsonl`;
  try {
    const info = await directory.stat();
    const heldIdentity = [canonical, info.dev, info.ino, info.uid, info.gid, info.mode].join(':');
    if (heldIdentity !== proof.directoryIdentity || await directoryProof() !== proof.directoryIdentity) {
      throw new Error('HBA_DIRECTORY_CHANGED');
    }
    lock = await open(join(anchored, `pg_hba.conf.supauth-contract-${RUN}.lock`),
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const lockInfo = await lock.stat();
    if (!lockInfo.isFile() || lockInfo.nlink !== 1 || lockInfo.uid !== 0
      || (lockInfo.mode & 0o777) !== 0o600 || libc.symbols.flock(lock.fd, 6) !== 0) {
      throw new Error('HBA_MAINTENANCE_LOCK_FAILED');
    }
    pidfd = libc.symbols.pidfd_open(proof.pid, 0);
    if (pidfd < 0 || postmasterProofHash(await verifiedPostmaster()) !== postmasterProofHash(proof)) {
      throw new Error('POSTMASTER_HANDLE_REJECTED');
    }
    audit = await open(join(anchored, journalName),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const auditFile = audit;
    const io: HbaExchangeIO = {
      readPostmaster: verifiedPostmaster,
      readActive: () => verifiedVersion(join(anchored, 'pg_hba.conf')),
      readBackup: () => verifiedVersion(join(anchored, basename(BACKUP))),
      async saveBackup(text) {
        await writePrivate(join(anchored, basename(BACKUP)), text);
        await directory.sync();
      },
      async stage(text, before) {
        const prefix = `pg_hba.conf.supauth-contract-${RUN}.${randomUUID()}`;
        const name = `${prefix}.exchange`;
        await writePrivate(join(anchored, `${prefix}.before`), before);
        await writePrivate(join(anchored, `${prefix}.candidate`), text);
        await writePrivate(join(anchored, name), text);
        await directory.sync();
        return name;
      },
      readStage: name => verifiedVersion(join(anchored, name)),
      exchange(name) {
        if (libc.symbols.renameat2(directory.fd, Buffer.from(`${name}\0`),
          directory.fd, Buffer.from('pg_hba.conf\0'), 2) !== 0) throw new Error('HBA_EXCHANGE_FAILED');
      },
      sync: () => directory.sync(),
      async record(event) {
        await auditFile.writeFile(`${JSON.stringify({
          ...event, runId: RUN, projectRef: PROJECT, postmasterHash: postmasterProofHash(proof),
        })}\n`);
        await auditFile.sync();
        await directory.sync();
      },
      signalBoundPostmaster() {
        if (libc.symbols.pidfd_send_signal(pidfd, 1, null, 0) !== 0) {
          throw new Error('POSTMASTER_SIGNAL_FAILED');
        }
      },
    };
    return {
      io, journalPath: join(DATA, journalName),
      async close() {
        if (pidfd >= 0) libc.symbols.close(pidfd);
        await auditFile.close();
        await lock?.close();
        await directory.close();
        libc.close();
      },
    };
  } catch (error) {
    if (pidfd >= 0) libc.symbols.close(pidfd);
    await audit?.close();
    await lock?.close();
    await directory.close();
    libc.close();
    throw error;
  }
}

async function main() {
  // 这是平台主机维护入口，不建立任何数据库连接，也不改应用访问路径。
  if (hostname() !== 'i.pigsty' || process.getuid?.() !== 0
    || !Object.values(networkInterfaces()).some(entries =>
      entries?.some(entry => entry.address === '192.168.200.112'))) {
    throw new Error('TEST_HOST_IDENTITY_REJECTED');
  }
  const mode = Bun.argv[2];
  const expectedHash = Bun.argv[3];
  const current = await verifiedVersion(HBA);
  const proof = await verifiedPostmaster();
  if (mode === 'plan' || mode === 'plan-rollback') {
    let beforeHash: string;
    let afterHash: string;
    if (mode === 'plan') {
      const plan = planContractHba(current.text);
      beforeHash = plan.beforeHash;
      afterHash = plan.afterHash;
    } else {
      const backup = await verifiedVersion(BACKUP);
      if (planContractHba(backup.text).next !== current.text) throw new Error('HBA_ROLLBACK_CONFLICT');
      beforeHash = digest(current.text);
      afterHash = digest(backup.text);
    }
    console.log(JSON.stringify({
      mode, projectRef: PROJECT, runId: RUN, beforeHash,
      afterHash, rules: CONTRACT_HBA_RULES, reloadPid: proof.pid,
      postmasterHash: postmasterProofHash(proof), postmaster: proof,
    }));
    return;
  }
  if (mode !== 'apply' && mode !== 'rollback') throw new Error('HBA_MODE_INVALID');
  const expectedPostmasterHash = Bun.argv[4];
  if (!expectedHash || !expectedPostmasterHash || !/^[0-9a-f]{64}$/.test(expectedPostmasterHash)) {
    throw new Error('HBA_PLAN_REQUIRED');
  }
  if (Bun.argv[5] !== 'maintenance-exclusive') throw new Error('HBA_MAINTENANCE_WINDOW_REQUIRED');
  const host = await createHostIO(proof);
  try {
    const result = await executeHbaExchange(host.io, {
      mode, expectedHash, expectedPostmasterHash, maintenanceExclusive: true,
    });
    console.log(JSON.stringify({ mode, projectRef: PROJECT, ...result,
      backupPath: BACKUP, journalPath: host.journalPath }));
  } finally { await host.close(); }
}

if (import.meta.main) {
  try { await main(); } catch (error) {
    // 固定错误码，绝不转储远端配置或底层异常正文。
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message : 'HBA_OPERATION_FAILED';
    console.error(JSON.stringify({ code, outcome: 'inspect-before-retry' }));
    process.exitCode = 1;
  }
}
