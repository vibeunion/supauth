// Tenant-level UX configuration: captcha, message templates, domains, phrases,
// branding assets and custom profile fields.

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { ApiContractError } from '../utils/api-contract.js';
import { validateExternalDeleteAccountUrl } from '../utils/external-delete-url.js';
import { containsSecret, withoutSecrets } from '../utils/secrets.js';

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
  'account_claim',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function externalDeleteUrlInputs(accountCenterValue: unknown) {
  if (!isRecord(accountCenterValue)) return [];
  const inputs: unknown[] = [];
  const deleteAccount = isRecord(accountCenterValue.delete_account) ? accountCenterValue.delete_account : null;
  if (deleteAccount && Object.hasOwn(deleteAccount, 'url')) inputs.push(deleteAccount.url);
  if (Object.hasOwn(accountCenterValue, 'delete_account_url')) inputs.push(accountCenterValue.delete_account_url);
  return inputs;
}

function assertSafeExternalDeleteUrls(accountCenterValue: unknown) {
  const nodeEnv = getConfig().nodeEnv;
  const hasInvalidUrl = externalDeleteUrlInputs(accountCenterValue)
    .some((urlInput) => !validateExternalDeleteAccountUrl(urlInput, nodeEnv).ok);
  if (!hasInvalidUrl) return;
  throw new ApiContractError(
    400,
    'invalid_delete_account_url',
    'External delete account URL must use HTTPS without credentials or fragments; HTTP is limited to literal loopback hosts in development or test',
  );
}

export const tenantConfigRoutes = new Elysia({ prefix: '/v1/tenant-config' })
  .get('/', async ({ query }) => {
    const items = await tenantConfigRepo.listTenantConfigs(query.type as string | undefined);
    return { items: withoutSecrets(items), total: items.length, page: 1, limit: items.length || 50 };
  }, {
    detail: { summary: 'List tenant UX configuration records', tags: ['Tenant Config'] },
  })
  .get('/:type/:key', async ({ params }) => {
    if (!allowedTypes.has(params.type)) return new Response('Invalid config type', { status: 400 });
    const config = await tenantConfigRepo.getTenantConfig(params.type, params.key);
    if (!config) return new Response('Not found', { status: 404 });
    return withoutSecrets(config);
  }, {
    detail: { summary: 'Get tenant UX configuration record', tags: ['Tenant Config'] },
  })
  .put('/:type/:key', async ({ params, body }) => {
    if (!allowedTypes.has(params.type)) return new Response('Invalid config type', { status: 400 });
    const data = body as { value?: Record<string, unknown>; enabled?: boolean };
    if (params.type === 'captcha') return updateCaptchaConfig(params.key, data);
    if (params.type === 'account_center') assertSafeExternalDeleteUrls(data.value);
    if (containsSecret(data.value)) {
      throw new ApiContractError(400, 'secret_not_allowed', 'Secrets must be stored through a supported SupaCloud secret-backed configuration API');
    }
    return withoutSecrets(await tenantConfigRepo.upsertTenantConfig(params.type, params.key, {
      value: data.value,
      enabled: data.enabled,
    }));
  }, {
    detail: { summary: 'Create or update tenant UX configuration record', tags: ['Tenant Config'] },
  })
  .delete('/:type/:key', async ({ params }) => {
    if (!allowedTypes.has(params.type)) return new Response('Invalid config type', { status: 400 });
    if (params.type === 'captcha') await adapter.updateAuthConfig({ security_captcha_enabled: false });
    const config = await tenantConfigRepo.deleteTenantConfig(params.type, params.key);
    if (!config) return new Response('Not found', { status: 404 });
    return withoutSecrets(config);
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

async function updateCaptchaConfig(
  key: string,
  input: { value?: Record<string, unknown>; enabled?: boolean },
) {
  const existing = await tenantConfigRepo.getTenantConfig('captcha', key);
  const provider = typeof input.value?.provider === 'string' ? input.value.provider : 'none';
  const secret = typeof input.value?.secret === 'string' ? input.value.secret.trim() : '';
  const enabled = input.enabled === true && provider !== 'none';
  const authPatch: Record<string, unknown> = {
    security_captcha_enabled: enabled,
    security_captcha_provider: provider,
    ...(secret ? { security_captcha_secret: secret } : {}),
  };
  await adapter.updateAuthConfig(authPatch);
  await verifyCaptchaReadBack(enabled, provider);

  const existingValue = existing?.value && typeof existing.value === 'object' ? existing.value : {};
  const safeValue = withoutSecrets({ ...existingValue, ...input.value, provider }) as Record<string, unknown>;
  safeValue.secret_configured = secret.length > 0 || safeValue.secret_configured === true;
  return withoutSecrets(await tenantConfigRepo.upsertTenantConfig('captcha', key, {
    value: safeValue,
    enabled,
  }));
}

async function verifyCaptchaReadBack(enabled: boolean, provider: string) {
  const runtimeConfig = await adapter.getAuthConfig() as Record<string, unknown>;
  const runtimeEnabled = runtimeConfig.security_captcha_enabled === true;
  const runtimeProvider = String(runtimeConfig.security_captcha_provider || 'none');
  if (runtimeEnabled !== enabled || runtimeProvider !== provider) {
    throw new ApiContractError(502, 'runtime_config_mismatch', 'GoTrue CAPTCHA configuration read-back did not match the requested policy');
  }
}
