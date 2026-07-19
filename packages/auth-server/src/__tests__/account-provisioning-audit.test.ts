import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const accountClaimSecret = 'account-claim-secret-for-audit-test';
const originalAccountClaimSecret = process.env.ACCOUNT_CLAIM_SECRET;
const auditCalls = mock(async (_event: Record<string, unknown>) => ({ id: 'audit-one' }));
const provisionedAccount = {
  id: 'record-one',
  externalId: '10086',
  externalType: 'employee',
  displayName: '张三',
  normalizedDisplayName: '张三',
  email: 'zhangsan@example.com',
  userId: 'gotrue-user-one' as string | null,
  initialPasswordEncrypted: '',
  initialPasswordClaimed: false,
  claimedAt: null,
  claimCount: 0,
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
  update: mock(() => ({
    set: () => ({ where: async () => [] }),
  })),
};

mock.module('../db/index.js', () => ({ getDb: () => database }));
mock.module('../repositories/audit.js', () => ({ logAudit: auditCalls }));

const accountProvisioning = await import('../repositories/account-provisioning.js');

describe('account provisioning audit actor', () => {
  beforeEach(() => {
    process.env.ACCOUNT_CLAIM_SECRET = accountClaimSecret;
    provisionedAccount.initialPasswordClaimed = false;
    provisionedAccount.initialPasswordEncrypted = accountProvisioning.encryptInitialPassword(
      'Init123!',
      accountClaimSecret,
    );
    auditCalls.mockClear();
  });

  afterAll(() => {
    if (originalAccountClaimSecret === undefined) delete process.env.ACCOUNT_CLAIM_SECRET;
    else process.env.ACCOUNT_CLAIM_SECRET = originalAccountClaimSecret;
  });

  test('uses the verified GoTrue user ID and falls back to the claimed email', async () => {
    for (const expectedActorId of ['gotrue-user-one', 'zhangsan@example.com']) {
      provisionedAccount.userId = expectedActorId === 'gotrue-user-one' ? expectedActorId : null;
      await accountProvisioning.claimAccount({
        externalId: '10086',
        externalType: 'employee',
        displayName: '张三',
      });
      expect(auditCalls.mock.calls.at(-1)?.[0]).toMatchObject({
        eventType: 'account_provisioning.claimed',
        actorId: expectedActorId,
        actorType: 'user',
      });
    }
  });
});
