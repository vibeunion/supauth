import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import { Type, decodeSchema, type Static, type TSchema } from '../packages/shared/src/schema.js';

export const PlatformProjectRefSchema = Type.String({ pattern: '^[a-z]{20}$' });
export const AllocationRunIdSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
export const TEST_IDENTITY_OWNER_REF = 'lhevaxecbonjjdbardgi';
const NameSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '^[^\\u0000-\\u001f\\u007f]+$' });
const OriginSchema = Type.String({ minLength: 1, maxLength: 253 });
const ProjectIdSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-zA-Z0-9_-]+$' });
const CreatedAtSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})$',
});
const InventoryProjectSchema = Type.Object({
  ref: PlatformProjectRefSchema, name: NameSchema,
}, { additionalProperties: false });
export const AllocationInventorySchema = Type.Object({
  complete: Type.Literal(true),
  projects: Type.Array(InventoryProjectSchema, { maxItems: 10_000 }),
}, { additionalProperties: false });
export const AllocationIntentSchema = Type.Object({
  runId: AllocationRunIdSchema,
  name: NameSchema,
  managementOrigin: Type.Literal('http://127.0.0.1:29190'),
  projectOrigin: OriginSchema,
  authorityRef: Type.Literal(TEST_IDENTITY_OWNER_REF),
  authorityOrigin: Type.Literal('https://auth.xai.xigu.team'),
  beforeInventory: AllocationInventorySchema,
}, { additionalProperties: false });
export type AllocationIntent = Static<typeof AllocationIntentSchema>;
export type AllocationInventory = Static<typeof AllocationInventorySchema>;

// 只投影非敏感字段；原始平台回执可能包含 credentials/config，禁止落盘。
const RawProjectSchema = Type.Object({
  id: ProjectIdSchema, created_at: CreatedAtSchema,
  ref: PlatformProjectRefSchema, name: NameSchema,
  api: Type.Object({ url: OriginSchema }),
  status: Type.String({ minLength: 1, maxLength: 40 }),
});
export const AllocationReceiptSchema = Type.Object({
  id: ProjectIdSchema, created_at: CreatedAtSchema,
  ref: PlatformProjectRefSchema, name: NameSchema, apiOrigin: OriginSchema,
}, { additionalProperties: false });
export type AllocationReceipt = Static<typeof AllocationReceiptSchema>;
const ReadbackSchema = Type.Object({
  ...AllocationReceiptSchema.properties, status: Type.Literal('ACTIVE_HEALTHY'),
}, { additionalProperties: false });
export const AllocationAuthoritySchema = Type.Object({
  project_ref: PlatformProjectRefSchema,
  mode: Type.Literal('shared'),
  authority_project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF),
  owner_project_ref: Type.Literal(TEST_IDENTITY_OWNER_REF),
  local_gotrue_enabled: Type.Literal(false),
  public_auth_route: Type.Literal('owner_proxy'),
  user_management: Type.Literal('owner_only'),
  configuration_management: Type.Literal('owner_only'),
}, { additionalProperties: false });
const RawAuthoritySchema = Type.Object(AllocationAuthoritySchema.properties);
export const BoundAllocationSchema = Type.Object({
  version: Type.Literal(1),
  intent: AllocationIntentSchema,
  receipt: AllocationReceiptSchema,
  project: ReadbackSchema,
  authority: AllocationAuthoritySchema,
  authorityOrigin: OriginSchema,
  source: Type.Union([Type.Literal('receipt'), Type.Literal('reconciled')]),
}, { additionalProperties: false });
export type BoundAllocation = Static<typeof BoundAllocationSchema>;
export const AllocationCreateRequestSchema = Type.Object({
  name: NameSchema, region: Type.Literal('local'),
  api_domain: Type.String(), auth_domain: Type.String(),
}, { additionalProperties: false });
export type AllocationCreateRequest = Readonly<Static<typeof AllocationCreateRequestSchema>>;
export interface AllocationBindingEvidence {
  projectReadback: unknown;
  authorityDescriptor: unknown;
  authorityOrigin: string;
}
type AllocationCode = 'ALLOCATION_INVALID' | 'ALLOCATION_BASELINE_CONFLICT'
  | 'ALLOCATION_IDENTITY_MISMATCH' | 'ALLOCATION_JOURNAL_FAILED'
  | 'ALLOCATION_CREATE_ALREADY_STARTED' | 'ALLOCATION_CREATE_UNKNOWN'
  | 'ALLOCATION_NOT_STARTED' | 'ALLOCATION_NOT_BOUND' | 'ALLOCATION_RECONCILE_AMBIGUOUS';
