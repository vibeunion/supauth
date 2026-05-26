// Enterprise SSO routes (P1-9) with OpenAPI annotations

import { Elysia } from 'elysia';
import * as ssoRepo from '../repositories/enterprise-sso.js';
import * as auditRepo from '../repositories/audit.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

export const enterpriseSSORoutes = new Elysia({ prefix: '/v1/enterprise-sso' })
  .get('/', async () => {
    const items = await ssoRepo.listEnterpriseSSOConfigs();
    return { items, total: items.length };
  }, {
    detail: { summary: 'List enterprise SSO configurations', tags: ['Enterprise SSO'] },
  })

  .get('/domain/:domain', async ({ params }) => {
    const config = await ssoRepo.findSSOConfigByDomain(params.domain);
    if (!config) return new Response('No SSO config found for domain', { status: 404 });
    return config;
  }, {
    detail: { summary: 'Find SSO config by email domain (domain discovery)', tags: ['Enterprise SSO'] },
  })

  .post('/', async ({ body }) => {
    const data = body as { connector_id: string; domains: string[]; sso_protocol?: string; jit_provisioning?: boolean; org_membership_mapping?: Record<string, string>; role_mapping?: Record<string, string> };
    const config = await ssoRepo.createEnterpriseSSOConfig({
      connectorId: data.connector_id,
      domains: data.domains,
      ssoProtocol: data.sso_protocol,
      jitProvisioning: data.jit_provisioning,
      orgMembershipMapping: data.org_membership_mapping,
      roleMapping: data.role_mapping,
    });
    await audit('enterprise_sso.create', 'enterprise_sso', config.id, { connector_id: data.connector_id, domains: data.domains });
    return config;
  }, {
    detail: { summary: 'Create enterprise SSO configuration', tags: ['Enterprise SSO'] },
  })

  .put('/:id', async ({ params, body }) => {
    const data = body as { domains?: string[]; sso_protocol?: string; jit_provisioning?: boolean; org_membership_mapping?: Record<string, string>; role_mapping?: Record<string, string> };
    const updated = await ssoRepo.updateEnterpriseSSOConfig(params.id, data);
    await audit('enterprise_sso.update', 'enterprise_sso', params.id);
    return updated;
  }, {
    detail: { summary: 'Update enterprise SSO configuration', tags: ['Enterprise SSO'] },
  })

  .delete('/:id', async ({ params }) => {
    await ssoRepo.deleteEnterpriseSSOConfig(params.id);
    await audit('enterprise_sso.delete', 'enterprise_sso', params.id);
  }, {
    detail: { summary: 'Delete enterprise SSO configuration', tags: ['Enterprise SSO'] },
  });
