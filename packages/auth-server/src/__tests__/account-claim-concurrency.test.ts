import { beforeEach, describe, expect, mock, test } from 'bun:test';

const CLAIM_SECRET = 'account-claim-concurrency-secret';
const CLAIM_PROOF = 'claim-proof-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const INITIAL_PASSWORD = 'Init123!';

let releaseSelects: (() => void) | null = null;
let expectedSelects = 1;
let selectCount = 0;
let deactivateBeforeReservation = false;
let accountRecord: Record<string, any>;

function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function resetSelectBarrier(count: number): void {
  expectedSelects = count;
  selectCount = 0;
  releaseSelects = null;
}

async function waitForSelectBarrier(): Promise<void> {
  selectCount += 1;
  if (selectCount >= expectedSelects) releaseSelects?.();
  if (expectedSelects === 1) return;
  await new Promise<void>((resolve) => {
    if (selectCount >= expectedSelects) resolve();
    else releaseSelects = resolve;
  });
}

function applyMutation(values: Record<string, unknown>): Record<string, any>[] {
  const isReservation = typeof values.claimOperationId === 'string';
  if (isReservation) {
    if (deactivateBeforeReservation) {
      accountRecord.sourceStatus = 'terminated';
      deactivateBeforeReservation = false;
    }
    if (!['active', '正常'].includes(accountRecord.sourceStatus)) return [];
    const leaseActive = accountRecord.claimLeaseExpiresAt instanceof Date
      && accountRecord.claimLeaseExpiresAt > new Date();
    if (accountRecord.claimState === 'pending' && values.claimMode === 'set_on_claim') return [];
    if (accountRecord.claimState !== 'ready' && leaseActive) return [];
  }
  Object.assign(accountRecord, values);
  return [{ ...accountRecord }];
}

function mutationQuery(values: Record<string, unknown>) {
  let mutationResult: Record<string, any>[] | null = null;
  const applyOnce = () => {
    mutationResult ||= applyMutation(values);
    return mutationResult;
  };
  return {
    returning: async () => applyOnce(),
    then: (resolve: (rows: Record<string, any>[]) => unknown) => Promise.resolve(applyOnce()).then(resolve),
  };
}

const database = {
  select: mock(() => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          const snapshot = { ...accountRecord };
          await waitForSelectBarrier();
          return [snapshot];
        },
      }),
    }),
  })),
  update: mock(() => ({
    set: (values: Record<string, unknown>) => ({ where: () => mutationQuery(values) }),
  })),
};

const auditCalls = mock(async (_event: Record<string, unknown>) => ({ id: 'audit-event' }));
mock.module('../db/index.js', () => ({ getDb: () => database }));
mock.module('../repositories/audit.js', () => ({ logAudit: auditCalls }));

const accountProvisioning = await import('../repositories/account-provisioning.js');

function claimInput(passwordMode: 'show_initial_password' | 'set_on_claim', newPassword?: string) {
  return {
    externalId: '10086',
    externalType: 'employee',
    displayName: '张三',
    claimProof: CLAIM_PROOF,
    passwordMode,
    newPassword,
  };
}

