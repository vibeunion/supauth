import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';

const templateId = 'template-one';
const request = { name: 'Fixture organization', creatorUserId: 'user-one' };
const requestHash = createHash('sha256').update(JSON.stringify({ templateId, ...request })).digest('hex');
const validResult = {
  org: {
    id: 'org-one', name: 'Fixture organization', description: '', members: [],
    created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z',
  },
  template: {
    id: templateId, name: 'Fixture template', templateRoles: [], templateScopes: [],
    createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
  },
  rolesCreated: 0,
};
let persisted: unknown = validResult;
let storedHash = requestHash;
let storedStatus = 'completed';
let selections = 0;
const adapterAccess = mock(() => { throw new Error('Unexpected remote mutation'); });
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => ++selections === 1
          ? [{ id: templateId, name: 'Fixture template', templateRoles: [], templateScopes: [] }]
          : [{ requestHash: storedHash, templateId, status: storedStatus, result: persisted }],
      }),
    }),
  }),
  insert: () => ({
    values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
  }),
};
mock.module('../db/index.js', () => ({ getDb: () => db }));
mock.module('../supacloud/adapter.js', () => ({ getSupaCloudAdapter: adapterAccess }));
const { instantiateFromTemplate } = await import('../repositories/organization-templates.js');
const replay = () => instantiateFromTemplate(templateId, request, { idempotencyKey: 'fixture-key' });

beforeEach(() => {
  persisted = validResult;
  storedHash = requestHash;
  storedStatus = 'completed';
  selections = 0;
  adapterAccess.mockClear();
});

describe('persisted organization template replay', () => {
  test('decodes completed JSONB while retaining string timestamps and no side effects', async () => {
    expect(await replay()).toEqual({ ...validResult, replayed: true });
    expect(adapterAccess).not.toHaveBeenCalled();
  });

  test.each([
    { unrelated: true }, [], 'invalid', null,
    { ...validResult, org: { ...validResult.org, id: 123 } },
    { ...validResult, rolesCreated: 'one' },
    { ...validResult, template: { ...validResult.template, name: null } },
  ].map(result => ({ result })))('rejects malformed completed JSONB without exposing it: %j', async ({ result }) => {
    persisted = result;
    await expect(replay()).rejects.toMatchObject({
      status: 503, code: 'idempotency_state_unavailable',
    });
    expect(adapterAccess).not.toHaveBeenCalled();
  });

  test('retains request-hash conflicts before replay validation', async () => {
    storedHash = 'different';
    persisted = { unrelated: true };
    await expect(replay()).rejects.toMatchObject({ status: 409, code: 'idempotency_key_reused' });
    expect(adapterAccess).not.toHaveBeenCalled();
  });

  test('retains in-progress conflicts without attempting another mutation', async () => {
    storedStatus = 'pending';
    await expect(replay()).rejects.toMatchObject({ status: 409, code: 'organization_template_operation_in_progress' });
    expect(adapterAccess).not.toHaveBeenCalled();
  });
});
