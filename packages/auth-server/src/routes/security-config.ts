// Security configuration routes (P0-19) with OpenAPI annotations

import { Elysia } from 'elysia';
import { currentAdminRequestContext } from '../auth/request-context.js';
import { runtimeEnv } from '../config/platform-env.js';
import * as secRepo from '../repositories/security-config.js';
import * as auditRepo from '../repositories/audit.js';
import { validatedSecurityConfigUpdate } from './security-config-input.js';
import { configurationContract, decodeConfigurationInput } from '../utils/configuration-contract.js';
import { definedFields, requiredRow } from '../utils/defined-fields.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

export const securityConfigRoutes = new Elysia({ prefix: '/v1/security-config' })
  .get('/', async () => {
    decodeConfigurationInput('getSecurityConfig', {});
    const config = await secRepo.getSecurityConfig();
    if (!config) return new Response('Security config not found. Run migration first.', { status: 404 });
    return config;
  }, configurationContract('getSecurityConfig', {
    detail: { summary: 'Get security configuration', tags: ['Security'] },
  }))

  .put('/', async ({ body }) => {
    const principal = currentAdminRequestContext()?.principal;
    const update = validatedSecurityConfigUpdate(body, definedFields({
      currentAdminEmail: principal?.email,
      authorizationSource: principal?.authorization_source,
      runtimeEnvironment: runtimeEnv('NODE_ENV') || 'development',
    }));
    decodeConfigurationInput('updateSecurityConfig', { body: update });
    const updatedConfig = requiredRow(await secRepo.updateSecurityConfig(update));
    await audit('security_config.update', 'security_config', updatedConfig.id, update);
    return updatedConfig;
  }, configurationContract('updateSecurityConfig', {
    detail: { summary: 'Update security configuration', tags: ['Security'] },
  }))

  .get('/status', async () => {
    decodeConfigurationInput('getSecurityStatus', {});
    const config = await secRepo.getSecurityConfig();
    const tokenAuthAllowed = secRepo.isTokenAuthAllowed(config);

    return {
      admin_auth_mode: config?.adminAuthMode || 'auto',
      token_auth_allowed: tokenAuthAllowed,
      rate_limit_rpm: config?.rateLimitRpm || 300,
      brute_force_protection: config?.bruteForceProtection ?? true,
      enforce_https: config?.enforceHttps ?? true,
      warning_codes: [
        ...(tokenAuthAllowed ? ['admin_token_enabled'] : []),
        ...(!config ? ['security_config_missing'] : []),
      ],
      warnings: [
        ...(tokenAuthAllowed ? ['ADMIN_TOKEN auth is enabled — disable in production by setting admin_auth_mode=sso'] : []),
        ...(!config ? ['Security config not initialized — run migration'] : []),
      ],
    };
  }, configurationContract('getSecurityStatus', {
    detail: { summary: 'Get security status summary', tags: ['Security'] },
  }));
