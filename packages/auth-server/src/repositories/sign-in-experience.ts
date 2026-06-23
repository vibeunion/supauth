// Sign-in Experience repository — backed by SupaCloud Postgres

import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { getConfig } from '../config/index.js';
import { getDb } from '../db/index.js';
import { applicationSignInExperience, signInExperience } from '../db/schema.js';

export interface SignInExperienceInput {
  branding?: {
    logo_url?: string | null;
    favicon_url?: string | null;
    primary_color?: string | null;
    page_title?: string | null;
    description?: string | null;
    background_url?: string | null;
    button_label?: string | null;
    custom_css?: string | null;
    content?: Record<string, unknown> | null;
  };
  sign_in_methods?: string[];
  sign_up_enabled?: boolean;
  mfa_required?: boolean;
  password_policy?: {
    min_length?: number;
    require_uppercase?: boolean;
    require_lowercase?: boolean;
    require_numbers?: boolean;
    require_symbols?: boolean;
  };
}

export interface ApplicationSignInExperienceInput {
  enabled?: boolean;
  branding?: SignInExperienceInput['branding'];
}

type Branding = NonNullable<SignInExperienceInput['branding']>;
type StringBrandingKey = Exclude<keyof Branding, 'content'>;

export interface SupaCloudSignInExperienceSource {
  project?: Record<string, unknown> | null;
  application?: Record<string, unknown> | null;
}

export interface OAuthAuthorizationContext {
  authorization_id: string;
  client_id: string;
  redirect_uri: string;
  scope: string | null;
  state: string | null;
  resource: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  response_type: string;
  nonce: string | null;
}

function globalToResponse(row: typeof signInExperience.$inferSelect) {
  return {
    branding: {
      logo_url: row.logoUrl,
      favicon_url: row.faviconUrl,
      primary_color: row.primaryColor,
      page_title: row.pageTitle,
      description: row.description,
      background_url: row.backgroundUrl,
      button_label: row.buttonLabel,
      custom_css: row.customCss,
      content: row.content,
    },
    sign_in_methods: row.signInMethods || [],
    sign_up_enabled: row.signUpEnabled,
    mfa_required: row.mfaRequired,
    password_policy: {
      min_length: row.passwordMinLength,
      require_uppercase: row.passwordRequireUppercase,
      require_lowercase: row.passwordRequireLowercase,
      require_numbers: row.passwordRequireNumbers,
      require_symbols: row.passwordRequireSymbols,
    },
    _meta: { id: row.id, created_at: row.createdAt, updated_at: row.updatedAt },
  };
}

function appToResponse(row: typeof applicationSignInExperience.$inferSelect) {
  return {
    application_id: row.applicationId,
    enabled: row.enabled,
    branding: {
      logo_url: row.logoUrl,
      favicon_url: row.faviconUrl,
      primary_color: row.primaryColor,
      page_title: row.pageTitle,
      background_url: row.backgroundUrl,
      button_label: row.buttonLabel,
      custom_css: row.customCss,
      content: row.content,
    },
    _meta: { id: row.id, created_at: row.createdAt, updated_at: row.updatedAt },
  };
}

function mergeBranding(
  globalBranding: Branding,
  appBranding?: Branding,
) {
  if (!appBranding) return globalBranding;
  return {
    ...globalBranding,
    ...Object.fromEntries(
      Object.entries(appBranding).filter(([, value]) => value !== null && value !== undefined && value !== ''),
    ),
  };
}

const STOCK_PAGE_TITLES = new Set(['SupaOAuth', 'SupaOAuth Sign In']);

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPath(source: Record<string, unknown> | null | undefined, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return stringValue(current);
}

function firstString(source: Record<string, unknown> | null | undefined, paths: string[][]) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value) return value;
  }
  return null;
}

function projectBrandingDefaults(project?: Record<string, unknown> | null): Branding {
  return {
    page_title: firstString(project, [['name'], ['project_name'], ['display_name']]),
    logo_url: firstString(project, [
      ['logo_url'],
      ['logo_uri'],
      ['icon_url'],
      ['avatar_url'],
      ['config', 'branding', 'logo_url'],
      ['config', 'branding', 'logo_uri'],
      ['config', 'logo_url'],
      ['config', 'project_logo_url'],
    ]),
    favicon_url: firstString(project, [
      ['favicon_url'],
      ['favicon_uri'],
      ['config', 'branding', 'favicon_url'],
      ['config', 'favicon_url'],
    ]),
    primary_color: firstString(project, [
      ['primary_color'],
      ['brand_color'],
      ['theme_color'],
      ['config', 'branding', 'primary_color'],
      ['config', 'primary_color'],
    ]),
  };
}

