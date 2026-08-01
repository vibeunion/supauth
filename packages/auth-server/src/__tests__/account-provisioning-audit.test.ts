import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const accountClaimSecret = 'account-claim-secret-for-audit-test';
const accountClaimProof = 'claim-proof-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const originalAccountClaimSecret = process.env.ACCOUNT_CLAIM_SECRET;
const auditCalls = mock(async (_event: Record<string, unknown>) => ({ id: 'audit-one' }));
const updateRecord = mock((values: Record<string, unknown>) => ({
  where: () => ({
    returning: async () => {
      Object.assign(provisionedAccount, values);
      return [provisionedAccount];
    },
  }),
}));
const provisionedAccount = {
  id: 'record-one',
  externalId: '10086',
  externalType: 'employee',
  displayName: '张三',
  normalizedDisplayName: '张三',
  email: 'zhangsan@example.com',
  userId: 'gotrue-user-one' as string | null,
  initialPasswordEncrypted: '' as string | null,
  initialPasswordClaimed: false,
  claimedAt: null,
  claimCount: 0,
  claimProofHash: '' as string | null,
  claimState: 'ready',
  claimMode: null,
  claimPasswordHash: null,
  claimOperationId: null,
  claimLeaseExpiresAt: null,
  sourceStatus: 'active',
  profile: {},
  importBatch: null,
  metadata: {},
  createdAt: new Date('2026-07-20T00:00:00.000Z'),
  updatedAt: new Date('2026-07-20T00:00:00.000Z'),
};

const database = {
  select: mock(() => ({
    from: () => ({
      where: () => ({ limit: async () => [provisionedAccount] }),
    }),
  })),
  update: mock(() => ({ set: updateRecord })),
};

mock.module('../db/index.js', () => ({ getDb: () => database }));
mock.module('../repositories/audit.js', () => ({ logAudit: auditCalls }));

const accountProvisioning = await import('../repositories/account-provisioning.js');

describe('account provisioning audit actor', () => {
  beforeEach(() => {
    process.env.ACCOUNT_CLAIM_SECRET = accountClaimSecret;
    provisionedAccount.userId = 'gotrue-user-one';
    provisionedAccount.initialPasswordClaimed = false;
    provisionedAccount.claimState = 'ready';
    provisionedAccount.claimMode = null;
    provisionedAccount.claimPasswordHash = null;
    provisionedAccount.claimOperationId = null;
    provisionedAccount.claimLeaseExpiresAt = null;
    provisionedAccount.claimProofHash = accountProvisioning.hashAccountClaimProof(accountClaimProof);
    provisionedAccount.initialPasswordEncrypted = accountProvisioning.encryptInitialPassword(
      'Init123!',
      accountClaimSecret,
    );
    auditCalls.mockClear();
    updateRecord.mockClear();
  });

  afterAll(() => {
    if (originalAccountClaimSecret === undefined) delete process.env.ACCOUNT_CLAIM_SECRET;
    else process.env.ACCOUNT_CLAIM_SECRET = originalAccountClaimSecret;
  });

  test('uses the verified GoTrue user ID and falls back to the claimed email', async () => {
    for (const expectedActorId of ['gotrue-user-one', 'zhangsan@example.com']) {
      provisionedAccount.userId = expectedActorId === 'gotrue-user-one' ? expectedActorId : null;
      provisionedAccount.initialPasswordClaimed = false;
      provisionedAccount.claimState = 'ready';
      provisionedAccount.claimProofHash = accountProvisioning.hashAccountClaimProof(accountClaimProof);
      provisionedAccount.initialPasswordEncrypted = accountProvisioning.encryptInitialPassword(
        'Init123!',
        accountClaimSecret,
      );
      await accountProvisioning.claimAccount({
        externalId: '10086',
        externalType: 'employee',
        displayName: '张三',
        claimProof: accountClaimProof,
      });
      expect(auditCalls.mock.calls.at(-1)?.[0]).toMatchObject({
        eventType: 'account_provisioning.claimed',
        actorId: expectedActorId,
        actorType: 'user',
      });
    }
  });

  test('set_on_claim ignores an undecryptable historical initial password', async () => {
    provisionedAccount.initialPasswordEncrypted = accountProvisioning.encryptInitialPassword(
      'Init123!',
      'historical-account-claim-secret',
    );
    const updatePassword = mock(async () => {});

    const claimResult = await accountProvisioning.claimAccount({
      externalId: '10086',
      externalType: 'employee',
      displayName: '张三',
      claimProof: accountClaimProof,
      passwordMode: 'set_on_claim',
      newPassword: 'NewPass123!',
      updatePassword,
    });

    expect(claimResult).toEqual({
      status: 'claimed',
      email: 'zhangsan@example.com',
      passwordSet: true,
    });
    expect(updatePassword).toHaveBeenCalledWith({
      userId: 'gotrue-user-one',
      email: 'zhangsan@example.com',
      externalId: '10086',
      externalType: 'employee',
    }, 'NewPass123!');
    expect(updateRecord).toHaveBeenCalledWith(expect.objectContaining({
      initialPasswordClaimed: true,
      initialPasswordEncrypted: null,
    }));
  });

  test('show_initial_password still rejects an undecryptable initial password', async () => {
    provisionedAccount.initialPasswordEncrypted = accountProvisioning.encryptInitialPassword(
      'Init123!',
      'historical-account-claim-secret',
    );

    await expect(accountProvisioning.claimAccount({
      externalId: '10086',
      externalType: 'employee',
      displayName: '张三',
      claimProof: accountClaimProof,
      passwordMode: 'show_initial_password',
    })).rejects.toThrow();
    expect(auditCalls).not.toHaveBeenCalled();
    expect(updateRecord.mock.calls.some(([values]) => values.initialPasswordClaimed === true)).toBe(false);
  });

  test('imports only the claim proof hash into an unclaimed record', async () => {
    const saved = await accountProvisioning.upsertAccountProvisioningRecord({
      external_id: '10086',
      external_type: 'employee',
      display_name: '张三',
      email: 'zhangsan@example.com',
      claim_proof: accountClaimProof,
    });
    const updateValues = updateRecord.mock.calls.at(-1)?.[0];

    expect(updateValues?.claimProofHash).toBe(accountProvisioning.hashAccountClaimProof(accountClaimProof));
    expect(JSON.stringify(updateValues)).not.toContain(accountClaimProof);
    expect(saved.record.claimProofHash).not.toContain(accountClaimProof);
  });

  test('does not reset password or proof after an account was claimed', async () => {
    provisionedAccount.initialPasswordClaimed = true;
    provisionedAccount.initialPasswordEncrypted = null;
    provisionedAccount.claimProofHash = null;
    provisionedAccount.claimState = 'claimed';

    const saved = await accountProvisioning.upsertAccountProvisioningRecord({
      external_id: '10086',
      external_type: 'employee',
      display_name: '张三',
      email: 'zhangsan@example.com',
      initial_password: 'MustNotReset123!',
      claim_proof: accountClaimProof,
    });
    const updateValues = updateRecord.mock.calls.at(-1)?.[0];

    expect(saved.initialPassword).toBeUndefined();
    expect(updateValues?.initialPasswordEncrypted).toBeNull();
    expect(updateValues?.claimProofHash).toBeNull();
  });
});
