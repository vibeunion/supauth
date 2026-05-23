// SupaOAuth metadata schema — lives in `supaoauth` schema on SupaCloud's Postgres
// Does NOT touch `auth` schema (GoTrue owns that)

import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

const supaoauth = pgSchema('supaoauth');

// ─── API Resources ───────────────────────────────────────────────────────
export const apiResources = supaoauth.table('api_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  indicator: varchar('indicator', { length: 1024 }).notNull(), // audience URL
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_api_resources_indicator').on(t.indicator),
]);

// ─── Scopes ───────────────────────────────────────────────────────────────
export const scopes = supaoauth.table('scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  resourceId: uuid('resource_id').notNull().references(() => apiResources.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_scopes_resource_id').on(t.resourceId),
]);

// ─── Organizations ────────────────────────────────────────────────────────
export const organizations = supaoauth.table('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Organization Members ─────────────────────────────────────────────────
export const organizationMembers = supaoauth.table('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(), // references auth.users.id (FK across schema)
  role: varchar('role', { length: 100 }).notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_org_members_org_id').on(t.organizationId),
  index('idx_org_members_user_id').on(t.userId),
]);

// ─── Roles ────────────────────────────────────────────────────────────────
export const roles = supaoauth.table('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Permissions ──────────────────────────────────────────────────────────
export const permissions = supaoauth.table('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  scopeId: uuid('scope_id').references(() => scopes.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_permissions_role_id').on(t.roleId),
]);

// ─── Sign-in Experience ───────────────────────────────────────────────────
export const signInExperience = supaoauth.table('sign_in_experience', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Branding
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  primaryColor: varchar('primary_color', { length: 32 }),
  pageTitle: varchar('page_title', { length: 255 }),
  // Auth flow
  signInMethods: jsonb('sign_in_methods').$type<string[]>().default([]),
  signUpEnabled: boolean('sign_up_enabled').default(true).notNull(),
  mfaRequired: boolean('mfa_required').default(false).notNull(),
  // Password policy
  passwordMinLength: integer('password_min_length').default(8).notNull(),
  passwordRequireUppercase: boolean('password_require_uppercase').default(false).notNull(),
  passwordRequireLowercase: boolean('password_require_lowercase').default(false).notNull(),
  passwordRequireNumbers: boolean('password_require_numbers').default(false).notNull(),
  passwordRequireSymbols: boolean('password_require_symbols').default(false).notNull(),
  // Metadata
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Audit Logs ───────────────────────────────────────────────────────────
export const auditLogs = supaoauth.table('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  actorId: uuid('actor_id'),
  actorType: varchar('actor_type', { length: 50 }).notNull().default('system'), // admin | user | system
  resourceType: varchar('resource_type', { length: 255 }).notNull(),
  resourceId: varchar('resource_id', { length: 255 }).notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_audit_logs_event_type').on(t.eventType),
  index('idx_audit_logs_resource').on(t.resourceType, t.resourceId),
  index('idx_audit_logs_created_at').on(t.createdAt),
]);

// ─── Webhooks ─────────────────────────────────────────────────────────────
export const webhooks = supaoauth.table('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().notNull(),
  secret: text('secret').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Connectors (SupaOAuth metadata layer on top of GoTrue providers) ─────
export const connectors = supaoauth.table('connectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: varchar('provider_id', { length: 255 }).notNull(), // GoTrue provider ID
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(), // social | enterprise_sso
  enabled: boolean('enabled').default(false).notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_connectors_provider_id').on(t.providerId),
]);

// ─── Application-Resource/Scope Bindings ──────────────────────────────────
// Links OAuth client applications to API resources and their scopes.
// application_id is the GoTrue OAuth client_id (string, not UUID FK).
export const applicationBindings = supaoauth.table('application_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: varchar('application_id', { length: 255 }).notNull(), // GoTrue client_id
  resourceId: uuid('resource_id').notNull().references(() => apiResources.id, { onDelete: 'cascade' }),
  scopeId: uuid('scope_id').references(() => scopes.id, { onDelete: 'cascade' }), // null = all scopes for resource
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_app_bindings_app_id').on(t.applicationId),
  index('idx_app_bindings_resource_id').on(t.resourceId),
]);

// ─── Role Assignments ────────────────────────────────────────────────────
// Binds roles to users at user-level, org-level, or M2M app-level
export const roleAssignments = supaoauth.table('role_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(), // references auth.users.id (cross-schema)
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  applicationId: varchar('application_id', { length: 255 }), // GoTrue client_id for M2M
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_role_assignments_role_id').on(t.roleId),
  index('idx_role_assignments_user_id').on(t.userId),
  index('idx_role_assignments_org_id').on(t.organizationId),
]);
