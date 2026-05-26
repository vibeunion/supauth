// Organization template routes (P0-18) with OpenAPI annotations

import { Elysia } from 'elysia';
import * as templateRepo from '../repositories/organization-templates.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export const orgTemplateRoutes = new Elysia({ prefix: '/v1/org-templates' })
  .get('/', async () => {
    const items = await templateRepo.listTemplates();
    return { items, total: items.length };
  }, {
    detail: { summary: 'List organization templates', tags: ['Organizations', 'Org Templates'] },
  })

  .get('/default', async () => {
    const template = await templateRepo.getDefaultTemplate();
    if (!template) return new Response('No default template found', { status: 404 });
    return template;
  }, {
    detail: { summary: 'Get the default organization template', tags: ['Organizations', 'Org Templates'] },
  })

  .get('/:templateId', async ({ params }) => {
    const template = await templateRepo.getTemplate(params.templateId);
    if (!template) return new Response('Not found', { status: 404 });
    return template;
  }, {
    detail: { summary: 'Get organization template by ID', tags: ['Organizations', 'Org Templates'] },
  })

  .post('/', async ({ body }) => {
    const data = body as { name: string; description?: string; template_roles?: Array<{ name: string; permissions: string[] }>; template_scopes?: Array<{ name: string; description?: string }>; is_default?: boolean };
    const template = await templateRepo.createTemplate({
      name: data.name,
      description: data.description,
      templateRoles: data.template_roles,
      templateScopes: data.template_scopes,
      isDefault: data.is_default,
    });
    await audit('org_template.create', 'org_template', template.id, { name: template.name });
    await fireWebhook('org_template.created', { template_id: template.id, name: template.name });
    return template;
  }, {
    detail: { summary: 'Create organization template', tags: ['Organizations', 'Org Templates'] },
  })

  .put('/:templateId', async ({ params, body }) => {
    const data = body as { name?: string; description?: string; template_roles?: Array<{ name: string; permissions: string[] }>; template_scopes?: Array<{ name: string; description?: string }>; is_default?: boolean };
    const updated = await templateRepo.updateTemplate(params.templateId, {
      name: data.name,
      description: data.description,
      templateRoles: data.template_roles,
      templateScopes: data.template_scopes,
      isDefault: data.is_default,
    });
    await audit('org_template.update', 'org_template', params.templateId);
    return updated;
  }, {
    detail: { summary: 'Update organization template', tags: ['Organizations', 'Org Templates'] },
  })

  .delete('/:templateId', async ({ params }) => {
    await templateRepo.deleteTemplate(params.templateId);
    await audit('org_template.delete', 'org_template', params.templateId);
  }, {
    detail: { summary: 'Delete organization template', tags: ['Organizations', 'Org Templates'] },
  })

  // ─── Instantiate org from template ───
  .post('/:templateId/instantiate', async ({ params, body }) => {
    const data = body as { name: string; description?: string; creator_user_id: string };
    const result = await templateRepo.instantiateFromTemplate(params.templateId, {
      name: data.name,
      description: data.description,
      creatorUserId: data.creator_user_id,
    });
    await audit('org_template.instantiate', 'organization', result.org.id, {
      template_id: params.templateId,
      org_name: data.name,
      roles_created: result.rolesCreated,
    });
    await fireWebhook('organization.created_from_template', {
      org_id: result.org.id,
      template_id: params.templateId,
    });
    return result;
  }, {
    detail: {
      summary: 'Create organization from template',
      description: 'Creates an org with auto-generated roles and permissions from the template. Creator is added as owner with all template roles assigned.',
      tags: ['Organizations', 'Org Templates'],
    },
  });