export class AllocationError extends Error {
  constructor(readonly code: AllocationCode) {
    super(code);
    this.name = 'AllocationError';
  }
}
function fail(code: AllocationCode): never { throw new AllocationError(code); }
function decode<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try { return decodeSchema(schema, value); } catch { return fail('ALLOCATION_INVALID'); }
}
function testOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== value || url.protocol !== 'https:' || url.port
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.xai\.xigu\.team$/.test(url.hostname)) {
      fail('ALLOCATION_INVALID');
    }
    return url.origin;
  } catch { return fail('ALLOCATION_INVALID'); }
}
function validateInventory(value: unknown): AllocationInventory {
  const inventory = decode(AllocationInventorySchema, value);
  if (new Set(inventory.projects.map(project => project.ref)).size !== inventory.projects.length) {
    fail('ALLOCATION_INVALID');
  }
  return inventory;
}
export function validateAllocationIntent(value: unknown): AllocationIntent {
  const intent = decode(AllocationIntentSchema, value);
  validateInventory(intent.beforeInventory);
  testOrigin(intent.authorityOrigin);
  if (intent.name !== `supauth-contract-${intent.runId}`
    || intent.projectOrigin !== `https://contract-${intent.runId}.xai.xigu.team`
    || intent.authorityOrigin === intent.projectOrigin) fail('ALLOCATION_INVALID');
  testOrigin(intent.projectOrigin);
  if (!intent.beforeInventory.projects.some(project => project.ref === TEST_IDENTITY_OWNER_REF)
    || intent.beforeInventory.projects.some(project => project.name === intent.name)) {
    fail('ALLOCATION_BASELINE_CONFLICT');
  }
  // 与调用方分离，避免 await 期间修改已验证的 intent。
  return decode(AllocationIntentSchema, JSON.parse(JSON.stringify(intent)));
}
function matchReceipt(intent: AllocationIntent, receipt: AllocationReceipt): void {
  if (!Number.isFinite(Date.parse(receipt.created_at))) fail('ALLOCATION_INVALID');
  if (intent.beforeInventory.projects.some(project => project.ref === receipt.ref)) {
    fail('ALLOCATION_BASELINE_CONFLICT');
  }
  if (receipt.name !== intent.name || receipt.apiOrigin !== intent.projectOrigin) {
    fail('ALLOCATION_IDENTITY_MISMATCH');
  }
}
function projectProjection(value: unknown): AllocationReceipt & { status: string } {
  const project = decode(RawProjectSchema, value);
  return {
    id: project.id, created_at: project.created_at,
    ref: project.ref, name: project.name, apiOrigin: project.api.url, status: project.status,
  };
}
export function validateBoundAllocation(value: unknown): BoundAllocation {
  const bound = decode(BoundAllocationSchema, value);
  validateAllocationIntent(bound.intent);
  matchReceipt(bound.intent, bound.receipt);
  matchReceipt(bound.intent, bound.project);
  if (!sameReceipt(bound.receipt, bound.project) || bound.authority.project_ref !== bound.project.ref
    || bound.authorityOrigin !== bound.intent.authorityOrigin) fail('ALLOCATION_IDENTITY_MISMATCH');
  return decode(BoundAllocationSchema, JSON.parse(JSON.stringify(bound)));
}

