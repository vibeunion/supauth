import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { SdkEndpointInput } from '../../../shared/src/sdk-endpoints.js';
import { ApiContractError } from '../utils/api-contract.js';

// 仅证明当前 BFF 边界。旧 7e753ed 的 routes/organizations.ts:140-144
// 在 adapter 调用之后才访问 data.user_id，不能据此声称旧请求零副作用。
const boundaryCode = 'offline_member_forwarding_observed';
const addOrganizationMember = mock(async (
  _orgId: string,
  _body: SdkEndpointInput<'addOrganizationMember'>['body'],
): Promise<never> => {
  // 只观察转发并主动终止，不伪造上游成功或实际持久化。
  throw new ApiContractError(503, boundaryCode, 'Offline member forwarding observation boundary');
});
const logAudit = mock(async () => {});

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error {},
  getSupaCloudAdapter: () => ({ addOrganizationMember }),
  isSupaCloudApiError: () => false,
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));

const { organizationRoutes } = await import('../routes/organizations.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const app = new Elysia()
  .use(observabilityMiddleware)
  .use(organizationRoutes);

function request(body: unknown) {
  return new Request('http://localhost/v1/organizations/org-one/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('organization member current request boundary', () => {
  beforeEach(() => {
    addOrganizationMember.mockClear();
    logAudit.mockClear();
  });

  test.each([
    { label: 'absent body', body: undefined },
    { label: 'null body', body: null },
    { label: 'missing user_id', body: {} },
  ])('rejects $label before adapter and audit', async ({ body }) => {
    const response = await app.handle(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request_body' } });
    expect(addOrganizationMember).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test.each([
    { label: 'user_id only', body: { user_id: 'user-one' } },
    { label: 'user_id and role', body: { user_id: 'user-one', role: 'member' } },
  ])('forwards $label exactly once without claiming persistence', async ({ body }) => {
    const response = await app.handle(request(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: boundaryCode } });
    expect(addOrganizationMember).toHaveBeenCalledTimes(1);
    expect(addOrganizationMember).toHaveBeenCalledWith('org-one', body);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
