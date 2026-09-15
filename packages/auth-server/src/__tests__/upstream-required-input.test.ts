import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { SdkEndpointInput } from '../../../shared/src/sdk-endpoints.js';
import { ApiContractError } from '../utils/api-contract.js';

// 上游依据：SupaCloud d5ec697285edf4491befd5499807ddb8d33554cf，
// packages/management-api/src/routes/project-organizations.ts:278-289、
// routes/project-rbac.ts:87-102、services/project-rbac.service.ts:956-971。
// 旧 SupAuth 7e753ed 的 adapter 不补 body，也不从 scope 推导 name。
// 此测试锁定本地拒绝边界；真实上游证据见 compatibility-audit-accounts.md。
const boundaryCode = 'offline_forwarding_observed';
function stopAtUpstreamBoundary(): never {
  // 有效输入只观察转发，主动终止，不伪造上游写入成功。
  throw new ApiContractError(503, boundaryCode, 'Offline forwarding observation boundary');
}

const updateOrganizationBranding = mock(async (
  _orgId: string,
  _body: SdkEndpointInput<'updateOrganizationBranding'>['body'],
) => stopAtUpstreamBoundary());
const createPermission = mock(async (
  _roleId: string,
  _body: SdkEndpointInput<'createRolePermission'>['body'],
) => stopAtUpstreamBoundary());
const logAudit = mock(async () => {});

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error {},
  getSupaCloudAdapter: () => ({ updateOrganizationBranding, createPermission }),
  isSupaCloudApiError: () => false,
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));

const { organizationRoutes } = await import('../routes/organizations.js');
const { roleRoutes } = await import('../routes/roles.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const app = new Elysia()
  .use(observabilityMiddleware)
  .use(organizationRoutes)
  .use(roleRoutes);

function request(method: 'PUT' | 'POST', path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('upstream-required inputs fail at the BFF boundary', () => {
  beforeEach(() => {
    updateOrganizationBranding.mockClear();
    createPermission.mockClear();
    logAudit.mockClear();
  });

  test.each([
    { label: 'absent body', body: undefined },
    { label: 'null body', body: null },
  ])('rejects organization branding $label before upstream', async ({ body }) => {
    const response = await app.handle(request('PUT', '/v1/organizations/org-one/branding', body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request_body' } });
    expect(updateOrganizationBranding).not.toHaveBeenCalled();
    expect(createPermission).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test.each([
    { label: 'absent body', body: undefined },
    { label: 'null body', body: null },
    { label: 'empty object', body: {} },
    { label: 'scope_id without name', body: { scope_id: 'scope-one' } },
    { label: 'scopeId without name', body: { scopeId: 'scope-one' } },
  ])('rejects role permission $label before upstream', async ({ body }) => {
    const response = await app.handle(request('POST', '/v1/roles/role-one/permissions', body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request_body' } });
    expect(createPermission).not.toHaveBeenCalled();
    expect(updateOrganizationBranding).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test.each([
    { label: 'empty branding', body: {} },
    { label: 'branding value', body: { logo_url: 'https://example.test/logo.png' } },
  ])('forwards valid $label exactly once without claiming persistence', async ({ body }) => {
    const response = await app.handle(request('PUT', '/v1/organizations/org-one/branding', body));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: boundaryCode } });
    expect(updateOrganizationBranding).toHaveBeenCalledTimes(1);
    expect(updateOrganizationBranding).toHaveBeenCalledWith('org-one', body);
    expect(createPermission).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('forwards a named permission exactly once without claiming persistence', async () => {
    const body = { name: 'project.read', scope_id: 'scope-one' };
    const response = await app.handle(request('POST', '/v1/roles/role-one/permissions', body));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: boundaryCode } });
    expect(createPermission).toHaveBeenCalledTimes(1);
    expect(createPermission).toHaveBeenCalledWith('role-one', body);
    expect(updateOrganizationBranding).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
