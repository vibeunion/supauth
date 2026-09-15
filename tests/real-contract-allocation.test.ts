import { describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allocationProofDetails, allocationTargetMatches, createAllocationJournal, loadAllocationProof,
  openAllocationJournal, TEST_IDENTITY_OWNER_REF, validateAllocationIntent, validateBoundAllocation,
  type AllocationIntent, type AllocationJournal,
} from '../scripts/real-contract-allocation.js';

const runId = '12345678-1234-4123-8123-123456789abc';
const projectRef = 'abcdefghijklmnopqrst';
function intent(): AllocationIntent {
  return {
    runId, name: `supauth-contract-${runId}`,
    managementOrigin: 'http://127.0.0.1:29190',
    projectOrigin: `https://contract-${runId}.xai.xigu.team`,
    authorityRef: TEST_IDENTITY_OWNER_REF, authorityOrigin: 'https://auth.xai.xigu.team',
    beforeInventory: { complete: true, projects: [
      { ref: TEST_IDENTITY_OWNER_REF, name: 'existing-identity-owner' },
      { ref: 'stmiwixcxpdjuftnjxqu', name: 'existing-app' },
      { ref: 'jbknfiwdgbatcxfbiopo', name: 'other-existing-app' },
    ] },
  };
}
function project() {
  return {
    id: 'new-project-id', created_at: '2026-09-09T06:00:00.000Z',
    ref: projectRef, name: intent().name, api: { url: intent().projectOrigin }, status: 'ACTIVE_HEALTHY',
  };
}
function evidence() {
  return {
    projectReadback: project(),
    authorityOrigin: 'https://auth.xai.xigu.team',
    authorityDescriptor: {
      project_ref: projectRef, mode: 'shared',
      authority_project_ref: TEST_IDENTITY_OWNER_REF, owner_project_ref: TEST_IDENTITY_OWNER_REF,
      local_gotrue_enabled: false, public_auth_route: 'owner_proxy',
      user_management: 'owner_only', configuration_management: 'owner_only',
    },
  };
}
function inventory() {
  return { complete: true, projects: [
    ...intent().beforeInventory.projects, { ref: projectRef, name: intent().name },
  ] };
}
async function withJournal(action: (journal: AllocationJournal, root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'supauth-allocation-unit-'));
  try {
    await chmod(root, 0o700);
    await action(await createAllocationJournal(root, intent()), root, join(root, runId));
  } finally { await rm(root, { recursive: true, force: true }); }
}
function target() {
  return { projectRef, baseUrl: `${intent().projectOrigin}/api`, runtimeUrl: 'https://auth.xai.xigu.team/auth/v1' };
}