function applicationBrandingDefaults(application?: Record<string, unknown> | null): Branding {
  return {
    page_title: firstString(application, [['client_name'], ['name'], ['display_name'], ['app_name']]),
    logo_url: firstString(application, [['logo_uri'], ['logo_url'], ['icon_url'], ['avatar_url']]),
    favicon_url: firstString(application, [['favicon_uri'], ['favicon_url']]),
    primary_color: firstString(application, [['primary_color'], ['brand_color'], ['theme_color']]),
  };
}

function applyProjectFallback(branding: Branding, fallback: Branding) {
  const next = { ...branding };
  const entries = Object.entries(fallback).filter(([key]) => key !== 'content') as Array<[StringBrandingKey, string | null | undefined]>;
  for (const [key, value] of entries) {
    if (!value) continue;
    if (key === 'page_title') {
      if (!next.page_title || STOCK_PAGE_TITLES.has(next.page_title)) next.page_title = value;
    } else if (!next[key]) {
      next[key] = value;
    }
  }
  return next;
}

function applyApplicationFallback(branding: Branding, fallback: Branding) {
  const next = { ...branding };
  const entries = Object.entries(fallback).filter(([key]) => key !== 'content') as Array<[StringBrandingKey, string | null | undefined]>;
  for (const [key, value] of entries) {
    if (!value) continue;
    if (key === 'custom_css' || key === 'background_url' || key === 'button_label') continue;
    // 系统名（page_title）：仅在全局未显式设置或仍为 stock 值时，才用 OAuth client 名回填。
    // 显式设置的租户级系统名（如"西谷智灯枢鉴系统"）保持生效；每个应用的显式覆盖仍由 mergeBranding 负责。
    if (key === 'page_title') {
      if (!next.page_title || STOCK_PAGE_TITLES.has(next.page_title)) next.page_title = value;
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function mergeSupaCloudBrandingDefaults(
  globalBranding: Branding,
  source: SupaCloudSignInExperienceSource = {},
) {
  return applyApplicationFallback(
    applyProjectFallback(globalBranding, projectBrandingDefaults(source.project)),
    applicationBrandingDefaults(source.application),
  );
}

export async function getSignInExperience() {
  const db = getDb();
  const rows = await db.select().from(signInExperience).limit(1);
  if (!rows[0]) return null;
  return globalToResponse(rows[0]);
}

export async function updateSignInExperience(data: SignInExperienceInput) {
  const db = getDb();
  // Get current row
  const rows = await db.select().from(signInExperience).limit(1);
  if (!rows[0]) throw new Error('No sign-in experience config found. Run migration first.');

  const current = rows[0];
  const update: Record<string, unknown> = { updatedAt: new Date() };

  if (data.branding) {
    if (data.branding.logo_url !== undefined) update.logoUrl = data.branding.logo_url;
    if (data.branding.favicon_url !== undefined) update.faviconUrl = data.branding.favicon_url;
    if (data.branding.primary_color !== undefined) update.primaryColor = data.branding.primary_color;
    if (data.branding.page_title !== undefined) update.pageTitle = data.branding.page_title;
    if (data.branding.description !== undefined) {
      update.description = typeof data.branding.description === 'string'
        ? data.branding.description.trim() || null
        : data.branding.description;
    }
    if (data.branding.background_url !== undefined) update.backgroundUrl = data.branding.background_url;
    if (data.branding.button_label !== undefined) update.buttonLabel = data.branding.button_label;
    if (data.branding.custom_css !== undefined) update.customCss = data.branding.custom_css;
    if (data.branding.content !== undefined) update.content = data.branding.content;
  }
  if (data.sign_in_methods !== undefined) update.signInMethods = data.sign_in_methods;
  if (data.sign_up_enabled !== undefined) update.signUpEnabled = data.sign_up_enabled;
  if (data.mfa_required !== undefined) update.mfaRequired = data.mfa_required;
  if (data.password_policy) {
    if (data.password_policy.min_length !== undefined) update.passwordMinLength = data.password_policy.min_length;
    if (data.password_policy.require_uppercase !== undefined) update.passwordRequireUppercase = data.password_policy.require_uppercase;
    if (data.password_policy.require_lowercase !== undefined) update.passwordRequireLowercase = data.password_policy.require_lowercase;
    if (data.password_policy.require_numbers !== undefined) update.passwordRequireNumbers = data.password_policy.require_numbers;
    if (data.password_policy.require_symbols !== undefined) update.passwordRequireSymbols = data.password_policy.require_symbols;
  }

  const [updated] = await db.update(signInExperience).set(update)
    .where(eq(signInExperience.id, current.id))
    .returning();
  return updated;
}

export async function getApplicationSignInExperience(applicationId: string) {
  const db = getDb();
  const rows = await db.select().from(applicationSignInExperience)
    .where(eq(applicationSignInExperience.applicationId, applicationId))
    .limit(1);
  return rows[0] ? appToResponse(rows[0]) : null;
}

export async function upsertApplicationSignInExperience(applicationId: string, data: ApplicationSignInExperienceInput) {
  const db = getDb();
  const existingRows = await db.select().from(applicationSignInExperience)
    .where(eq(applicationSignInExperience.applicationId, applicationId))
    .limit(1);
  const existing = existingRows[0];
  const values: Partial<typeof applicationSignInExperience.$inferInsert> = {
    applicationId,
    updatedAt: new Date(),
  };

  if (data.enabled !== undefined) values.enabled = data.enabled;
  if (data.branding) {
    if (data.branding.logo_url !== undefined) values.logoUrl = data.branding.logo_url;
    if (data.branding.favicon_url !== undefined) values.faviconUrl = data.branding.favicon_url;
    if (data.branding.primary_color !== undefined) values.primaryColor = data.branding.primary_color;
    if (data.branding.page_title !== undefined) values.pageTitle = data.branding.page_title;
    if (data.branding.background_url !== undefined) values.backgroundUrl = data.branding.background_url;
    if (data.branding.button_label !== undefined) values.buttonLabel = data.branding.button_label;
    if (data.branding.custom_css !== undefined) values.customCss = data.branding.custom_css;
    if (data.branding.content !== undefined) values.content = data.branding.content;
  }

  const [saved] = existing
    ? await db.update(applicationSignInExperience).set(values)
      .where(eq(applicationSignInExperience.id, existing.id))
      .returning()
    : await db.insert(applicationSignInExperience).values({
      applicationId,
      enabled: data.enabled ?? true,
      logoUrl: data.branding?.logo_url ?? null,
      faviconUrl: data.branding?.favicon_url ?? null,
      primaryColor: data.branding?.primary_color ?? null,
      pageTitle: data.branding?.page_title ?? null,
      backgroundUrl: data.branding?.background_url ?? null,
      buttonLabel: data.branding?.button_label ?? null,
      customCss: data.branding?.custom_css ?? null,
      content: data.branding?.content ?? null,
    }).returning();

  return appToResponse(saved);
}

export async function deleteApplicationSignInExperience(applicationId: string) {
  const db = getDb();
  await db.delete(applicationSignInExperience)
    .where(eq(applicationSignInExperience.applicationId, applicationId));
}

export async function resolveSignInExperience(
  applicationId?: string,
  supacloudSource?: SupaCloudSignInExperienceSource,
) {
  const global = await getSignInExperience();
  if (!global) return global;
  const brandingWithSupaCloudDefaults = mergeSupaCloudBrandingDefaults(global.branding, supacloudSource);
  if (!applicationId) return { ...global, branding: brandingWithSupaCloudDefaults };
  let app: Awaited<ReturnType<typeof getApplicationSignInExperience>> = null;
  try {
    app = await getApplicationSignInExperience(applicationId);
  } catch (error) {
    console.warn(`Application sign-in experience override unavailable for ${applicationId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!app || !app.enabled) {
    return { ...global, branding: brandingWithSupaCloudDefaults, application: app };
  }
  return {
    ...global,
    branding: mergeBranding(brandingWithSupaCloudDefaults, app.branding),
    application: app,
  };
}

export async function getApplicationIdForAuthorization(authorizationId: string) {
  const authorization = await getOAuthAuthorizationContext(authorizationId);
  return authorization?.client_id || null;
}

export function oauthAuthorizationProjectRef() {
  const config = getConfig();
  return config.oauthAuthorizationProjectRef || config.projectRef;
}

function oauthAuthorizationDatabaseUrl() {
  const config = getConfig();
  const tenantUrl = new URL(config.databaseUrl);
  tenantUrl.pathname = `/supa_${oauthAuthorizationProjectRef()}`;
  return tenantUrl.toString();
}

export async function getOAuthAuthorizationContext(authorizationId: string): Promise<OAuthAuthorizationContext | null> {
  const tenantSql = postgres(oauthAuthorizationDatabaseUrl(), { max: 1 });
  try {
    const result = await tenantSql<OAuthAuthorizationContext[]>`
      SELECT
        authorization_id,
        client_id::text AS client_id,
        redirect_uri,
        scope,
        state,
        resource,
        code_challenge,
        code_challenge_method,
        response_type,
        nonce
      FROM auth.oauth_authorizations
      WHERE authorization_id = ${authorizationId}
        AND status = 'pending'
        AND expires_at > now()
      LIMIT 1
    `;
    return result[0] || null;
  } finally {
    await tenantSql.end();
  }
}

export async function bindAuthorizationToUser(authorizationId: string, userId: string) {
  const tenantSql = postgres(oauthAuthorizationDatabaseUrl(), { max: 1 });
  try {
    const result = await tenantSql<{ authorization_id: string }[]>`
      UPDATE auth.oauth_authorizations
      SET user_id = ${userId}
      WHERE authorization_id = ${authorizationId}
        AND status = 'pending'
        AND expires_at > now()
      RETURNING authorization_id
    `;
    return result.length > 0;
  } finally {
    await tenantSql.end();
  }
}
