import { expect, test } from 'bun:test';
import { decodeSchema, Type } from '../schema.js';
import { serverManagementContracts } from '../server-management.js';
import { serverConfigurationContracts } from '../server-configuration.js';
import { accountRouteContract } from '../server-account.js';
import { CursorResponseSchema } from '../core.js';
import { CursorListResponseSchema } from '../sdk-models.js';

function managementInput(key: string) {
  const entry = serverManagementContracts[key];
  if (!entry) throw new Error(`Missing fixture contract: ${key}`);
  return entry.contract.input;
}

test('management query normalization retains string pagination and rejects wrong values', () => {
  const schema = managementInput('GET /v1/users');
  expect(decodeSchema(schema, { query: { page: '2', limit: '10' } })).toEqual({ query: { page: '2', limit: '10' } });
  expect(() => decodeSchema(schema, {})).not.toThrow();
  expect(() => decodeSchema(schema, { query: { page: [] } })).toThrow();
});

test('template instantiation keeps request-id fallback instead of making SDK headers mandatory', () => {
  const schema = managementInput('POST /v1/org-templates/:templateId/instantiate');
  const input = { params: { templateId: 'template-one' }, body: { name: 'Organization', creator_user_id: 'creator' } };
  expect(() => decodeSchema(schema, input)).not.toThrow();
  expect(() => decodeSchema(schema, { ...input, headers: { 'x-request-id': 'request-one' } })).not.toThrow();
  expect(() => decodeSchema(schema, { ...input, body: { name: 42 } })).toThrow();
});

test('shared contract construction preserves protocol alternatives and signed hook errors', () => {
  const update = serverManagementContracts['PUT /v1/resources/:resourceId']?.contract.responses[200];
  expect(update?.alternatives?.map(branch => branch.kind)).toEqual(['validated', 'empty']);
  const config = serverConfigurationContracts['PUT /v1/tenant-config/:type/:key'];
  expect(config?.contract.responses[400]?.alternatives).toHaveLength(2);
  const signed = accountRouteContract('accessToken').responses[401];
  const schema = signed?.schema;
  if (!schema) throw new Error('Expected signed hook error schema');
  expect(() => decodeSchema(schema, 'Unauthorized auth hook request')).not.toThrow();
});

test('SDK cursor responses reuse the shared factory without changing their wire shape', () => {
  expect(CursorListResponseSchema).toBe(CursorResponseSchema);
  const schema = CursorListResponseSchema(Type.String());
  expect(decodeSchema(schema, { items: ['one'], total: 1, limit: 10, next_cursor: null }))
    .toEqual({ items: ['one'], total: 1, limit: 10, next_cursor: null });
  expect(() => decodeSchema(schema, { items: ['one'], total: 1, next_cursor: null })).toThrow();
});
