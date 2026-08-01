import * as XLSX from 'xlsx';
import { pinyin } from 'pinyin-pro';
import { dlopen, FFIType } from 'bun:ffi';
import { dirname, resolve } from 'node:path';
import * as fs from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

XLSX.set_fs(fs);

interface ProvisioningRecord {
  external_id: string;
  external_type: string;
  display_name: string;
  email: string;
  source_status: string;
  profile: Record<string, unknown>;
  import_batch: string;
  metadata: Record<string, unknown>;
  claim_proof: string;
}

interface Args {
  input: string;
  output: string;
  csvOutput: string;
  domain: string;
  batch: string;
  externalType: string;
}

interface NormalizedRow {
  externalId: string;
  displayName: string;
  sourceStatus: string;
  department: string;
  company: string;
  role: string;
  sourceSeq: string;
}

interface FileIdentity {
  device: number;
  inode: number;
}

interface OwnedFile {
  path: string;
  identity: FileIdentity;
}

interface SensitiveOutputRequest {
  manifestPath: string;
  reviewPath: string;
  manifestContent: string;
  reviewContent: string;
}

interface OutputPlan {
  targetPath: string;
  content: string;
}

type OpenFile = Awaited<ReturnType<typeof open>>;

interface OutputCommitEvent {
  stagedPath: string;
  targetPath: string;
}

interface OutputTransactionHooks {
  beforeCommit?: (event: OutputCommitEvent) => void | Promise<void>;
  afterCommit?: (event: OutputCommitEvent) => void | Promise<void>;
  readCommittedStageIdentity?: (stagedPath: string) => Promise<FileIdentity | null>;
}

interface OutputTransaction {
  outputPlans: OutputPlan[];
  stagedFiles: OwnedFile[];
  stagePathFiles: Array<OwnedFile | null>;
  snapshots: Array<OwnedFile | null>;
  committedCount: number;
  preservedPaths: Set<string>;
  hooks: OutputTransactionHooks;
}

