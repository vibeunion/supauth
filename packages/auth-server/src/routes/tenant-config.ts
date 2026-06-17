// Tenant-level UX configuration: captcha, message templates, domains, phrases,
// branding assets and custom profile fields.

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';

const adapter = getSupaCloudAdapter();

const allowedTypes = new Set([
  'captcha',
  'email_template',
  'sms_template',
  'domain',
  'phrase',
  'profile_field',
  'branding_asset',
  'auth_hook',
  'account_center',
]);

export const tenantConfigRoutes = new Elysia({ prefix: '/v1/tenant-config' })
  .get('/', async ({ query }) => {
    const items = await tenantConfigRepo.listTenantConfigs(query.type as string | undefined);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List tenant UX configuration records', tags: ['Tenant Config'] },
  })
  .get('/:type/:key', async ({ params }) => {
    if (!allowedTypes.has(params.type)) return new Response('Invalid config type', { status: 400 });
    const config = await tenantConfigRepo.getTenantConfig(params.type, params.key);
    if (!config) return new Response('Not found', { status: 404 });
    return config;
  }, {
    detail: { summary: 'Get tenant UX configuration record', tags: ['Tenant Config'] },
  })
  .put('/:type/:key', async ({ params, body }) => {
    if (!allowedTypes.has(params.type)) return new Response('Invalid config type', { status: 400 });
    const data = body as { value?: Record<string, unknown>; enabled?: boolean };
    return tenantConfigRepo.upsertTenantConfig(params.type, params.key, {
      value: data.value,
      enabled: data.enabled,
    });
  }, {
    detail: { summary: 'Create or update tenant UX configuration record', tags: ['Tenant Config'] },
  })
  .delete('/:type/:key', async ({ params }) => {
    if (!allowedTypes.has(params.type)) return new Response('Invalid config type', { status: 400 });
    const config = await tenantConfigRepo.deleteTenantConfig(params.type, params.key);
    if (!config) return new Response('Not found', { status: 404 });
    return config;
  }, {
    detail: { summary: 'Delete tenant UX configuration record', tags: ['Tenant Config'] },
  })
  .post('/domain/:domain/check', async ({ params }) => {
    try {
      return await adapter.checkCustomDomain(params.domain);
    } catch (error) {
      return {
        domain: params.domain,
        status: 'unknown',
        checked_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, {
    detail: { summary: 'Check custom domain runtime health', tags: ['Tenant Config'] },
  });