const StartedSchema = Type.Object({
  runId: AllocationRunIdSchema, phase: Type.Literal('create-started'),
}, { additionalProperties: false });
const UnknownSchema = Type.Object({
  runId: AllocationRunIdSchema, code: Type.Literal('ALLOCATION_CREATE_UNKNOWN'),
}, { additionalProperties: false });
const MAX_JOURNAL_BYTES = 2_000_000;
function systemCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}
async function privateDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700
    || (process.getuid && info.uid !== process.getuid())) fail('ALLOCATION_JOURNAL_FAILED');
}
async function writeNew(directory: string, name: string, value: unknown): Promise<void> {
  await privateDirectory(directory);
  const file = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT
    | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally { await file.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}
async function readOptional(directory: string, name: string): Promise<unknown> {
  await privateDirectory(directory);
  let file: Awaited<ReturnType<typeof open>>;
  try { file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (systemCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600
      || info.size > MAX_JOURNAL_BYTES || (process.getuid && info.uid !== process.getuid())) {
      fail('ALLOCATION_JOURNAL_FAILED');
    }
    const value: unknown = JSON.parse(await file.readFile('utf8'));
    return value;
  } finally { await file.close(); }
}

export interface AllocationJournal {
  createOnce(send: (request: AllocationCreateRequest) => Promise<unknown>): Promise<AllocationReceipt>;
  bind(evidence: AllocationBindingEvidence): Promise<BoundAllocation>;
  reconcile(evidence: AllocationBindingEvidence & { inventory: unknown }): Promise<BoundAllocation>;
  readBound(): Promise<BoundAllocation>;
}
function journal(directory: string, intent: AllocationIntent): AllocationJournal {
  async function started(): Promise<void> {
    const value = await readOptional(directory, 'create-started.json');
    if (value === undefined) fail('ALLOCATION_NOT_STARTED');
    if (decode(StartedSchema, value).runId !== intent.runId) fail('ALLOCATION_INVALID');
  }
  async function recordBound(
    receipt: AllocationReceipt, evidence: AllocationBindingEvidence, source: BoundAllocation['source'],
    inventory?: AllocationInventory,
  ): Promise<BoundAllocation> {
    const project = projectProjection(evidence.projectReadback);
    const raw = decode(RawAuthoritySchema, evidence.authorityDescriptor);
    const bound = validateBoundAllocation({
      version: 1, intent, receipt, project, source,
      authorityOrigin: evidence.authorityOrigin,
      authority: {
        project_ref: raw.project_ref, mode: raw.mode,
        authority_project_ref: raw.authority_project_ref, owner_project_ref: raw.owner_project_ref,
        local_gotrue_enabled: raw.local_gotrue_enabled, public_auth_route: raw.public_auth_route,
        user_management: raw.user_management, configuration_management: raw.configuration_management,
      },
    });
    if (inventory !== undefined) {
      // 先验证全部绑定，再存对账证据；失效的回读不能占用最终对账记录。
      const previous = await readOptional(directory, 'reconciliation.json');
      if (previous === undefined) await writeNew(directory, 'reconciliation.json', inventory);
      else if (JSON.stringify(validateInventory(previous)) !== JSON.stringify(inventory)) {
        fail('ALLOCATION_IDENTITY_MISMATCH');
      }
    }
    await writeNew(directory, 'bound.json', bound);
    return bound;
  }
  async function guarded<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof AllocationError) throw error;
      return fail('ALLOCATION_JOURNAL_FAILED');
    }
  }
  return {
    createOnce: send => guarded(async () => {
      // 独占且持久的标记是发送机会；崩溃、并发或重新打开均不得获得第二次。
      try {
        await writeNew(directory, 'create-started.json', { runId: intent.runId, phase: 'create-started' });
      } catch (error) {
        if (systemCode(error) === 'EEXIST') fail('ALLOCATION_CREATE_ALREADY_STARTED');
        throw error;
      }
      try {
        const reply = projectProjection(await send({
          name: intent.name, region: 'local',
          api_domain: new URL(intent.projectOrigin).hostname,
          auth_domain: new URL(intent.projectOrigin).hostname,
        }));
        const receipt = {
          id: reply.id, created_at: reply.created_at,
          ref: reply.ref, name: reply.name, apiOrigin: reply.apiOrigin,
        };
        matchReceipt(intent, receipt);
        await writeNew(directory, 'receipt.json', receipt);
        return receipt;
      } catch {
        await writeNew(directory, 'create-unknown.json', {
          runId: intent.runId, code: 'ALLOCATION_CREATE_UNKNOWN',
        });
        return fail('ALLOCATION_CREATE_UNKNOWN');
      }
    }),
    bind: evidence => guarded(async () => {
      await started();
      const receipt = decode(AllocationReceiptSchema, await readOptional(directory, 'receipt.json'));
      return recordBound(receipt, evidence, 'receipt');
    }),
    reconcile: evidence => guarded(async () => {
      await started();
      const inventory = validateInventory(evidence.inventory);
      for (const previous of intent.beforeInventory.projects) {
        const current = inventory.projects.find(project => project.ref === previous.ref);
        if (!current || current.name !== previous.name) fail('ALLOCATION_BASELINE_CONFLICT');
      }
      const candidates = inventory.projects.filter(project => project.name === intent.name);
      const candidate = candidates[0];
      if (candidates.length !== 1 || !candidate) fail('ALLOCATION_RECONCILE_AMBIGUOUS');
      const project = projectProjection(evidence.projectReadback);
      if (project.ref !== candidate.ref) fail('ALLOCATION_IDENTITY_MISMATCH');
      const receipt = {
        id: project.id, created_at: project.created_at,
        ref: project.ref, name: project.name, apiOrigin: project.apiOrigin,
      };
      const acknowledged = await readOptional(directory, 'receipt.json');
      if (acknowledged !== undefined
        && !sameReceipt(decode(AllocationReceiptSchema, acknowledged), receipt)) {
        fail('ALLOCATION_IDENTITY_MISMATCH');
      }
      return recordBound(receipt, evidence, 'reconciled', inventory);
    }),
    readBound: () => guarded(async () => {
      await started();
      const value = await readOptional(directory, 'bound.json');
      if (value === undefined) fail('ALLOCATION_NOT_BOUND');
      const bound = validateBoundAllocation(value);
      if (JSON.stringify(bound.intent) !== JSON.stringify(intent)) fail('ALLOCATION_IDENTITY_MISMATCH');
      return bound;
    }),
  };
}