interface RestorationOutcome {
  failures: unknown[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const input = args.find(arg => !arg.startsWith('--'));
  if (!input) {
    throw new Error('Usage: bun run scripts/generate-account-provisioning-manifest.ts <xlsx> [--out path] [--csv path] [--domain example.com] [--batch name] [--external-type employee]');
  }
  const option = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    const found = args.find(arg => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };
  const batch = option('batch', 'account-provisioning-2026-06-09');
  return {
    input,
    output: option('out', `.agents/state/${batch}/import-manifest.json`),
    csvOutput: option('csv', `.agents/state/${batch}/import-review.csv`),
    domain: option(
      'domain',
      process.env.SUPAUTH_ACCOUNT_PROVISIONING_EMAIL_DOMAIN
        || process.env.ACCOUNT_PROVISIONING_EMAIL_DOMAIN
        || 'example.com',
    ).replace(/^@/, '').toLowerCase(),
    batch,
    externalType: option('external-type', 'employee'),
  };
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeExternalIdForManifest(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  if (/^\d+$/.test(normalized) && normalized.length < 4) {
    return normalized.padStart(4, '0');
  }
  return normalized;
}

function slugName(name: string): string {
  const raw = pinyin(name, { toneType: 'none', type: 'array', v: true }) as string[];
  const slug = raw.join('').toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug || 'user';
}

function suffixFromExternalId(externalId: string): string {
  return externalId.replace(/\D/g, '').slice(-4) || externalId.slice(-4).toLowerCase();
}

function buildEmails(rows: Array<{ externalId: string; displayName: string }>, domain: string) {
  const baseCounts = new Map<string, number>();
  for (const row of rows) {
    const base = slugName(row.displayName);
    baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
  }

  const used = new Set<string>();
  const emails = new Map<string, string>();
  for (const row of rows) {
    const base = slugName(row.displayName);
    const needsSuffix = (baseCounts.get(base) || 0) > 1;
    let local = needsSuffix ? `${base}.${suffixFromExternalId(row.externalId)}` : base;
    let email = `${local}@${domain}`;
    let n = 2;
    while (used.has(email)) {
      local = `${base}.${suffixFromExternalId(row.externalId)}.${n}`;
      email = `${local}@${domain}`;
      n += 1;
    }
    used.add(email);
    emails.set(row.externalId, email);
  }
  return emails;
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function generateClaimProof(): string {
  return randomBytes(32).toString('base64url');
}

type TransactionPathSuffix = 'tmp' | 'backup' | 'recovery' | 'cleanup';

interface AtomicPathOperations {
  exchange(sourcePath: string, targetPath: string): void;
  noReplace(sourcePath: string, targetPath: string): void;
}

const AT_CURRENT_WORKING_DIRECTORY = -100;
const RENAME_NO_REPLACE = 1;
const RENAME_EXCHANGE = 2;
const DARWIN_RENAME_EXCLUSIVE = 4;

function transactionPath(targetPath: string, suffix: TransactionPathSuffix): string {
  return `${targetPath}.${randomBytes(12).toString('hex')}.${suffix}`;
}

function cPath(filePath: string): Buffer {
  return Buffer.from(`${filePath}\0`);
}

function assertNativeRename(
  returnCode: number,
  operation: 'exchange' | 'no-replace rename',
  sourcePath: string,
  targetPath: string,
): void {
  if (returnCode === 0) return;
  throw new Error(`Atomic ${operation} failed for ${sourcePath} -> ${targetPath}`);
}

function darwinAtomicPathOperations(): AtomicPathOperations {
  const library = dlopen('/usr/lib/libSystem.B.dylib', {
    renamex_np: {
      args: [FFIType.cstring, FFIType.cstring, FFIType.uint32_t],
      returns: FFIType.int,
    },
  });
  const renameWithFlags = (sourcePath: string, targetPath: string, flags: number) => {
    const returnCode = library.symbols.renamex_np(cPath(sourcePath), cPath(targetPath), flags);
    assertNativeRename(
      returnCode,
      flags === RENAME_EXCHANGE ? 'exchange' : 'no-replace rename',
      sourcePath,
      targetPath,
    );
  };
  return {
    exchange: (sourcePath, targetPath) => renameWithFlags(sourcePath, targetPath, RENAME_EXCHANGE),
    noReplace: (sourcePath, targetPath) => renameWithFlags(sourcePath, targetPath, DARWIN_RENAME_EXCLUSIVE),
  };
}

function linuxAtomicPathOperations(): AtomicPathOperations {
  const library = dlopen('libc.so.6', {
    renameat2: {
      args: [FFIType.int, FFIType.cstring, FFIType.int, FFIType.cstring, FFIType.uint32_t],
      returns: FFIType.int,
    },
  });
  const renameWithFlags = (sourcePath: string, targetPath: string, flags: number) => {
    const returnCode = library.symbols.renameat2(
      AT_CURRENT_WORKING_DIRECTORY,
      cPath(sourcePath),
      AT_CURRENT_WORKING_DIRECTORY,
      cPath(targetPath),
      flags,
    );
    assertNativeRename(
      returnCode,
      flags === RENAME_EXCHANGE ? 'exchange' : 'no-replace rename',
      sourcePath,
      targetPath,
    );
  };
  return {
    exchange: (sourcePath, targetPath) => renameWithFlags(sourcePath, targetPath, RENAME_EXCHANGE),
    noReplace: (sourcePath, targetPath) => renameWithFlags(sourcePath, targetPath, RENAME_NO_REPLACE),
  };
}

let loadedAtomicPathOperations: AtomicPathOperations | null = null;

function atomicPathOperations(): AtomicPathOperations {
  if (loadedAtomicPathOperations) return loadedAtomicPathOperations;
  if (process.platform === 'darwin') loadedAtomicPathOperations = darwinAtomicPathOperations();
  else if (process.platform === 'linux') loadedAtomicPathOperations = linuxAtomicPathOperations();
  else throw new Error(`Atomic output replacement is unsupported on ${process.platform}`);
  return loadedAtomicPathOperations;
}

function identityFromStats(stats: { dev: number; ino: number }): FileIdentity {
  return { device: stats.dev, inode: stats.ino };
}

function hasErrorCode(cause: unknown, code: string): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function transactionFailure(primaryCause: unknown, recoveryFailures: unknown[]): unknown {
  if (recoveryFailures.length === 0) return primaryCause;
  const recoverySummary = recoveryFailures
    .map(cause => cause instanceof Error ? cause.message : String(cause))
    .join('; ');
  return new AggregateError(
    [primaryCause, ...recoveryFailures],
    `Sensitive output transaction failed and recovery was incomplete: ${recoverySummary}`,
  );
}

async function currentIdentity(filePath: string): Promise<FileIdentity | null> {
  try {
    return identityFromStats(await lstat(filePath));
  } catch (cause) {
    if (hasErrorCode(cause, 'ENOENT')) return null;
    throw cause;
  }
}

async function retainMovedFile(movedPath: string, originalPath: string): Promise<unknown[]> {
  try {
    await link(movedPath, originalPath);
    return [];
  } catch (cause) {
    return [cause];
  }
}

async function removeOwnedFile(ownedFile: OwnedFile): Promise<void> {
  const cleanupPath = transactionPath(ownedFile.path, 'cleanup');
  try {
    atomicPathOperations().noReplace(ownedFile.path, cleanupPath);
  } catch (cause) {
    if (!await currentIdentity(ownedFile.path)) return;
    throw cause;
  }
  const movedIdentity = await currentIdentity(cleanupPath);
  if (movedIdentity && sameIdentity(movedIdentity, ownedFile.identity)) {
    await unlink(cleanupPath);
    return;
  }
  const recoveryFailures = movedIdentity ? await retainMovedFile(cleanupPath, ownedFile.path) : [];
  throw transactionFailure(
    new Error(`Refusing to remove a file not owned by this transaction; retained at ${cleanupPath}`),
    recoveryFailures,
  );
}

async function cleanupOwnedFiles(ownedFiles: OwnedFile[]): Promise<unknown[]> {
  const cleanupFailures: unknown[] = [];
  for (const ownedFile of ownedFiles) {
    try {
      await removeOwnedFile(ownedFile);
    } catch (cause) {
      cleanupFailures.push(cause);
    }
  }
  return cleanupFailures;
}

async function persistAndCloseFile(openFile: OpenFile, content: string): Promise<unknown[]> {
  const writeFailures: unknown[] = [];
  try {
    await openFile.writeFile(content, 'utf8');
    await openFile.sync();
  } catch (cause) {
    writeFailures.push(cause);
  }
  try {
    await openFile.close();
  } catch (cause) {
    writeFailures.push(cause);
  }
  return writeFailures;
}

async function createOwnedFile(filePath: string, content: string): Promise<OwnedFile> {
  const openFile = await open(filePath, 'wx', 0o600);
  const ownedFile = { path: filePath, identity: identityFromStats(await openFile.stat()) };
  const writeFailures = await persistAndCloseFile(openFile, content);
  if (writeFailures.length > 0) {
    const cleanupFailures = await cleanupOwnedFiles([ownedFile]);
    throw transactionFailure(
      writeFailures.length === 1 ? writeFailures[0] : new AggregateError(writeFailures, 'Sensitive file write failed'),
      cleanupFailures,
    );
  }
  return ownedFile;
}

function outputLockPath(targetPath: string): string {
  return `${resolve(targetPath)}.supauth-output.lock`;
}

async function acquireOutputLocks(outputPlans: OutputPlan[]): Promise<OwnedFile[]> {
  const targetPaths = new Set(outputPlans.map(plan => resolve(plan.targetPath)));
  const lockPaths = [...targetPaths].map(outputLockPath).sort();
  if (lockPaths.some(lockPath => targetPaths.has(lockPath))) {
    throw new Error('Output paths conflict with transaction lock paths');
  }

  const acquiredLocks: OwnedFile[] = [];
  try {
    for (const lockPath of lockPaths) acquiredLocks.push(await createOwnedFile(lockPath, ''));
    return acquiredLocks;
  } catch (cause) {
    throw transactionFailure(cause, await cleanupOwnedFiles(acquiredLocks));
  }
}

async function stageOutputs(outputPlans: OutputPlan[]): Promise<OwnedFile[]> {
  const stagedFiles: OwnedFile[] = [];
  try {
    for (const plan of outputPlans) {
      stagedFiles.push(await createOwnedFile(transactionPath(plan.targetPath, 'tmp'), plan.content));
    }
    return stagedFiles;
  } catch (cause) {
    throw transactionFailure(cause, await cleanupOwnedFiles(stagedFiles));
  }
}

async function snapshotOutput(targetPath: string): Promise<OwnedFile | null> {
  const backupPath = transactionPath(targetPath, 'backup');
  try {
    await link(targetPath, backupPath);
  } catch (cause) {
    if (hasErrorCode(cause, 'ENOENT')) return null;
    throw cause;
  }
  return { path: backupPath, identity: identityFromStats(await lstat(backupPath)) };
}

async function snapshotOutputs(outputPlans: OutputPlan[]): Promise<Array<OwnedFile | null>> {
  const snapshots: Array<OwnedFile | null> = [];
  try {
    for (const plan of outputPlans) snapshots.push(await snapshotOutput(plan.targetPath));
    return snapshots;
  } catch (cause) {
    const createdSnapshots = snapshots.filter((snapshot): snapshot is OwnedFile => snapshot !== null);
    throw transactionFailure(cause, await cleanupOwnedFiles(createdSnapshots));
  }
}

function commitEvent(transaction: OutputTransaction, index: number): OutputCommitEvent {
  return {
    stagedPath: transaction.stagedFiles[index].path,
    targetPath: transaction.outputPlans[index].targetPath,
  };
}

async function invokeCommitHook(
  hook: ((event: OutputCommitEvent) => void | Promise<void>) | undefined,
  event: OutputCommitEvent,
): Promise<void> {
  if (hook) await hook(event);
}

async function restoreForeignCommitTarget(
  transaction: OutputTransaction,
  index: number,
  displacedIdentity: FileIdentity | null,
): Promise<void> {
  const plan = transaction.outputPlans[index];
  const stagedFile = transaction.stagedFiles[index];
  atomicPathOperations().exchange(stagedFile.path, plan.targetPath);
  const [restoredStage, restoredTarget] = await Promise.all([
    currentIdentity(stagedFile.path),
    currentIdentity(plan.targetPath),
  ]);
  if (!displacedIdentity || !restoredTarget || !sameIdentity(restoredTarget, displacedIdentity)
    || !restoredStage || !sameIdentity(restoredStage, stagedFile.identity)) {
    transaction.stagePathFiles[index] = restoredStage
      ? { path: stagedFile.path, identity: restoredStage }
      : null;
    throw new Error(`Could not restore the replaced output without losing an inode: ${plan.targetPath}`);
  }
  transaction.stagePathFiles[index] = stagedFile;
  transaction.committedCount = index;
}

async function rejectForeignExchange(
  transaction: OutputTransaction,
  index: number,
  displacedIdentity: FileIdentity | null,
): Promise<never> {
  const plan = transaction.outputPlans[index];
  const snapshot = transaction.snapshots[index];
  const failures: unknown[] = [];
  if (snapshot) transaction.preservedPaths.add(snapshot.path);
  try {
    await restoreForeignCommitTarget(transaction, index, displacedIdentity);
  } catch (cause) {
    failures.push(cause);
    transaction.preservedPaths.add(transaction.stagedFiles[index].path);
  }
  throw transactionFailure(
    new Error(`Output changed during atomic commit; recovery material was retained for ${plan.targetPath}`),
    failures,
  );
}

async function commitExistingOutput(transaction: OutputTransaction, index: number): Promise<void> {
  const plan = transaction.outputPlans[index];
  const stagedFile = transaction.stagedFiles[index];
  const snapshot = transaction.snapshots[index];
  if (!snapshot) throw new Error(`Missing snapshot for existing output: ${plan.targetPath}`);
  atomicPathOperations().exchange(stagedFile.path, plan.targetPath);
  transaction.stagePathFiles[index] = { path: stagedFile.path, identity: snapshot.identity };
  transaction.committedCount = index + 1;
  const readCommittedStageIdentity = transaction.hooks.readCommittedStageIdentity ?? currentIdentity;
  const displacedIdentity = await readCommittedStageIdentity(stagedFile.path);
  if (!displacedIdentity || !sameIdentity(displacedIdentity, snapshot.identity)) {
    await rejectForeignExchange(transaction, index, displacedIdentity);
  }
}

async function commitMissingOutput(transaction: OutputTransaction, index: number): Promise<void> {
  const stagedFile = transaction.stagedFiles[index];
  const targetPath = transaction.outputPlans[index].targetPath;
  await link(stagedFile.path, targetPath);
  transaction.stagePathFiles[index] = stagedFile;
}

async function commitOutput(transaction: OutputTransaction, index: number): Promise<void> {
  const event = commitEvent(transaction, index);
  await invokeCommitHook(transaction.hooks.beforeCommit, event);
  if (transaction.snapshots[index]) await commitExistingOutput(transaction, index);
  else await commitMissingOutput(transaction, index);
  transaction.committedCount = index + 1;
  await invokeCommitHook(transaction.hooks.afterCommit, event);
}

async function restoreForeignRollbackTarget(
  transaction: OutputTransaction,
  index: number,
  displacedIdentity: FileIdentity | null,
): Promise<void> {
  const plan = transaction.outputPlans[index];
  const snapshot = transaction.snapshots[index];
  if (!snapshot) throw new Error(`Missing rollback snapshot: ${plan.targetPath}`);
  atomicPathOperations().exchange(snapshot.path, plan.targetPath);
  const [restoredSnapshot, restoredTarget] = await Promise.all([
    currentIdentity(snapshot.path),
    currentIdentity(plan.targetPath),
  ]);
  if (!displacedIdentity || !restoredTarget || !sameIdentity(restoredTarget, displacedIdentity)
    || !restoredSnapshot || !sameIdentity(restoredSnapshot, snapshot.identity)) {
    throw new Error(`Could not restore the replaced output without losing an inode: ${plan.targetPath}`);
  }
}

async function rejectForeignRollback(
  transaction: OutputTransaction,
  index: number,
  displacedIdentity: FileIdentity | null,
): Promise<never> {
  const plan = transaction.outputPlans[index];
  const snapshot = transaction.snapshots[index];
  const failures: unknown[] = [];
  if (snapshot) transaction.preservedPaths.add(snapshot.path);
  try {
    await restoreForeignRollbackTarget(transaction, index, displacedIdentity);
  } catch (cause) {
    failures.push(cause);
    const stagePathFile = transaction.stagePathFiles[index];
    if (stagePathFile) transaction.preservedPaths.add(stagePathFile.path);
  }
  throw transactionFailure(
    new Error(`Refusing to roll back an output not owned by this transaction: ${plan.targetPath}`),
    failures,
  );
}

async function restoreExistingOutput(transaction: OutputTransaction, index: number): Promise<void> {
  const plan = transaction.outputPlans[index];
  const snapshot = transaction.snapshots[index];
  const stagedFile = transaction.stagedFiles[index];
  if (!snapshot) throw new Error(`Missing rollback snapshot: ${plan.targetPath}`);
  atomicPathOperations().exchange(snapshot.path, plan.targetPath);
  const displacedIdentity = await currentIdentity(snapshot.path);
  if (!displacedIdentity || !sameIdentity(displacedIdentity, stagedFile.identity)) {
    await rejectForeignRollback(transaction, index, displacedIdentity);
  }
  transaction.snapshots[index] = { path: snapshot.path, identity: stagedFile.identity };
}

async function restoreMissingOutput(transaction: OutputTransaction, index: number): Promise<void> {
  const targetPath = transaction.outputPlans[index].targetPath;
  const stagedFile = transaction.stagedFiles[index];
  const recoveryPath = transactionPath(targetPath, 'recovery');
  try {
    atomicPathOperations().noReplace(targetPath, recoveryPath);
  } catch (cause) {
    if (!await currentIdentity(targetPath)) return;
    throw cause;
  }
  const movedIdentity = await currentIdentity(recoveryPath);
  if (movedIdentity && sameIdentity(movedIdentity, stagedFile.identity)) {
    await removeOwnedFile({ path: recoveryPath, identity: movedIdentity });
    return;
  }
  const recoveryFailures = movedIdentity ? await retainMovedFile(recoveryPath, targetPath) : [];
  transaction.preservedPaths.add(recoveryPath);
  throw transactionFailure(
    new Error(`Refusing to remove an output not owned by this transaction: ${targetPath}`),
    recoveryFailures,
  );
}

async function restoreOutput(transaction: OutputTransaction, index: number): Promise<void> {
  if (transaction.snapshots[index]) await restoreExistingOutput(transaction, index);
  else await restoreMissingOutput(transaction, index);
}

async function restoreCommittedOutputs(transaction: OutputTransaction): Promise<RestorationOutcome> {
  const failures: unknown[] = [];
  for (let index = transaction.committedCount - 1; index >= 0; index -= 1) {
    try {
      await restoreOutput(transaction, index);
    } catch (cause) {
      const snapshot = transaction.snapshots[index];
      if (snapshot) transaction.preservedPaths.add(snapshot.path);
      const stagePathFile = transaction.stagePathFiles[index];
      if (!snapshot && stagePathFile) transaction.preservedPaths.add(stagePathFile.path);
      failures.push(cause);
    }
  }
  return { failures };
}

async function recoverOutputs(transaction: OutputTransaction): Promise<unknown[]> {
  const restoration = await restoreCommittedOutputs(transaction);
  const cleanupCandidates = [...transaction.stagePathFiles, ...transaction.snapshots]
    .filter((file): file is OwnedFile => file !== null && !transaction.preservedPaths.has(file.path));
  restoration.failures.push(...await cleanupOwnedFiles(uniqueOwnedFiles(cleanupCandidates)));
  return restoration.failures;
}

async function commitOutputs(transaction: OutputTransaction): Promise<void> {
  for (let index = 0; index < transaction.outputPlans.length; index += 1) {
    await commitOutput(transaction, index);
  }
}

async function runOutputTransaction(transaction: OutputTransaction): Promise<void> {
  transaction.snapshots = await snapshotOutputs(transaction.outputPlans);
  transaction.stagedFiles = await stageOutputs(transaction.outputPlans);
  transaction.stagePathFiles = transaction.stagedFiles.map(stagedFile => ({ ...stagedFile }));
  await commitOutputs(transaction);
}

function uniqueOwnedFiles(ownedFiles: Array<OwnedFile | null>): OwnedFile[] {
  const unique = new Map<string, OwnedFile>();
  for (const ownedFile of ownedFiles) {
    if (ownedFile) unique.set(ownedFile.path, ownedFile);
  }
  return [...unique.values()];
}

async function finalizeOutputTransaction(
  transaction: OutputTransaction,
  outputLocks: OwnedFile[],
): Promise<void> {
  const ownedFiles = uniqueOwnedFiles([...transaction.stagePathFiles, ...transaction.snapshots, ...outputLocks]);
  const cleanupFailures = await cleanupOwnedFiles(
    ownedFiles.filter(ownedFile => !transaction.preservedPaths.has(ownedFile.path)),
  );
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, 'Sensitive outputs were committed but cleanup failed');
  }
}

function outputTransaction(
  request: SensitiveOutputRequest,
  hooks: OutputTransactionHooks,
): OutputTransaction {
  const outputPlans = [
    { targetPath: resolve(request.manifestPath), content: request.manifestContent },
    { targetPath: resolve(request.reviewPath), content: request.reviewContent },
  ];
  if (outputPlans[0].targetPath === outputPlans[1].targetPath) {
    throw new Error('Manifest and CSV output paths must be different');
  }
  return {
    outputPlans,
    stagedFiles: [],
    stagePathFiles: [],
    snapshots: [],
    committedCount: 0,
    preservedPaths: new Set(),
    hooks,
  };
}

export async function writeSensitiveOutputs(
  request: SensitiveOutputRequest,
  hooks: OutputTransactionHooks = {},
): Promise<void> {
  const transaction = outputTransaction(request, hooks);
  const outputLocks = await acquireOutputLocks(transaction.outputPlans);
  try {
    await runOutputTransaction(transaction);
  } catch (cause) {
    const recoveryFailures = await recoverOutputs(transaction);
    recoveryFailures.push(...await cleanupOwnedFiles(outputLocks));
    throw transactionFailure(cause, recoveryFailures);
  }
  await finalizeOutputTransaction(transaction, outputLocks);
}

async function main() {
  const args = parseArgs();
  if (resolve(args.output) === resolve(args.csvOutput)) {
    throw new Error('Manifest and CSV output paths must be different');
  }
  const workbook = XLSX.readFile(args.input);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const normalized: NormalizedRow[] = rows.map((row: Record<string, unknown>) => ({
    externalId: normalizeExternalIdForManifest(cell(row, '数字ID') || cell(row, 'external_id') || cell(row, 'External ID')),
    displayName: cell(row, '姓名') || cell(row, 'display_name') || cell(row, 'Display Name'),
    sourceStatus: cell(row, '状态') || cell(row, 'source_status') || 'active',
    department: cell(row, '部门'),
    company: cell(row, '企业'),
    role: cell(row, '角色'),
    sourceSeq: cell(row, '序号'),
  })).filter((row: NormalizedRow) => row.externalId && row.displayName);

  const emails = buildEmails(normalized, args.domain);
  const records: ProvisioningRecord[] = normalized.map((row: NormalizedRow) => ({
    external_id: row.externalId,
    external_type: args.externalType,
    display_name: row.displayName,
    email: emails.get(row.externalId) || `${row.externalId}@${args.domain}`,
    source_status: row.sourceStatus === '正常' ? 'active' : row.sourceStatus,
    profile: {
      department: row.department || null,
      company: row.company || null,
      role: row.role || null,
    },
    import_batch: args.batch,
    metadata: {
      source: args.batch,
      source_sheet: sheetName,
      source_seq: row.sourceSeq || null,
    },
    claim_proof: generateClaimProof(),
  }));

  const eligible = records.filter(record => ['active', '正常'].includes(record.source_status)).length;
  const skipped = records.length - eligible;
  const manifest = {
    generated_at: new Date().toISOString(),
    source: args.input,
    email_domain: args.domain,
    external_type: args.externalType,
    summary: {
      total: records.length,
      eligible,
      skipped,
    },
    records,
  };

  await mkdir(dirname(args.output), { recursive: true });
  await mkdir(dirname(args.csvOutput), { recursive: true });
  const csvHeader = ['external_id', 'external_type', 'display_name', 'email', 'claim_proof', 'source_status', 'department', 'company', 'role'];
  const csvBody = records.map(record => {
    const row = {
      ...record,
      department: record.profile.department,
      company: record.profile.company,
      role: record.profile.role,
    };
    return csvHeader.map(key => csvEscape(row[key as keyof typeof row])).join(',');
  });
  await writeSensitiveOutputs({
    manifestPath: args.output,
    reviewPath: args.csvOutput,
    manifestContent: JSON.stringify(manifest, null, 2),
    reviewContent: `${csvHeader.join(',')}\n${csvBody.join('\n')}\n`,
  });
  console.log(JSON.stringify({ output: args.output, csv: args.csvOutput, ...manifest.summary }, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
