/**
 * Real PostgreSQL account-claim concurrency gate.
 * Run with RUN_ACCOUNT_CLAIM_POSTGRES_TESTS=1 and ACCOUNT_CLAIM_POSTGRES_URL
 * pointing to a loopback database whose name ends in "claim_test".
 */

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import postgres from 'postgres';
import { MIGRATION_V12_SQL } from '../db/migrate.js';

const DATABASE_URL = process.env.ACCOUNT_CLAIM_POSTGRES_URL || '';
const CLAIM_SECRET = 'account-claim-postgres-integration-secret';
const CLAIM_PROOF = 'claim-proof-postgres-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const INITIAL_PASSWORD = 'Init123!';
const RECORD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function isDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && loopback
      && parsed.pathname.slice(1).endsWith('claim_test');
  } catch {
    return false;
  }
}

const postgresGateRequested = process.env.RUN_ACCOUNT_CLAIM_POSTGRES_TESTS === '1';
if (postgresGateRequested && !isDisposableDatabaseUrl(DATABASE_URL)) {
  throw new Error('Account claim PostgreSQL tests require a loopback disposable *_claim_test database');
}
const describePostgres = postgresGateRequested ? describe : describe.skip;

const auditCalls = mock(async (_event: Record<string, unknown>) => ({ id: 'audit-event' }));
mock.module('../repositories/audit.js', () => ({ logAudit: auditCalls }));

type AccountProvisioningModule = typeof import('../repositories/account-provisioning.js');
type AccountClaimInput = Parameters<AccountProvisioningModule['claimAccount']>[0];

let accountProvisioning: AccountProvisioningModule;
let metadataSql: ReturnType<typeof postgres>;
let closeMetadataDb: () => Promise<void>;

function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function passwordClaimInput(updatePassword: NonNullable<AccountClaimInput['updatePassword']>) {
  return {
    externalId: '10086',
    externalType: 'employee',
    displayName: '张三',
    claimProof: CLAIM_PROOF,
    passwordMode: 'set_on_claim' as const,
    newPassword: 'NewPass123!',
    updatePassword,
  };
}