const ProofDetailsSchema = Type.Object({
  runId: AllocationRunIdSchema,
  projectRef: PlatformProjectRefSchema,
  projectOrigin: OriginSchema,
  authorityRef: Type.Literal(TEST_IDENTITY_OWNER_REF),
  authorityOrigin: Type.Literal('https://auth.xai.xigu.team'),
}, { additionalProperties: false });
export type AllocationProof = Readonly<Static<typeof ProofDetailsSchema>>;
const verifiedProofs = new WeakMap<object, BoundAllocation>();

function readSyncJournal(directory: string, name: string): unknown {
  const fd = openSync(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600
      || info.size > MAX_JOURNAL_BYTES || (process.getuid && info.uid !== process.getuid())) {
      fail('ALLOCATION_JOURNAL_FAILED');
    }
    const value: unknown = JSON.parse(readFileSync(fd, 'utf8'));
    return value;
  } finally { closeSync(fd); }
}
function checkSyncDirectory(directory: string): void {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700
    || (process.getuid && info.uid !== process.getuid())) fail('ALLOCATION_JOURNAL_FAILED');
}
function sameReceipt(left: AllocationReceipt, right: AllocationReceipt): boolean {
  return left.id === right.id && left.created_at === right.created_at
    && left.ref === right.ref && left.name === right.name && left.apiOrigin === right.apiOrigin;
}

