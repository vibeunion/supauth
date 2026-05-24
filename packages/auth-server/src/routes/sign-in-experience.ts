// Sign-in Experience and Auth Config routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as sieRepo from '../repositories/sign-in-experience.js';
import * as auditRepo from '../repositories/audit.js';
import { getConfig } from '../config/index.js';

const adapter = getSupaCloudAdapter();
const config = getConfig();

async function audit(eventType: string, resourceType: string, resourceId: string) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin' }); } catch {}
}

export const sieRoutes = new Elysia({ prefix: '/v1/sign-in-experience' })
  .get('/', async () => sieRepo.getSignInExperience(), {
    detail: { summary: 'Get sign-in experience configuration', tags: ['Sign-in Experience'] },
  })
  .put('/', async ({ body }) => {
    const updated = await sieRepo.updateSignInExperience(body as Parameters<typeof sieRepo.updateSignInExperience>[0]);
    await audit('sign_in_experience.update', 'sign_in_experience', updated.id);
    return sieRepo.getSignInExperience();
  }, {
    detail: { summary: 'Update sign-in experience configuration', tags: ['Sign-in Experience'] },
  });

export const authConfigRoutes = new Elysia({ prefix: '/v1/auth-config' })
  .get('/', async () => adapter.getAuthConfig(), {
    detail: { summary: 'Get auth configuration (GoTrue)', tags: ['Auth Config'] },
  })
  .patch('/', async ({ body }) => {
    const updated = await adapter.updateAuthConfig(body as Record<string, unknown>);
    await audit('auth_config.update', 'auth_config', config.projectRef);
    return updated;
  }, {
    detail: { summary: 'Update auth configuration (GoTrue)', tags: ['Auth Config'] },
  });