async function waitForBlockedReservation(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [activity] = await metadataSql<{ blocked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%update%account_provisioning_records%'
      ) AS blocked
    `;
    if (activity.blocked) return;
    await Bun.sleep(20);
  }
  throw new Error('Timed out waiting for the claim reservation CAS to block');
}

describePostgres('account claim PostgreSQL linearization', () => {
  beforeAll(async () => {
    process.env.ACCOUNT_CLAIM_SECRET = CLAIM_SECRET;
    process.env.SUPACLOUD_DATABASE_URL = DATABASE_URL;
    metadataSql = postgres(DATABASE_URL, { max: 4 });
    await metadataSql.unsafe(`
      DROP SCHEMA IF EXISTS supaoauth CASCADE;
      CREATE SCHEMA supaoauth;
      CREATE TABLE supaoauth.account_provisioning_records (
        id UUID PRIMARY KEY,
        external_id VARCHAR(100) NOT NULL,
        external_type VARCHAR(100) NOT NULL DEFAULT 'generic',
        display_name VARCHAR(255) NOT NULL,
        normalized_display_name VARCHAR(255) NOT NULL,
        email VARCHAR(320) NOT NULL,
        user_id UUID,
        initial_password_encrypted TEXT,
        initial_password_claimed BOOLEAN NOT NULL DEFAULT false,
        claimed_at TIMESTAMPTZ,
        claim_count INTEGER NOT NULL DEFAULT 0,
        source_status VARCHAR(50) NOT NULL DEFAULT 'active',
        profile JSONB DEFAULT '{}'::jsonb,
        import_batch VARCHAR(255),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await metadataSql.unsafe(MIGRATION_V12_SQL);
    await metadataSql.unsafe(MIGRATION_V12_SQL);
    accountProvisioning = await import('../repositories/account-provisioning.js');
    ({ closeDb: closeMetadataDb } = await import('../db/index.js'));
  });

  afterAll(async () => {
    await closeMetadataDb?.();
    await metadataSql?.end();
  });

  beforeEach(async () => {
    auditCalls.mockClear();
    await metadataSql`TRUNCATE supaoauth.account_provisioning_records`;
    await metadataSql`
      INSERT INTO supaoauth.account_provisioning_records (
        id,
        external_id,
        external_type,
        display_name,
        normalized_display_name,
        email,
        user_id,
        initial_password_encrypted,
        claim_proof_hash,
        source_status
      ) VALUES (
        ${RECORD_ID}::uuid,
        '10086',
        'employee',
        '张三',
        '张三',
        'zhangsan@example.com',
        ${USER_ID}::uuid,
        ${accountProvisioning.encryptInitialPassword(INITIAL_PASSWORD, CLAIM_SECRET)},
        ${accountProvisioning.hashAccountClaimProof(CLAIM_PROOF)},
        'active'
      )
    `;
  });

  test('deactivation committed before the reservation CAS prevents the external update', async () => {
    const updatePassword = mock(async () => {});
    let claimPromise!: ReturnType<AccountProvisioningModule['claimAccount']>;

    await metadataSql.begin(async transaction => {
      await transaction`
        SELECT id
        FROM supaoauth.account_provisioning_records
        WHERE id = ${RECORD_ID}::uuid
        FOR UPDATE
      `;
      claimPromise = accountProvisioning.claimAccount(passwordClaimInput(updatePassword));
      await waitForBlockedReservation();
      await transaction`
        UPDATE supaoauth.account_provisioning_records
        SET source_status = 'terminated'
        WHERE id = ${RECORD_ID}::uuid
      `;
    });

    await expect(claimPromise).resolves.toEqual({ status: 'unavailable' });
    expect(updatePassword).not.toHaveBeenCalled();
    const [record] = await metadataSql`
      SELECT source_status, initial_password_claimed, claim_state
      FROM supaoauth.account_provisioning_records
      WHERE id = ${RECORD_ID}::uuid
    `;
    expect(record).toMatchObject({
      source_status: 'terminated',
      initial_password_claimed: false,
      claim_state: 'ready',
    });
  });

  test('deactivation after the reservation preserves the authorized final state', async () => {
    const updateStarted = deferredSignal();
    const releaseUpdate = deferredSignal();
    const updatePassword = mock(async () => {
      updateStarted.resolve();
      await releaseUpdate.promise;
    });
    const claimPromise = accountProvisioning.claimAccount(passwordClaimInput(updatePassword));
    await updateStarted.promise;
    await metadataSql`
      UPDATE supaoauth.account_provisioning_records
      SET source_status = 'terminated'
      WHERE id = ${RECORD_ID}::uuid
    `;
    releaseUpdate.resolve();

    await expect(claimPromise).resolves.toMatchObject({ status: 'claimed', passwordSet: true });
    expect(updatePassword).toHaveBeenCalledTimes(1);
    const [record] = await metadataSql`
      SELECT source_status, initial_password_claimed, claim_state, claim_count
      FROM supaoauth.account_provisioning_records
      WHERE id = ${RECORD_ID}::uuid
    `;
    expect(record).toMatchObject({
      source_status: 'terminated',
      initial_password_claimed: true,
      claim_state: 'claimed',
      claim_count: 1,
    });
  });

  test('an ambiguous external result requires manual recovery and cannot call the updater again', async () => {
    const updatePassword = mock(async () => {
      throw new Error('timeout after remote success');
    });
    await expect(accountProvisioning.claimAccount(passwordClaimInput(updatePassword)))
      .rejects.toThrow('timeout after remote success');

    const [unknownRecord] = await metadataSql`
      SELECT claim_state, claim_password_hash, claim_operation_id
      FROM supaoauth.account_provisioning_records
      WHERE id = ${RECORD_ID}::uuid
    `;
    expect(unknownRecord.claim_state).toBe('password_update_unknown');
    expect(unknownRecord.claim_password_hash).toBeString();
    expect(unknownRecord.claim_operation_id).not.toBeNull();
    await metadataSql`
      UPDATE supaoauth.account_provisioning_records
      SET claim_lease_expires_at = now() - interval '1 second'
      WHERE id = ${RECORD_ID}::uuid
    `;

    const samePassword = await accountProvisioning.claimAccount(passwordClaimInput(updatePassword));
    const differentPassword = await accountProvisioning.claimAccount({
      ...passwordClaimInput(updatePassword),
      newPassword: 'DifferentPass123!',
    });
    expect(samePassword).toEqual({ status: 'unavailable' });
    expect(differentPassword).toEqual({ status: 'unavailable' });
    expect(updatePassword).toHaveBeenCalledTimes(1);
  });

  test('a slow external update cannot be duplicated after its lease expires', async () => {
    const updateStarted = deferredSignal();
    const releaseUpdate = deferredSignal();
    const updatePassword = mock(async () => {
      updateStarted.resolve();
      await releaseUpdate.promise;
    });
    const firstClaim = accountProvisioning.claimAccount(passwordClaimInput(updatePassword));
    await updateStarted.promise;
    await metadataSql`
      UPDATE supaoauth.account_provisioning_records
      SET claim_lease_expires_at = now() - interval '1 second'
      WHERE id = ${RECORD_ID}::uuid
    `;

    const secondClaim = await accountProvisioning.claimAccount(passwordClaimInput(updatePassword));
    expect(secondClaim).toEqual({ status: 'unavailable' });
    expect(updatePassword).toHaveBeenCalledTimes(1);
    releaseUpdate.resolve();

    await expect(firstClaim).resolves.toMatchObject({ status: 'claimed', passwordSet: true });
    expect(updatePassword).toHaveBeenCalledTimes(1);
  });
});