/** 本地受保护证据的加载器，不执行网络请求，也不授权创建或自动清理。 */
export function loadAllocationProof(env: Record<string, string | undefined>): AllocationProof | undefined {
  try {
    const field = Object.getOwnPropertyDescriptor(env, 'REAL_ACCEPTANCE_ALLOCATION_JOURNAL');
    if (!field) return undefined;
    if (!Object.hasOwn(field, 'value')) fail('ALLOCATION_INVALID');
    const directory: unknown = field.value;
    if (directory === undefined) return undefined;
    if (typeof directory !== 'string' || !isAbsolute(directory)
      || normalize(directory) !== directory || /[\u0000-\u001f\u007f]/.test(directory)) {
      fail('ALLOCATION_INVALID');
    }
    checkSyncDirectory(dirname(directory));
    checkSyncDirectory(directory);
    const intent = validateAllocationIntent(readSyncJournal(directory, 'intent.json'));
    if (basename(directory) !== intent.runId) fail('ALLOCATION_IDENTITY_MISMATCH');
    const started = decode(StartedSchema, readSyncJournal(directory, 'create-started.json'));
    if (started.runId !== intent.runId) fail('ALLOCATION_IDENTITY_MISMATCH');
    const bound = validateBoundAllocation(readSyncJournal(directory, 'bound.json'));
    if (JSON.stringify(bound.intent) !== JSON.stringify(intent)) fail('ALLOCATION_IDENTITY_MISMATCH');
    if (bound.source === 'receipt') {
      const receipt = decode(AllocationReceiptSchema, readSyncJournal(directory, 'receipt.json'));
      if (!sameReceipt(receipt, bound.receipt)) fail('ALLOCATION_IDENTITY_MISMATCH');
    } else {
      const inventory = validateInventory(readSyncJournal(directory, 'reconciliation.json'));
      for (const previous of intent.beforeInventory.projects) {
        if (!inventory.projects.some(row => row.ref === previous.ref && row.name === previous.name)) {
          fail('ALLOCATION_BASELINE_CONFLICT');
        }
      }
      const matches = inventory.projects.filter(row => row.name === intent.name);
      if (matches.length !== 1 || matches[0]?.ref !== bound.project.ref) {
        fail('ALLOCATION_RECONCILE_AMBIGUOUS');
      }
      try {
        const receipt = decode(AllocationReceiptSchema, readSyncJournal(directory, 'receipt.json'));
        if (!sameReceipt(receipt, bound.receipt)) fail('ALLOCATION_IDENTITY_MISMATCH');
      } catch (error) {
        if (systemCode(error) !== 'ENOENT') throw error;
      }
    }
    const proof = Object.freeze({
      runId: intent.runId, projectRef: bound.project.ref, projectOrigin: intent.projectOrigin,
      authorityRef: intent.authorityRef, authorityOrigin: intent.authorityOrigin,
    } satisfies AllocationProof);
    verifiedProofs.set(proof, bound);
    return proof;
  } catch (error) {
    if (error instanceof AllocationError) throw error;
    return fail('ALLOCATION_JOURNAL_FAILED');
  }
}
export function allocationProofDetails(proof: unknown): AllocationProof | undefined {
  if (typeof proof !== 'object' || proof === null) return undefined;
  const bound = verifiedProofs.get(proof);
  if (!bound) return undefined;
  return Object.freeze({
    runId: bound.intent.runId, projectRef: bound.project.ref,
    projectOrigin: bound.intent.projectOrigin, authorityRef: bound.intent.authorityRef,
    authorityOrigin: bound.intent.authorityOrigin,
  });
}
export function allocationTargetMatches(
  proof: unknown, target: { projectRef: string; baseUrl: string; runtimeUrl: string },
): boolean {
  const details = allocationProofDetails(proof);
  return details !== undefined && target.projectRef === details.projectRef
    && target.baseUrl === `${details.projectOrigin}/api`
    && target.runtimeUrl === `${details.authorityOrigin}/auth/v1`;
}

export async function createAllocationJournal(root: string, value: unknown): Promise<AllocationJournal> {
  const intent = validateAllocationIntent(value);
  try {
    await privateDirectory(root);
    const directory = join(root, intent.runId);
    await mkdir(directory, { mode: 0o700 });
    await writeNew(directory, 'intent.json', intent);
    const parent = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await parent.sync(); } finally { await parent.close(); }
    return journal(directory, intent);
  } catch { return fail('ALLOCATION_JOURNAL_FAILED'); }
}
export async function openAllocationJournal(root: string, runId: string): Promise<AllocationJournal> {
  decode(AllocationRunIdSchema, runId);
  try {
    await privateDirectory(root);
    const directory = join(root, runId);
    const intent = validateAllocationIntent(await readOptional(directory, 'intent.json'));
    if (intent.runId !== runId) fail('ALLOCATION_IDENTITY_MISMATCH');
    const unknown = await readOptional(directory, 'create-unknown.json');
    if (unknown !== undefined && decode(UnknownSchema, unknown).runId !== runId) fail('ALLOCATION_INVALID');
    return journal(directory, intent);
  } catch (error) {
    if (error instanceof AllocationError) throw error;
    return fail('ALLOCATION_JOURNAL_FAILED');
  }
}
