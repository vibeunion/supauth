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
    background_url?: string | null;
    button_label?: string | null;
    custom_css?: string | null;
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
    },
    _meta: { id: row.id, created_at: row.createdAt, updated_at: row.updatedAt },
  };
}

function mergeBranding(
  globalBranding: ReturnType<typeof globalToResponse>['branding'],
  appBranding?: ReturnType<typeof appToResponse>['branding'],
) {
  if (!appBranding) return globalBranding;
  return {
    ...globalBranding,
    ...Object.fromEntries(
      Object.entries(appBranding).filter(([, value]) => value !== null && value !== undefined && value !== ''),
    ),
  };
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
    }).returning();

  return appToResponse(saved);
}

export async function deleteApplicationSignInExperience(applicationId: string) {
  const db = getDb();
  await db.delete(applicationSignInExperience)
    .where(eq(applicationSignInExperience.applicationId, applicationId));
}

export async function resolveSignInExperience(applicationId?: string) {
  const global = await getSignInExperience();
  if (!global || !applicationId) return global;
  const app = await getApplicationSignInExperience(applicationId);
  if (!app || !app.enabled) return { ...global, application: app };
  return {
    ...global,
    branding: mergeBranding(global.branding, app.branding),
    application: app,
  };
}

export async function getApplicationIdForAuthorization(authorizationId: string) {
  const authorization = await getOAuthAuthorizationContext(authorizationId);
  return authorization?.client_id || null;
}

export async function getOAuthAuthorizationContext(authorizationId: string): Promise<OAuthAuthorizationContext | null> {
  const config = getConfig();
  const tenantUrl = new URL(config.databaseUrl);
  tenantUrl.pathname = `/supa_${config.projectRef}`;
  const tenantSql = postgres(tenantUrl.toString(), { max: 1 });
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
  const config = getConfig();
  const tenantUrl = new URL(config.databaseUrl);
  tenantUrl.pathname = `/supa_${config.projectRef}`;
  const tenantSql = postgres(tenantUrl.toString(), { max: 1 });
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
