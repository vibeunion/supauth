#!/usr/bin/env bun
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { JsonObjectSchema, decodeSchema, type JsonObject } from '../packages/shared/src/schema.js';
import {
  planRealContractCors, inspectRealContractCorsReadback, planRealContractCorsUndo,
  REAL_CONTRACT_CORS_SCOPE, type RealContractCorsPlan,
} from './real-contract-cors.js';

const ADMIN = 'http://127.0.0.1:2019';
const BACKUP = `/etc/supacloud/caddy/contract-${REAL_CONTRACT_CORS_SCOPE.runId}-runtime-before.json`;
function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
export interface CorsSnapshot { config: JsonObject; etag: string; }
export interface CorsTransport {
  read(): Promise<CorsSnapshot>;
  patch(path: string, value: string[], etag: string): Promise<void>;
}

export async function applyCorsPlan(
  plan: RealContractCorsPlan, transport: CorsTransport, undo = false,
): Promise<number> {
  const initial = await transport.read();
  const patches = undo ? planRealContractCorsUndo(plan, initial.config) : plan.patches;
  inspectRealContractCorsReadback(plan, initial.config);
  let count = 0;
  for (const patch of patches) {
    const current = await transport.read();
    const readback = inspectRealContractCorsReadback(plan, current.config);
    const candidates = undo ? readback.appliedPaths : readback.pendingPaths;
    if (!candidates.includes(patch.path)) throw new Error('CORS_OPERATION_STATE_CHANGED');
    await transport.patch(patch.path, patch.next, current.etag);
    const after = inspectRealContractCorsReadback(plan, (await transport.read()).config);
    if (!(undo ? after.pendingPaths : after.appliedPaths).includes(patch.path)) {
      throw new Error('CORS_PATCH_READBACK_FAILED');
    }
    count += 1;
  }
  const final = inspectRealContractCorsReadback(plan, (await transport.read()).config);
  if (!(undo ? final.restored : final.complete)) throw new Error('CORS_INCOMPLETE');
  return count;
}

async function readSnapshot(): Promise<CorsSnapshot> {
  const response = await fetch(`${ADMIN}/config/`, {
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) throw new Error('CORS_CONFIG_READ_FAILED');
  const etag = response.headers.get('etag');
  if (!etag || etag.length > 512 || !/^"[^"\r\n]+"$/.test(etag)) {
    throw new Error('CORS_CAS_UNAVAILABLE');
  }
  const value: unknown = await response.json();
  return { config: decodeSchema(JsonObjectSchema, value), etag };
}

async function saveBackup(config: JsonObject) {
  const file = await open(BACKUP, constants.O_WRONLY | constants.O_CREAT
    | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(JSON.stringify(config));
    await file.sync();
  } finally { await file.close(); }
  const directory = await open('/etc/supacloud/caddy', constants.O_RDONLY | constants.O_DIRECTORY);
  try { await directory.sync(); } finally { await directory.close(); }
}

async function readBackup(): Promise<JsonObject> {
  const file = await open(BACKUP, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== 0 || (info.mode & 0o777) !== 0o600) {
      throw new Error('CORS_BACKUP_IDENTITY_REJECTED');
    }
    const value: unknown = JSON.parse(await file.readFile('utf8'));
    return decodeSchema(JsonObjectSchema, value);
  } finally { await file.close(); }
}

async function main() {
  if (hostname() !== 'i.pigsty' || process.getuid?.() !== 0
    || !Object.values(networkInterfaces()).some(entries =>
      entries?.some(entry => entry.address === '192.168.200.112'))) {
    throw new Error('TEST_HOST_IDENTITY_REJECTED');
  }
  const mode = Bun.argv[2];
  const current = await readSnapshot();
  const beforeHash = hash(JSON.stringify(current.config));
  const plan = planRealContractCors(mode === 'rollback' ? await readBackup() : current.config);
  if (mode === 'plan') {
    console.log(JSON.stringify({
      mode, beforeHash, etagAvailable: true, temporaryRuntimeOnly: true,
      patches: plan.patches.map(patch => ({
        path: patch.path, originalCount: patch.original.length,
        appendedOrigin: REAL_CONTRACT_CORS_SCOPE.origin,
      })),
    }));
    return;
  }
  if (mode !== 'apply' && mode !== 'rollback') throw new Error('CORS_MODE_INVALID');
  if (Bun.argv[3] !== beforeHash) throw new Error('CORS_EXPECTED_HASH_MISMATCH');
  if (mode === 'apply') {
    if (plan.patches.length === 0) throw new Error('CORS_ALREADY_PRESENT');
    await saveBackup(current.config);
  }
  const changed = await applyCorsPlan(plan, {
    read: readSnapshot,
    async patch(path, value, etag) {
      const response = await fetch(`${ADMIN}${path}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify(value), redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      if (response.status !== 200) throw new Error(response.status === 412
        ? 'CORS_CONCURRENT_CHANGE' : 'CORS_PATCH_OUTCOME_UNVERIFIED');
    },
  }, mode === 'rollback');
  const afterHash = hash(JSON.stringify((await readSnapshot()).config));
  console.log(JSON.stringify({
    mode, changed, beforeHash, afterHash, backupPath: BACKUP,
    temporaryRuntimeOnly: true, browserAcceptancePassed: false,
  }));
}

if (import.meta.main) {
  try { await main(); } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message : 'CORS_HOST_OPERATION_FAILED';
    console.error(JSON.stringify({ code, outcome: 'inspect-before-retry' }));
    process.exitCode = 1;
  }
}
