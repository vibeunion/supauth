// Sign-in Experience and Auth Config routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as sieRepo from '../repositories/sign-in-experience.js';
import * as connectorRepo from '../repositories/connectors.js';
import { ApiContractError } from '../utils/api-contract.js';
import { containsSecret, withoutSecrets } from '../utils/secrets.js';
import * as auditRepo from '../repositories/audit.js';
import * as consentRepo from '../repositories/consents.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { getConfig } from '../config/index.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, unlink, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const adapter = getSupaCloudAdapter();
const config = getConfig();

const CUSTOM_UI_DIR = path.resolve(import.meta.dir, '../../custom-ui');

async function audit(eventType: string, resourceType: string, resourceId: string) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin' });
}

function runtimeInternalUrl(path: string) {
  const base = config.oauthRuntimeInternalUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function buildGoTrueApiUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  if (!base.pathname.endsWith('/auth/v1')) {
    base.pathname = `${base.pathname}/auth/v1`.replace(/\/+/g, '/');
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  base.pathname = `${base.pathname}${normalizedPath}`.replace(/\/+/g, '/');
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function buildRawGoTrueApiUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  base.pathname = `${base.pathname}${normalizedPath}`.replace(/\/+/g, '/');
  base.search = '';
  base.hash = '';
  return base.toString();
}

function goTrueApiBaseCandidates() {
  const values = [config.oauthRuntimeInternalUrl, config.oauthRuntimeUrl, config.publicBaseUrl].filter(Boolean);
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.replace(/\/+$/, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

async function readJsonResponse(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchGoTrueJson(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch) {
  let lastError: unknown = null;
  for (const base of goTrueApiBaseCandidates()) {
    const directInternal = base === config.oauthRuntimeInternalUrl
      && base !== config.oauthRuntimeUrl
      && base !== config.publicBaseUrl;
    const urls = directInternal
      ? [buildRawGoTrueApiUrl(base, path), buildGoTrueApiUrl(base, path)]
      : [buildGoTrueApiUrl(base, path)];
    try {
      for (const [index, url] of urls.entries()) {
        const response = await fetchImpl(url, {
          ...init,
          signal: init.signal || AbortSignal.timeout(5000),
        });
        const payload = await readJsonResponse(response);
        if (response.ok && !payload) {
          lastError = new Error(`GoTrue ${path} returned an empty success response`);
          continue;
        }
        if (directInternal && index === 0 && response.status === 404) {
          lastError = new Error(`GoTrue ${path} returned 404 from raw internal route`);
          continue;
        }
        return { response, payload };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`GoTrue ${path} request failed`);
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
  const { response: runtimeRes, payload } = await fetchGoTrueJson('/settings', {}, fetchImpl);
  const runtimeSettings = (payload || {}) as Record<string, unknown>;

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
            const subFiles = await readdir(subDir);
            if (subFiles.includes('index.html')) {
              hasIndexHtml = true;
              // Move contents up because zip archives commonly add one root folder.
              for (const sf of subFiles) {
                const src = path.join(subDir, sf);
                const dst = path.join(tmpDir, sf);
                await rename(src, dst);
              }
              break;
            }
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
            await rm(path.join(CUSTOM_UI_DIR, f), { recursive: true, force: true });
          }
        }
      }

      // Move extracted files to CUSTOM_UI_DIR (excluding zip and tmp artifacts)
      for (const f of extractedFiles) {
        if (f === 'assets.zip') continue;
        const src = path.join(tmpDir, f);
        const dst = path.join(CUSTOM_UI_DIR, f);
        await rename(src, dst);
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
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error(`Failed to clean custom UI upload directory: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
      set.status = 500;
      return { error: 'upload_failed', message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, {

    detail: { summary: 'Upload custom UI assets (zip) for hosted sign-in page', tags: ['Sign-in Experience', 'Custom UI Assets'] },
  })

  .delete('/custom-ui-assets', async () => {
    const files = existsSync(CUSTOM_UI_DIR) ? await readdir(CUSTOM_UI_DIR) : [];
    for (const f of files) {
      if (f.endsWith('.json') || f.endsWith('.html') || f.endsWith('.zip')) {
        await unlink(path.join(CUSTOM_UI_DIR, f));
      }
    }
    await audit('sign_in_experience.custom_ui_deleted', 'custom_ui_assets', 'all');
    return { status: 'deleted' };
  }, {
    detail: { summary: 'Delete custom UI assets, revert to default sign-in page', tags: ['Sign-in Experience', 'Custom UI Assets'] },
  });

export const publicSignInExperienceRoutes = new Elysia({ prefix: '/v1/public/sign-in-experience' })
  .get('/resolve', async ({ query }) => {
    const q = query as Record<string, unknown>;
    const applicationId = typeof q.application_id === 'string' ? q.application_id : undefined;
    const [experience, connectors] = await Promise.all([
      sieRepo.resolveSignInExperience(applicationId, await getSupaCloudSignInSource(applicationId)),
      getEnabledConnectors(),
    ]);
    const result = {
      ...experience,
      connectors,
      sign_up_enabled: experience?.sign_up_enabled ?? true,
    };
    return typeof q.authorization_id === 'string'
      ? { ...result, authorization_pending_authentication: true }
      : result;
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
    const authorizationId = typeof q.authorization_id === 'string' ? q.authorization_id : '';
    const state = typeof q.state === 'string' ? q.state : '';

    // Build GoTrue OAuth authorize URL for this provider
    const goTrueUrl = new URL('/auth/v1/authorize', config.oauthRuntimeUrl);
    goTrueUrl.searchParams.set('provider', params.connectorId);
    if (authorizationId) {
      const authorizationReturnUrl = new URL('/oauth/authorize', config.publicBaseUrl);
      authorizationReturnUrl.searchParams.set('authorization_id', authorizationId);
      goTrueUrl.searchParams.set('redirect_to', authorizationReturnUrl.toString());
    } else if (redirectUri) {
      goTrueUrl.searchParams.set('redirect_to', redirectUri);
    }
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

function oauthBearerToken(headers: Record<string, string | undefined>) {
  return headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function getGoTrueAuthorization(authorizationId: string, accessToken: string) {
  return fetchGoTrueJson(`/oauth/authorizations/${authorizationId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function submitGoTrueConsent(
  authorizationId: string,
  accessToken: string,
  action: 'approve' | 'deny',
) {
  return fetchGoTrueJson(`/oauth/authorizations/${authorizationId}/consent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action }),
  });
}

function goTrueOAuthPayload(
  result: Awaited<ReturnType<typeof fetchGoTrueJson>>,
  set: { status?: number | string },
) {
  if (!result.response.ok) set.status = result.response.status;
  return result.payload || {};
}

function consentDecisionContext(payload: Record<string, unknown> | null) {
  const client = payload?.client as Record<string, unknown> | undefined;
  const user = payload?.user as Record<string, unknown> | undefined;
  if (typeof client?.id !== 'string' || typeof user?.id !== 'string') {
    throw new ApiContractError(
      502,
      'invalid_upstream_response',
      'GoTrue authorization details omitted the client or user identifier',
    );
  }
  return {
    applicationId: client.id,
    userId: user.id,
    requestedScopes: typeof payload?.scope === 'string'
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [],
  };
}

async function completeGoTrueConsent(
  authorizationId: string,
  accessToken: string,
  action: 'approve' | 'deny',
) {
  const authorization = await getGoTrueAuthorization(authorizationId, accessToken);
  if (!authorization.response.ok || typeof authorization.payload?.redirect_url === 'string') {
    return authorization;
  }
  const decisionContext = consentDecisionContext(authorization.payload);
  const consent = await submitGoTrueConsent(authorizationId, accessToken, action);
  if (consent.response.ok) {
    await recordConsentDecision(authorizationId, action, decisionContext);
  }
  return consent;
}

async function recordConsentDecision(
  authorizationId: string,
  action: 'approve' | 'deny',
  context: ReturnType<typeof consentDecisionContext>,
) {
  const decision = action === 'approve' ? 'approved' : 'denied';
  await consentRepo.recordOAuthConsentDecision({ authorizationId, ...context, decision });
  await auditRepo.logAudit({
    eventType: `oauth_consent.${decision}`,
    actorId: context.userId,
    actorType: 'user',
    resourceType: 'application',
    resourceId: context.applicationId,
    details: { authorization_id: authorizationId, requested_scopes: context.requestedScopes },
  });
}

export const publicOAuthRoutes = new Elysia({ prefix: '/v1/public/oauth' })
  .get('/authorizations/:authorizationId', async ({ headers, params, set }) => {
    const accessToken = oauthBearerToken(headers);
    if (!accessToken) {
      set.status = 401;
      return { error: 'missing_bearer_token' };
    }
    try {
      return goTrueOAuthPayload(
        await getGoTrueAuthorization(params.authorizationId, accessToken),
        set,
      );
    } catch (error) {
      set.status = 502;
      return {
        error: 'gotrue_authorization_lookup_failed',
        error_description: error instanceof Error ? error.message : 'GoTrue authorization lookup failed',
      };
    }
  }, {
    detail: { summary: 'Get authoritative GoTrue OAuth authorization details', tags: ['Public', 'Consent'] },
  })
  .post('/authorizations/:authorizationId/consent', async ({ headers, params, body, set }) => {
    const accessToken = oauthBearerToken(headers);
    if (!accessToken) {
      set.status = 401;
      return { error: 'missing_bearer_token' };
    }
    const action = (body as { action?: unknown } | null)?.action;
    if (action !== 'approve' && action !== 'deny') {
      set.status = 400;
      return { error: 'validation_failed', message: "action must be 'approve' or 'deny'" };
    }
    try {
      return goTrueOAuthPayload(
        await completeGoTrueConsent(params.authorizationId, accessToken, action),
        set,
      );
    } catch (error) {
      set.status = 502;
      return {
        error: 'gotrue_consent_failed',
        error_description: error instanceof Error ? error.message : 'GoTrue consent approval failed',
      };
    }
  }, {
    detail: { summary: 'Submit an authoritative GoTrue OAuth consent decision', tags: ['Public', 'Consent'] },
  });

export const authConfigRoutes = new Elysia({ prefix: '/v1/auth-config' })
  .get('/', async () => withoutSecrets(await adapter.getAuthConfig()), {
    detail: { summary: 'Get auth configuration (GoTrue)', tags: ['Auth Config'] },
  })
  .get('/runtime-consistency', async () => getAuthConfigRuntimeConsistency(), {
    detail: { summary: 'Compare desired auth config with GoTrue runtime settings', tags: ['Auth Config'] },
  })
  .patch('/', async ({ body }) => {
    const requested = authConfigPatch(body);
    await adapter.updateAuthConfig(requested);
    const updated = await adapter.getAuthConfig() as Record<string, unknown>;
    assertAuthConfigReadBack(requested, updated);
    await audit('auth_config.update', 'auth_config', config.projectRef);
    return withoutSecrets(updated);
  }, {
    detail: { summary: 'Update auth configuration (GoTrue)', tags: ['Auth Config'] },
  });

const GOTRUE_PASSWORD_CHARACTER_POLICIES = new Set([
  '',
  'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~",
]);

function authConfigPatch(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiContractError(400, 'invalid_auth_config', 'Auth configuration must be an object');
  }
  const requested = body as Record<string, unknown>;
  if (containsSecret(requested)) {
    throw new ApiContractError(400, 'secret_not_allowed', 'Use a secret-backed typed configuration endpoint for auth secrets');
  }
  const minimumLength = requested.password_min_length;
  if (minimumLength !== undefined && (!Number.isInteger(minimumLength) || Number(minimumLength) < 6 || Number(minimumLength) > 128)) {
    throw new ApiContractError(400, 'invalid_password_policy', 'password_min_length must be an integer from 6 to 128');
  }
  const requiredCharacters = requested.password_required_characters;
  if (requiredCharacters !== undefined && (typeof requiredCharacters !== 'string' || !GOTRUE_PASSWORD_CHARACTER_POLICIES.has(requiredCharacters))) {
    throw new ApiContractError(400, 'invalid_password_policy', 'password_required_characters cannot be represented exactly by GoTrue');
  }
  return requested;
}

function assertAuthConfigReadBack(requested: Record<string, unknown>, runtime: Record<string, unknown>) {
  const mismatched = Object.entries(requested)
    .filter(([key]) => key === 'password_min_length' || key === 'password_required_characters')
    .filter(([key, value]) => runtime[key] !== value)
    .map(([key]) => key);
  if (mismatched.length > 0) {
    throw new ApiContractError(502, 'runtime_config_mismatch', 'GoTrue auth configuration read-back did not match the requested policy', {
      fields: mismatched,
    });
  }
}
