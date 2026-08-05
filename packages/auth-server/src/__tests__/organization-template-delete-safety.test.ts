import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Elysia } from 'elysia';
import { observabilityMiddleware } from '../middleware/index.js';

const deleteTemplate = mock(async (): Promise<'deleted' | 'protected' | 'not_found'> => 'deleted');
const createTemplate = mock(async () => ({ id: 'template-new', name: 'New template' }));
const updateTemplate = mock(async () => ({ id: 'template-one' }));
const logAudit = mock(async () => ({}));
const dispatchEvent = mock(async () => undefined);

mock.module('../repositories/organization-templates.js', () => ({
  listTemplates: mock(async () => []),
  getDefaultTemplate: mock(async () => null),
  getTemplate: mock(async () => null),
  createTemplate,
  updateTemplate,
  deleteTemplate,
  instantiateFromTemplate: mock(async () => ({
    org: { id: 'org-one' },
    rolesCreated: 0,
  })),
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));
mock.module('../repositories/webhook-delivery.js', () => ({
  buildEvent: mock(() => ({})),
  dispatchEvent,
}));

const { orgTemplateRoutes } = await import('../routes/org-templates.js');
const app = new Elysia().use(observabilityMiddleware).use(orgTemplateRoutes);

function templateMutationRequest(method: 'POST' | 'PUT', body: unknown) {
  const path = method === 'POST'
    ? '/v1/org-templates/'
    : '/v1/org-templates/template-one';
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('organization template deletion safety', () => {
  beforeEach(() => {
    createTemplate.mockClear();
    updateTemplate.mockClear();
    deleteTemplate.mockClear();
    deleteTemplate.mockResolvedValue('deleted');
    logAudit.mockClear();
    dispatchEvent.mockClear();
  });

  it.each([
    ['POST', { name: 'Invalid roles', template_roles: ['not-a-role'] }],
    ['POST', { name: 'Invalid scopes', template_scopes: [null] }],
    ['POST', { name: ' ', template_roles: [] }],
    ['POST', { template_roles: [], template_scopes: [] }],
    ['POST', { name: 'Unknown field', template_roles: [], unexpected: true }],
    ['POST', { name: 'Invalid default', is_default: 'yes' }],
    ['PUT', { template_roles: [{ name: 'reader', permissions: [42] }] }],
    ['PUT', { template_scopes: [{ name: '', description: 'Empty name' }] }],
    ['PUT', { name: '' }],
    ['PUT', { description: null }],
  ] as const)('rejects malformed %s input before side effects', async (method, body) => {
    const response = await app.handle(templateMutationRequest(method, body));
    const responseBody = await response.json() as {
      error?: { code?: string };
    };

    expect(response.status).toBe(400);
    expect(responseBody.error?.code).toBe('invalid_organization_template');
    expect(createTemplate).not.toHaveBeenCalled();
    expect(updateTemplate).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('forwards validated create and update payloads', async () => {
    const templateRoles = [{ name: 'owner', permissions: ['organizations.manage'] }];
    const templateScopes = [{ name: 'resource.read', description: 'Read resources' }];
    const createResponse = await app.handle(templateMutationRequest('POST', {
      name: 'Standard organization',
      description: 'Standard roles',
      template_roles: templateRoles,
      template_scopes: templateScopes,
      is_default: false,
    }));
    const updateResponse = await app.handle(templateMutationRequest('PUT', {
      description: 'Updated description',
      template_roles: templateRoles,
    }));

    expect(createResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(createTemplate).toHaveBeenCalledWith({
      name: 'Standard organization',
      description: 'Standard roles',
      templateRoles,
      templateScopes,
      isDefault: false,
    });
    expect(updateTemplate).toHaveBeenCalledWith('template-one', {
      name: undefined,
      description: 'Updated description',
      templateRoles,
      templateScopes: undefined,
      isDefault: undefined,
    });
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('returns a friendly conflict and skips side effects for the default template', async () => {
    deleteTemplate.mockResolvedValueOnce('protected');

    const response = await app.handle(new Request(
      'http://localhost/v1/org-templates/template-default',
      { method: 'DELETE' },
    ));
    const responseBody = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(responseBody.code).toBe('default_organization_template_protected');
    expect(responseBody.message).toBe('The default organization template cannot be deleted.');
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('distinguishes missing templates from successful deletion', async () => {
    deleteTemplate.mockResolvedValueOnce('not_found');
    const missingResponse = await app.handle(new Request(
      'http://localhost/v1/org-templates/template-missing',
      { method: 'DELETE' },
    ));

    expect(missingResponse.status).toBe(404);
    expect(logAudit).not.toHaveBeenCalled();

    const deletedResponse = await app.handle(new Request(
      'http://localhost/v1/org-templates/template-one',
      { method: 'DELETE' },
    ));

    expect(deletedResponse.status).toBe(200);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('uses an atomic non-default predicate at the repository boundary', () => {
    const repositorySource = readFileSync(
      new URL('../repositories/organization-templates.ts', import.meta.url),
      'utf8',
    );

    expect(repositorySource).toContain('eq(organizationTemplates.isDefault, false)');
    expect(repositorySource).toContain('.returning({ id: organizationTemplates.id })');
  });
});
