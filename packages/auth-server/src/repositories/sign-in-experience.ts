// Sign-in Experience repository — backed by SupaCloud Postgres

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { signInExperience } from '../db/schema.js';

export async function getSignInExperience() {
  const db = getDb();
  const rows = await db.select().from(signInExperience).limit(1);
  if (!rows[0]) return null;
  const row = rows[0];
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

export async function updateSignInExperience(data: {
  branding?: { logo_url?: string; favicon_url?: string; primary_color?: string; page_title?: string };
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
}) {
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