describe('allocation journal, isolated local unit evidence only', () => {
  test('persists intent and started before one send, binds actual V1 receipt, brands loaded proof', async () => {
    await withJournal(async (journal, root, directory) => {
      let sends = 0;
      await journal.createOnce(async request => {
        sends++;
        expect(JSON.parse(await readFile(join(directory, 'intent.json'), 'utf8'))).toEqual(intent());
        expect(JSON.parse(await readFile(join(directory, 'create-started.json'), 'utf8')).phase).toBe('create-started');
        expect(request).toEqual({
          name: intent().name, region: 'local',
          api_domain: new URL(intent().projectOrigin).hostname,
          auth_domain: new URL(intent().projectOrigin).hostname,
        });
        return { ...project(), credentials: { service_role_key: 'private-fixture-key' }, config: { secret: 'private-config' } };
      });
      const bound = await journal.bind(evidence());
      expect(bound.project.ref).toBe(projectRef);
      expect(bound.project.status).toBe('ACTIVE_HEALTHY');
      expect(await (await openAllocationJournal(root, runId)).readBound()).toEqual(bound);
      const proof = loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: directory });
      expect(allocationTargetMatches(proof, target())).toBe(true);
      expect(allocationProofDetails(proof)?.authorityRef).toBe(TEST_IDENTITY_OWNER_REF);
      expect(allocationTargetMatches({ ...proof }, target())).toBe(false);
      expect(allocationTargetMatches(bound, target())).toBe(false);
      expect(sends).toBe(1);
      for (const name of await readdir(directory)) {
        expect((await stat(join(directory, name))).mode & 0o777).toBe(0o600);
        const text = await readFile(join(directory, name), 'utf8');
        expect(text).not.toContain('private-fixture-key');
        expect(text).not.toContain('private-config');
      }
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    });
  });
  test('unknown result survives restart and reconciles without a second POST', async () => {
    await withJournal(async (journal, root, directory) => {
      let calls = 0;
      await expect(journal.createOnce(async () => { calls++; throw new Error('credential-bearing error'); }))
        .rejects.toThrow('ALLOCATION_CREATE_UNKNOWN');
      const resumed = await openAllocationJournal(root, runId);
      await expect(resumed.createOnce(async () => { calls++; return project(); }))
        .rejects.toThrow('ALLOCATION_CREATE_ALREADY_STARTED');
      const bound = await resumed.reconcile({ ...evidence(), inventory: inventory() });
      expect(bound.source).toBe('reconciled');
      expect(allocationTargetMatches(loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: directory }), target())).toBe(true);
      expect(calls).toBe(1);
      expect(await readFile(join(directory, 'create-unknown.json'), 'utf8')).not.toContain('credential-bearing');
    });
  });
  test('concurrent and restarted handles cannot obtain a second send', async () => {
    await withJournal(async (journal, root) => {
      const resumed = await openAllocationJournal(root, runId);
      let calls = 0;
      const send = async () => { calls++; return project(); };
      const results = await Promise.allSettled([journal.createOnce(send), resumed.createOnce(send)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(calls).toBe(1);
    });
  });
  test('journal failure prevents send and cannot overwrite a previous run', async () => {
    await withJournal(async (journal, root, directory) => {
      await expect(createAllocationJournal(root, intent())).rejects.toThrow('ALLOCATION_JOURNAL_FAILED');
      await chmod(directory, 0o755);
      let calls = 0;
      await expect(journal.createOnce(async () => { calls++; return project(); })).rejects.toThrow();
      expect(calls).toBe(0);
    });
  });
  test('invalid receipt is unknown, not permission to retry', async () => {
    await withJournal(async (journal, root) => {
      await expect(journal.createOnce(async () => ({ ref: projectRef, name: intent().name })))
        .rejects.toThrow('ALLOCATION_CREATE_UNKNOWN');
      await expect((await openAllocationJournal(root, runId)).createOnce(async () => project()))
        .rejects.toThrow('ALLOCATION_CREATE_ALREADY_STARTED');
    });
  });
  test('failed authority readback does not consume reconciliation evidence', async () => {
    await withJournal(async journal => {
      await expect(journal.createOnce(async () => { throw new Error('timeout'); })).rejects.toThrow();
      await expect(journal.reconcile({
        ...evidence(), inventory: inventory(), authorityOrigin: 'https://auth.ai.xigu.team',
      })).rejects.toThrow();
      expect((await journal.reconcile({ ...evidence(), inventory: inventory() })).project.ref).toBe(projectRef);
    });
  });
  test('neither bind nor reconcile is possible before intent send marker', async () => {
    await withJournal(async journal => {
      await expect(journal.bind(evidence())).rejects.toThrow('ALLOCATION_NOT_STARTED');
      await expect(journal.reconcile({ ...evidence(), inventory: inventory() })).rejects.toThrow('ALLOCATION_NOT_STARTED');
    });
  });
  test('caller cannot mutate a validated intent during awaits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supauth-allocation-unit-'));
    try {
      const input = intent();
      const journal = await createAllocationJournal(root, input);
      input.name = 'changed-name';
      await journal.createOnce(async request => { expect(request.name).toBe(intent().name); return project(); });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  const invalidIntents: unknown[] = [
    { ...intent(), authorityRef: projectRef },
    { ...intent(), authorityOrigin: 'https://auth.ai.xigu.team' },
    { ...intent(), authorityOrigin: 'https://other.xai.xigu.team' },
    { ...intent(), authorityOrigin: 'https://auth.xai.xigu.team/' },
    { ...intent(), projectOrigin: 'http://192.168.200.112' },
    { ...intent(), projectOrigin: 'https://auth.ai.xigu.team' },
    { ...intent(), managementOrigin: 'http://127.0.0.1:9000' },
    { ...intent(), runId: '../../outside' },
    { ...intent(), name: 'existing-name' },
    { ...intent(), beforeInventory: { complete: false, projects: [] } },
    { ...intent(), beforeInventory: { complete: true, projects: [] } },
    { ...intent(), beforeInventory: { complete: true, projects: [...intent().beforeInventory.projects, intent().beforeInventory.projects[0]] } },
    { ...intent(), beforeInventory: { complete: true, projects: [...intent().beforeInventory.projects, { ref: projectRef, name: intent().name }] } },
    { ...intent(), token: 'must-not-persist' },
  ];
  for (const [index, input] of invalidIntents.entries()) {
    test(`rejects unsafe intent ${index}`, () => { expect(() => validateAllocationIntent(input)).toThrow(); });
  }
  const invalidEvidence = [
    { ...evidence(), projectReadback: { ...project(), id: 'recreated-project-id' } },
    { ...evidence(), projectReadback: { ...project(), created_at: '2026-09-09T07:00:00.000Z' } },
    { ...evidence(), projectReadback: { ...project(), ref: TEST_IDENTITY_OWNER_REF } },
    { ...evidence(), projectReadback: { ...project(), name: 'another-run' } },
    { ...evidence(), projectReadback: { ...project(), api: { url: 'https://other.xai.xigu.team' } } },
    { ...evidence(), projectReadback: { ...project(), status: 'INACTIVE' } },
    { ...evidence(), authorityOrigin: 'https://auth.ai.xigu.team' },
    { ...evidence(), authorityDescriptor: { ...evidence().authorityDescriptor, project_ref: TEST_IDENTITY_OWNER_REF } },
    { ...evidence(), authorityDescriptor: { ...evidence().authorityDescriptor, mode: 'local', local_gotrue_enabled: true } },
    { ...evidence(), authorityDescriptor: { ...evidence().authorityDescriptor, authority_project_ref: projectRef } },
  ];
  for (const [index, input] of invalidEvidence.entries()) {
    test(`rejects mismatched readback or authority ${index}`, async () => {
      await withJournal(async journal => {
        await journal.createOnce(async () => project());
        await expect(journal.bind(input)).rejects.toThrow();
      });
    });
  }
  for (const [index, rows] of [
    { complete: false, projects: inventory().projects },
    { complete: true, projects: intent().beforeInventory.projects },
    { complete: true, projects: [...inventory().projects, { ref: 'bbbbbbbbbbbbbbbbbbbb', name: intent().name }] },
    { complete: true, projects: [{ ref: projectRef, name: intent().name }] },
    { complete: true, projects: [...inventory().projects, { ref: projectRef, name: 'duplicate-id' }] },
  ].entries()) {
    test(`rejects incomplete, ambiguous or changed reconciliation inventory ${index}`, async () => {
      await withJournal(async journal => {
        await expect(journal.createOnce(async () => { throw new Error('timeout'); })).rejects.toThrow();
        await expect(journal.reconcile({ ...evidence(), inventory: rows })).rejects.toThrow();
      });
    });
  }
  test('loader rejects symlink evidence, public permissions and altered receipt', async () => {
    await withJournal(async (journal, root, directory) => {
      await journal.createOnce(async () => project());
      await journal.bind(evidence());
      const env = { REAL_ACCEPTANCE_ALLOCATION_JOURNAL: directory };
      await chmod(join(directory, 'bound.json'), 0o644);
      expect(() => loadAllocationProof(env)).toThrow();
      await chmod(join(directory, 'bound.json'), 0o600);
      await writeFile(join(directory, 'receipt.json'), JSON.stringify({
        id: project().id, created_at: project().created_at,
        ref: 'bbbbbbbbbbbbbbbbbbbb', name: intent().name, apiOrigin: intent().projectOrigin,
      }), { mode: 0o600 });
      expect(() => loadAllocationProof(env)).toThrow('ALLOCATION_IDENTITY_MISMATCH');
      await rm(join(directory, 'receipt.json'));
      await symlink(join(directory, 'intent.json'), join(directory, 'receipt.json'));
      expect(() => loadAllocationProof(env)).toThrow();
      await symlink(directory, join(root, 'alias'));
      expect(() => loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: join(root, 'alias') })).toThrow();
    });
  });
  test('loader missing configuration is optional, malformed/accessor paths are not', () => {
    expect(loadAllocationProof({})).toBeUndefined();
    expect(() => loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: 'relative/path' })).toThrow();
    const env: Record<string, string | undefined> = {};
    Object.defineProperty(env, 'REAL_ACCEPTANCE_ALLOCATION_JOURNAL', { get() { throw new Error('secret'); } });
    expect(() => loadAllocationProof(env)).toThrow('ALLOCATION_INVALID');
  });
  test('proof rejects other project/origins and path broadening', async () => {
    await withJournal(async (journal, _root, directory) => {
      await journal.createOnce(async () => project());
      const bound = await journal.bind(evidence());
      const proof = loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: directory });
      for (const mismatch of [
        { ...target(), projectRef: TEST_IDENTITY_OWNER_REF },
        { ...target(), baseUrl: `${intent().projectOrigin}/api/other` },
        { ...target(), baseUrl: `${intent().projectOrigin}/api?secret=value` },
        { ...target(), runtimeUrl: `${intent().projectOrigin}/auth/v1` },
        { ...target(), runtimeUrl: 'https://auth.ai.xigu.team/auth/v1' },
      ]) expect(allocationTargetMatches(proof, mismatch)).toBe(false);
      expect(allocationProofDetails({ ...proof })).toBeUndefined();
      expect(() => validateBoundAllocation({ ...bound, authorityOrigin: 'https://auth.ai.xigu.team' })).toThrow();
    });
  });
});
