// Sign-in Experience and Auth Config routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as sieRepo from '../repositories/sign-in-experience.js';
import * as connectorRepo from '../repositories/connectors.js';
import * as auditRepo from '../repositories/audit.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { getConfig } from '../config/index.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, unlink, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const adapter = getSupaCloudAdapter();
const config = getConfig();

const CUSTOM_UI_DIR = path.resolve(import.meta.dir, '../../custom-ui');

async function audit(eventType: string, resourceType: string, resourceId: string) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin' }); } catch {}
}

function runtimeInternalUrl(path: string) {
  const base = config.oauthRuntimeInternalUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

async function getSupaCloudSignInSource(applicationId?: string) {
  const [projectResult, applicationResult] = await Promise.allSettled([
    adapter.getProject(),
    applicationId ? adapter.getOAuthClient(applicationId) : Promise.resolve(null),
  ]);
  return {
    project: projectResult.status === 'fulfilled' && projectResult.value && typeof projectResult.value === 'object'
      ? projectResult.value as Record<string, unknown>
      : null,
    application: applicationResult.status === 'fulfilled' && applicationResult.value && typeof applicationResult.value === 'object'
      ? applicationResult.value as Record<string, unknown>
      : null,
  };
}

interface ProviderInfo {
  id: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

interface ConnectorConfigInfo {
  id: string;
  provider_id?: string;
  name?: string;
  category?: string;
  enabled?: boolean;
}

const CREDENTIAL_PROVIDER_IDS = new Set(['email', 'phone', 'password']);

function sanitizeConnector(provider: ProviderInfo, config?: ConnectorConfigInfo) {
  return {
    id: String(provider.id),
    name: config?.name || provider.name || provider.id,
    type: config?.category || provider.type || 'social',
  };
}

export function resolvePublicConnectors(
  providers: ProviderInfo[],
  connectorConfigs: ConnectorConfigInfo[],
) {
  const enabledByProviderId = new Map(
    connectorConfigs
      .filter(config => config.enabled === true)
      .map(config => [String(config.provider_id || config.id), config]),
  );

  return providers
    .filter(provider => {
      if (!provider.id || CREDENTIAL_PROVIDER_IDS.has(provider.id)) return false;
      return provider.enabled === true && enabledByProviderId.has(provider.id);
    })
    .map(provider => sanitizeConnector(provider, enabledByProviderId.get(provider.id)));
}

async function getEnabledConnectors(): Promise<Array<{ id: string; name: string; type: string }>> {
  try {
    const [providers, connectorConfigs] = await Promise.all([
      adapter.listProviders() as Promise<ProviderInfo[]>,
      connectorRepo.listEnabledConnectorConfigs(),
    ]);
    if (!Array.isArray(providers)) return [];
    return resolvePublicConnectors(providers, connectorConfigs);
  } catch {
    return [];
  }
}

export function resolveDesiredSignupEnabled(authConfig: Record<string, unknown>): boolean {
  if (authConfig.disable_signup === true) return false;
  if (authConfig.enable_signup === false) return false;
  if (typeof authConfig.disable_signup === 'boolean') return authConfig.disable_signup === false;
  if (typeof authConfig.enable_signup === 'boolean') return authConfig.enable_signup;
  return true;
}

export function resolveRuntimeSignupEnabled(runtimeSettings: Record<string, unknown>): boolean {
  if (typeof runtimeSettings.disable_signup === 'boolean') return runtimeSettings.disable_signup === false;
  return true;
}

export async function getAuthConfigRuntimeConsistency(fetchImpl: typeof fetch = fetch) {
  const authConfig = await adapter.getAuthConfig() as Record<string, unknown>;
  const runtimeRes = await fetchImpl(`${config.oauthRuntimeUrl.replace(/\/$/, '')}/auth/v1/settings`);
  const runtimeSettings = await runtimeRes.json().catch(() => ({})) as Record<string, unknown>;

  if (!runtimeRes.ok) {
    throw new Error(`Runtime settings probe failed with HTTP ${runtimeRes.status}`);
  }

  const desiredSignupEnabled = resolveDesiredSignupEnabled(authConfig);
  const runtimeSignupEnabled = resolveRuntimeSignupEnabled(runtimeSettings);

  return {
    checked_at: new Date().toISOString(),
    consistent: desiredSignupEnabled === runtimeSignupEnabled,
    desired: {
      signups_enabled: desiredSignupEnabled,
      enable_signup: authConfig.enable_signup ?? null,
      disable_signup: authConfig.disable_signup ?? null,
    },
    runtime: {
      signups_enabled: runtimeSignupEnabled,
      disable_signup: runtimeSettings.disable_signup ?? null,
    },
  };
}

async function getEnabledConnector(connectorId: string) {
  try {
    const [provider, connectorConfig] = await Promise.all([
      adapter.getProvider(connectorId) as Promise<ProviderInfo | null>,
      connectorRepo.getConnectorConfig(connectorId),
    ]);
    if (!provider || !connectorConfig) return null;
    return resolvePublicConnectors([provider], [connectorConfig])[0] || null;
  } catch {
    return null;
  }
}

export const sieRoutes = new Elysia({ prefix: '/v1/sign-in-experience' })
  .get('/', async () => sieRepo.getSignInExperience(), {
    detail: { summary: 'Get sign-in experience configuration', tags: ['Sign-in Experience'] },
  })

  .get('/resolve', async ({ query }) => {
    const applicationId = (query as Record<string, unknown>).application_id;
    const appId = typeof applicationId === 'string' ? applicationId : undefined;
    return sieRepo.resolveSignInExperience(appId, await getSupaCloudSignInSource(appId));
  }, {
    detail: { summary: 'Resolve effective sign-in experience for an application', tags: ['Sign-in Experience', 'Applications'] },
  })

  .put('/', async ({ body }) => {
    const updated = await sieRepo.updateSignInExperience(body as Parameters<typeof sieRepo.updateSignInExperience>[0]);
    await audit('sign_in_experience.update', 'sign_in_experience', updated.id);
    return sieRepo.getSignInExperience();
  }, {
    detail: { summary: 'Update sign-in experience configuration', tags: ['Sign-in Experience'] },
  })

  // ─── Custom UI Assets management ────────────────────────────────────
  .post('/custom-ui-assets', async ({ body, set }) => {
    // Accept multipart upload with a zip file containing custom HTML/CSS/JS
    const data = body as Record<string, unknown>;
    const file = data.file as File | undefined;

    if (!file) {
      set.status = 400;
      return { error: 'file_required', message: 'Upload a zip file containing custom sign-in page assets (index.html required).' };
    }

    const assetsId = crypto.randomUUID();
    const tmpDir = path.join(CUSTOM_UI_DIR, `.tmp-${assetsId}`);

    try {
      // Write uploaded zip to temp location
      await mkdir(tmpDir, { recursive: true });
      const zipPath = path.join(tmpDir, 'assets.zip');
      const arrayBuf = await file.arrayBuffer();
      await Bun.write(zipPath, Buffer.from(arrayBuf));

      // Extract zip using Bun's built-in zip support
      const proc = Bun.spawnSync(['unzip', '-o', zipPath, '-d', tmpDir], {
        stderr: 'pipe',
      });
      if (proc.exitCode !== 0) {
        set.status = 500;
        return { error: 'unzip_failed', message: 'Failed to extract custom UI assets.' };
      }

      // Verify that index.html exists in extracted files
      const extractedFiles = await readdir(tmpDir);
      let hasIndexHtml = false;
      for (const f of extractedFiles) {
        if (f === 'index.html') hasIndexHtml = true;
      }
      // Also check subdirectories (common zip structure)
      if (!hasIndexHtml) {
        // Look one level deep for index.html
        for (const f of extractedFiles) {
          const subDir = path.join(tmpDir, f);
          const stat = await Bun.file(subDir).stat();
          if (stat && stat.isDirectory()) {
            try {
              const subFiles = await readdir(subDir);
              if (subFiles.includes('index.html')) {
                hasIndexHtml = true;
                // Move contents up one level
                for (const sf of subFiles) {
                  const src = path.join(subDir, sf);
                  const dst = path.join(tmpDir, sf);
                  const p = Bun.spawnSync(['mv', src, dst]);
                }
                break;
              }
            } catch {}
          }
        }
      }

      if (!hasIndexHtml) {
        set.status = 400;
        return { error: 'missing_index_html', message: 'Custom UI assets must contain an index.html.' };
      }

      // Clear existing custom UI, then move new assets into place
      if (existsSync(CUSTOM_UI_DIR)) {
        const existing = await readdir(CUSTOM_UI_DIR);
        for (const f of existing) {
          if (!f.startsWith('.tmp-')) {
            await rm(path.join(CUSTOM_UI_DIR, f), { recursive: true, force: true }).catch(() => {});
          }
        }
      }

      // Move extracted files to CUSTOM_UI_DIR (excluding zip and tmp artifacts)
      for (const f of extractedFiles) {
        if (f === 'assets.zip') continue;
        const src = path.join(tmpDir, f);
        const dst = path.join(CUSTOM_UI_DIR, f);
        Bun.spawnSync(['mv', src, dst]);
      }

      // Write marker
      await writeFile(
        path.join(CUSTOM_UI_DIR, '.assets-meta.json'),
        JSON.stringify({ assetsId, filename: file.name, uploadedAt: new Date().toISOString() }),
      );

      // Cleanup temp dir
      await rm(tmpDir, { recursive: true, force: true });

      await audit('sign_in_experience.custom_ui_uploaded', 'custom_ui_assets', assetsId);
      return { assets_id: assetsId, filename: file.name };
    } catch (error) {
      // Cleanup on failure
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      set.status = 500;
      return { error: 'upload_failed', message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, {

    detail: { summary: 'Upload custom UI assets (zip) for hosted sign-in page', tags: ['Sign-in Experience', 'Custom UI Assets'] },
  })

  .delete('/custom-ui-assets', async () => {
    try {
      const files = await readdir(CUSTOM_UI_DIR);
      for (const f of files) {
        if (f.endsWith('.json') || f.endsWith('.html') || f.endsWith('.zip')) {
          await unlink(path.join(CUSTOM_UI_DIR, f)).catch(() => {});
        }
      }
    } catch {}
    await audit('sign_in_experience.custom_ui_deleted', 'custom_ui_assets', 'all');
    return { status: 'deleted' };
  }, {
    detail: { summary: 'Delete custom UI assets, revert to default sign-in page', tags: ['Sign-in Experience', 'Custom UI Assets'] },
  });

export const publicSignInExperienceRoutes = new Elysia({ prefix: '/v1/public/sign-in-experience' })
  .get('/resolve', async ({ query }) => {
    const q = query as Record<string, unknown>;
    let applicationId = typeof q.application_id === 'string' ? q.application_id : undefined;
    let authorization: Awaited<ReturnType<typeof sieRepo.getOAuthAuthorizationContext>> | null = null;
    if (!applicationId && typeof q.authorization_id === 'string') {
      authorization = await sieRepo.getOAuthAuthorizationContext(q.authorization_id);
      applicationId = authorization?.client_id || undefined;
    }
    const [experience, connectors] = await Promise.all([
      sieRepo.resolveSignInExperience(applicationId, await getSupaCloudSignInSource(applicationId)),
      getEnabledConnectors(),
    ]);
    const result = {
      ...experience,
      connectors,
      sign_up_enabled: experience?.sign_up_enabled ?? true,
    };
    return authorization ? { ...result, authorization } : result;
  }, {
    detail: { summary: 'Resolve public effective sign-in experience for hosted login pages', tags: ['Sign-in Experience', 'Public'] },
  });

export const publicConnectorRoutes = new Elysia({ prefix: '/v1/public/connectors' })
  .get('/:connectorId/authorize', async ({ params, query, set }) => {
    const connector = await getEnabledConnector(params.connectorId);
    if (!connector) {
      set.status = 404;
      return { error: 'connector_not_enabled' };
    }

    const q = query as Record<string, unknown>;
    const redirectUri = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
    const state = typeof q.state === 'string' ? q.state : '';

    // Build GoTrue OAuth authorize URL for this provider
    const goTrueUrl = new URL('/auth/v1/authorize', config.oauthRuntimeUrl);
    goTrueUrl.searchParams.set('provider', params.connectorId);
    if (redirectUri) goTrueUrl.searchParams.set('redirect_to', redirectUri);
    if (state) goTrueUrl.searchParams.set('state', state);

    // Forward any OAuth params from the original authorize request
    const forwardedParams = ['client_id', 'redirect_uri', 'response_type', 'scope', 'code_challenge', 'code_challenge_method', 'nonce', 'resource'];
    for (const p of forwardedParams) {
      const val = q[p];
      if (typeof val === 'string') goTrueUrl.searchParams.set(p, val);
    }

    set.status = 302;
    set.headers['location'] = goTrueUrl.toString();
    return { redirect: goTrueUrl.toString() };
  }, {
    detail: { summary: 'Redirect to social/SSO connector authorization', tags: ['Public', 'Connectors'] },
  });

export const publicPhrasesRoutes = new Elysia({ prefix: '/v1/public/phrases' })
  .get('/:languageTag', async ({ params }) => {
    const phrase = await tenantConfigRepo.getTenantConfig('phrase', params.languageTag);
    if (!phrase || !phrase.enabled) {
      // Return empty object so the login page can fall back to defaults
      return { language_tag: params.languageTag, phrases: {} };
    }
    return { language_tag: params.languageTag, phrases: phrase.value || {} };
  }, {
    detail: { summary: 'Get custom phrases for a language tag', tags: ['Public', 'Tenant Config'] },
  });

export const publicCustomUiRoutes = new Elysia({ prefix: '/v1/public/custom-ui' })
  .get('/*', async ({ params, set }) => {
    const sub = (params as Record<string, string>)['*'] || 'index.html';
    // Look for custom UI assets on disk
    const filePath = path.join(CUSTOM_UI_DIR, sub);
    const f = Bun.file(filePath);
    if (!(await f.exists())) {
      set.status = 404;
      return { error: 'not_found' };
    }
    return new Response(f);
  }, {
    detail: { summary: 'Serve custom UI assets for hosted sign-in page', tags: ['Public', 'Custom UI Assets'] },
  });

export const publicOAuthRoutes = new Elysia({ prefix: '/v1/public/oauth' })
  .post('/authorizations/:authorizationId/approve', async ({ headers, params, set }) => {
    const authorizationHeader = headers.authorization || '';
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      set.status = 401;
      return { error: 'missing_bearer_token' };
    }

    const accessToken = match[1];
    const userRes = await fetch(runtimeInternalUrl('/user'), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      set.status = 401;
      return { error: 'invalid_bearer_token' };
    }
    const user = await userRes.json() as { id?: string };
    if (!user.id) {
      set.status = 401;
      return { error: 'invalid_user' };
    }

    const bound = await sieRepo.bindAuthorizationToUser(params.authorizationId, user.id);
    if (!bound) {
      set.status = 404;
      return { error: 'authorization_not_found' };
    }

    const consentRes = await fetch(runtimeInternalUrl(`/oauth/authorizations/${params.authorizationId}/consent`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'approve' }),
    });
    const payload = await consentRes.json().catch(() => ({}));
    if (!consentRes.ok) {
      set.status = consentRes.status;
      return payload;
    }
    return payload;
  }, {
    detail: { summary: 'Approve hosted OAuth authorization after SupaOAuth login', tags: ['Public', 'Consent'] },
  });

export const authConfigRoutes = new Elysia({ prefix: '/v1/auth-config' })
  .get('/', async () => adapter.getAuthConfig(), {
    detail: { summary: 'Get auth configuration (GoTrue)', tags: ['Auth Config'] },
  })
  .get('/runtime-consistency', async () => getAuthConfigRuntimeConsistency(), {
    detail: { summary: 'Compare desired auth config with GoTrue runtime settings', tags: ['Auth Config'] },
  })
  .patch('/', async ({ body }) => {
    const updated = await adapter.updateAuthConfig(body as Record<string, unknown>);
    await audit('auth_config.update', 'auth_config', config.projectRef);
    return updated;
  }, {
    detail: { summary: 'Update auth configuration (GoTrue)', tags: ['Auth Config'] },
  });