describe('account claim atomic state machine', () => {
  beforeEach(() => {
    process.env.ACCOUNT_CLAIM_SECRET = CLAIM_SECRET;
    resetSelectBarrier(1);
    deactivateBeforeReservation = false;
    auditCalls.mockClear();
    accountRecord = {
      id: '11111111-1111-4111-8111-111111111111',
      externalId: '10086',
      externalType: 'employee',
      displayName: '张三',
      normalizedDisplayName: '张三',
      email: 'zhangsan@example.com',
      userId: '22222222-2222-4222-8222-222222222222',
      initialPasswordEncrypted: accountProvisioning.encryptInitialPassword(INITIAL_PASSWORD, CLAIM_SECRET),
      initialPasswordClaimed: false,
      claimedAt: null,
      claimCount: 0,
      claimProofHash: accountProvisioning.hashAccountClaimProof(CLAIM_PROOF),
      claimState: 'ready',
      claimMode: null,
      claimPasswordHash: null,
      claimOperationId: null,
      claimLeaseExpiresAt: null,
      sourceStatus: 'active',
      profile: {},
      importBatch: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  test('two concurrent password claims have one winner and one GoTrue update', async () => {
    resetSelectBarrier(2);
    const updatePassword = mock(async () => {});
    const input = { ...claimInput('set_on_claim', 'NewPass123!'), updatePassword };

    const outcomes = await Promise.all([
      accountProvisioning.claimAccount(input),
      accountProvisioning.claimAccount(input),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['claimed', 'unavailable']);
    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(accountRecord.initialPasswordClaimed).toBe(true);
    expect(accountRecord.claimProofHash).toBeNull();
    expect(JSON.stringify(auditCalls.mock.calls)).not.toContain(CLAIM_PROOF);
  });

  test('two concurrent initial-password claims disclose the password once', async () => {
    resetSelectBarrier(2);
    const outcomes = await Promise.all([
      accountProvisioning.claimAccount(claimInput('show_initial_password')),
      accountProvisioning.claimAccount(claimInput('show_initial_password')),
    ]);
    const disclosed = outcomes.filter((outcome) => 'initialPassword' in outcome);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['claimed', 'unavailable']);
    expect(disclosed).toHaveLength(1);
    expect(disclosed[0]).toMatchObject({ initialPassword: INITIAL_PASSWORD });
  });

  test('deactivation before the reservation CAS prevents any password update', async () => {
    deactivateBeforeReservation = true;
    const updatePassword = mock(async () => {});
    const outcome = await accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'NewPass123!'),
      updatePassword,
    });

    expect(outcome).toEqual({ status: 'unavailable' });
    expect(updatePassword).not.toHaveBeenCalled();
    expect(accountRecord.initialPasswordClaimed).toBe(false);
    expect(accountRecord.claimState).toBe('ready');
  });

  test('deactivation after the reservation still finalizes the authorized claim', async () => {
    const updateStarted = deferredSignal();
    const releaseUpdate = deferredSignal();
    const updatePassword = mock(async () => {
      accountRecord.sourceStatus = 'terminated';
      updateStarted.resolve();
      await releaseUpdate.promise;
    });
    const claimPromise = accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'NewPass123!'),
      updatePassword,
    });
    await updateStarted.promise;
    releaseUpdate.resolve();

    await expect(claimPromise).resolves.toMatchObject({ status: 'claimed', passwordSet: true });
    expect(accountRecord.sourceStatus).toBe('terminated');
    expect(accountRecord.initialPasswordClaimed).toBe(true);
    expect(updatePassword).toHaveBeenCalledTimes(1);
  });

  test('an ambiguous password update enters manual recovery and never retries', async () => {
    let updateAttempts = 0;
    const updatePassword = mock(async () => {
      updateAttempts += 1;
      throw new Error('upstream timeout');
    });

    await expect(accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'FirstPass123!'),
      updatePassword,
    })).rejects.toThrow('upstream timeout');
    accountRecord.claimLeaseExpiresAt = new Date(Date.now() - 1);
    expect(accountRecord.claimState).toBe('password_update_unknown');

    const changedPassword = await accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'DifferentPass123!'),
      updatePassword,
    });
    expect(changedPassword).toEqual({ status: 'unavailable' });
    expect(updatePassword).toHaveBeenCalledTimes(1);

    const resumed = await accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'FirstPass123!'),
      updatePassword,
    });
    expect(resumed).toEqual({ status: 'unavailable' });
    expect(updateAttempts).toBe(1);
  });

  test('does not retry an unresolved updater after its lease expires', async () => {
    const updateStarted = deferredSignal();
    const releaseUpdate = deferredSignal();
    const updatePassword = mock(async () => {
      updateStarted.resolve();
      await releaseUpdate.promise;
    });
    const firstClaim = accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'FirstPass123!'),
      updatePassword,
    });
    await updateStarted.promise;
    accountRecord.claimLeaseExpiresAt = new Date(Date.now() - 1);

    const secondClaim = await accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'FirstPass123!'),
      updatePassword,
    });
    expect(secondClaim).toEqual({ status: 'unavailable' });
    expect(updatePassword).toHaveBeenCalledTimes(1);

    releaseUpdate.resolve();
    await expect(firstClaim).resolves.toMatchObject({ status: 'claimed', passwordSet: true });
    expect(updatePassword).toHaveBeenCalledTimes(1);
  });

  test('a definitive password rejection releases the reservation for correction', async () => {
    const rejectedUpdate = mock(async () => { throw new Error('weak password'); });
    await expect(accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'RejectedPass123!'),
      updatePassword: rejectedUpdate,
      isDefinitivePasswordRejection: () => true,
    })).rejects.toThrow('weak password');

    expect(accountRecord.claimState).toBe('ready');
    expect(accountRecord.claimPasswordHash).toBeNull();
    expect(accountRecord.claimProofHash).not.toBeNull();

    const acceptedUpdate = mock(async () => {});
    const corrected = await accountProvisioning.claimAccount({
      ...claimInput('set_on_claim', 'CorrectedPass123!'),
      updatePassword: acceptedUpdate,
    });
    expect(corrected).toMatchObject({ status: 'claimed', passwordSet: true });
    expect(acceptedUpdate).toHaveBeenCalledTimes(1);
  });
});
