// @supauth/shared — shared schemas and types

import { type TUnsafe } from '@sinclair/typebox';
import { JsonObjectSchema, JsonValueSchema, StringKeySchema, Type, type Static, type TSchema } from './schema.js';

// Application types
export const ApplicationTypeSchema = Type.Union([
  Type.Literal('spa'), Type.Literal('web'), Type.Literal('native'), Type.Literal('m2m'),
]);
export type ApplicationType = Static<typeof ApplicationTypeSchema>;

export const ApplicationSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  type: ApplicationTypeSchema,
  redirect_uris: Type.Array(Type.String()),
  allowed_cors_origins: Type.Array(Type.String()),
  grant_types: Type.Array(Type.String()),
  token_endpoint_auth_method: Type.String(),
  client_id: Type.String(),
  client_secret: Type.Optional(Type.String()), // only returned on create/rotate
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type Application = Static<typeof ApplicationSchema>;

export const CreateApplicationInputSchema = Type.Object({
  name: Type.String(),
  type: ApplicationTypeSchema,
  redirect_uris: Type.Array(Type.String()),
  allowed_cors_origins: Type.Optional(Type.Array(Type.String())),
  grant_types: Type.Optional(Type.Array(Type.String())),
});
export type CreateApplicationInput = Static<typeof CreateApplicationInputSchema>;

// API Resource / Scope
export const ScopeSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  resource_id: Type.String(),
});
export type Scope = Static<typeof ScopeSchema>;

export const ApiResourceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  indicator: Type.String(),
  scopes: Type.Array(ScopeSchema),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type ApiResource = Static<typeof ApiResourceSchema>;

export const CreateResourceInputSchema = Type.Object({
  name: Type.String(),
  indicator: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  scopes: Type.Optional(Type.Array(Type.Omit(ScopeSchema, ['id', 'resource_id']))),
});
export type CreateResourceInput = Static<typeof CreateResourceInputSchema>;

// Connector (Social / Enterprise SSO)
export const ConnectorCategorySchema = Type.Union([
  Type.Literal('social'), Type.Literal('enterprise_sso'),
]);
export type ConnectorCategory = Static<typeof ConnectorCategorySchema>;

export const ConnectorSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  category: ConnectorCategorySchema,
  provider_id: Type.String(),
  enabled: Type.Boolean(),
  config: JsonObjectSchema,
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type Connector = Static<typeof ConnectorSchema>;

// Organization
export const OrganizationMemberSchema = Type.Object({
  user_id: Type.String(),
  role: Type.String(),
  joined_at: Type.String(),
});
export type OrganizationMember = Static<typeof OrganizationMemberSchema>;

export const OrganizationSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  members: Type.Array(OrganizationMemberSchema),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type Organization = Static<typeof OrganizationSchema>;

// Role / Permission
export const PermissionSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  resource_id: Type.Optional(Type.String()),
  scope_id: Type.Optional(Type.String()),
});
export type Permission = Static<typeof PermissionSchema>;

export const RoleSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  permissions: Type.Array(PermissionSchema),
});
export type Role = Static<typeof RoleSchema>;

// Sign-in Experience
export const SignInExperienceSchema = Type.Object({
  branding: Type.Object({
    logo_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    favicon_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    primary_color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    page_title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    background_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    button_label: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    custom_css: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    content: Type.Optional(JsonValueSchema),
  }),
  sign_in_methods: Type.Array(Type.String()),
  sign_up_enabled: Type.Boolean(),
  password_policy: Type.Object({
    min_length: Type.Number(),
    require_uppercase: Type.Boolean(),
    require_lowercase: Type.Boolean(),
    require_numbers: Type.Boolean(),
    require_symbols: Type.Boolean(),
  }),
});
export type SignInExperience = Static<typeof SignInExperienceSchema>;

export const ApplicationSignInExperienceSchema = Type.Object({
  application_id: Type.String(),
  enabled: Type.Boolean(),
  branding: Type.Object({
    logo_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    favicon_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    primary_color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    page_title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    background_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    button_label: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    custom_css: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    content: Type.Optional(JsonValueSchema),
  }),
});
export type ApplicationSignInExperience = Static<typeof ApplicationSignInExperienceSchema>;

export const EffectiveSignInExperienceSchema = Type.Composite([
  SignInExperienceSchema,
  Type.Object({
    application: Type.Optional(Type.Union([ApplicationSignInExperienceSchema, Type.Null()])),
    authorization: Type.Optional(Type.Union([
      Type.Object({
        authorization_id: Type.String(),
        client_id: Type.String(),
        redirect_uri: Type.String(),
        scope: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        resource: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        code_challenge: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        code_challenge_method: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        response_type: Type.String(),
        nonce: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      Type.Null(),
    ])),
  }),
]);
export type EffectiveSignInExperience = Static<typeof EffectiveSignInExperienceSchema>;

export const PublicSignInConnectorSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  type: Type.String(),
});
export type PublicSignInConnector = Static<typeof PublicSignInConnectorSchema>;

export const PublicEffectiveSignInExperienceSchema = Type.Composite([
  EffectiveSignInExperienceSchema,
  Type.Object({ connectors: Type.Optional(Type.Array(PublicSignInConnectorSchema)) }),
]);
export type PublicEffectiveSignInExperience = Static<typeof PublicEffectiveSignInExperienceSchema>;

export const PublicPhraseBundleSchema = Type.Object({
  language_tag: Type.String(),
  phrases: JsonObjectSchema,
});
export type PublicPhraseBundle = Static<typeof PublicPhraseBundleSchema>;

// Audit log
export const AuditLogEntrySchema = Type.Object({
  id: Type.String(),
  event_type: Type.String(),
  actor_id: Type.Optional(Type.String()),
  actor_type: Type.Union([Type.Literal('admin'), Type.Literal('user'), Type.Literal('system')]),
  resource_type: Type.String(),
  resource_id: Type.String(),
  details: JsonObjectSchema,
  created_at: Type.String(),
});
export type AuditLogEntry = Static<typeof AuditLogEntrySchema>;

// Webhook
export const WebhookSchema = Type.Object({
  id: Type.String(),
  url: Type.String(),
  events: Type.Array(Type.String()),
  secret_configured: Type.Boolean(),
  enabled: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type Webhook = Static<typeof WebhookSchema>;

// Runtime mode
/** SupaOAuth delegates the authentication runtime to stock Supabase GoTrue. */
export const RuntimeModeSchema = Type.Literal('gotrue');
export type RuntimeMode = Static<typeof RuntimeModeSchema>;

const CapabilityStatusMetadataSchema = Type.Object({
  source: Type.Union([Type.Literal('gotrue'), Type.Literal('supacloud'), Type.Literal('supaoauth')]),
  version: Type.Union([Type.String(), Type.Null()]),
  last_verified_at: Type.String(),
});

export const CapabilityStatusSchema = Type.Union([
  Type.Composite([
    CapabilityStatusMetadataSchema,
    Type.Object({ available: Type.Literal(true), reason_code: Type.Null() }),
  ]),
  Type.Composite([
    CapabilityStatusMetadataSchema,
    Type.Object({ available: Type.Literal(false), reason_code: Type.String() }),
  ]),
]);
export type CapabilityStatus = Static<typeof CapabilityStatusSchema>;

export const CapabilitiesResponseSchema = Type.Object({
  runtime_mode: RuntimeModeSchema,
  capabilities: Type.Record(StringKeySchema, CapabilityStatusSchema),
});
export type CapabilitiesResponse = Static<typeof CapabilitiesResponseSchema>;

export const PagedResponseSchema = <S extends TSchema>(itemSchema: S) => Type.Object({
  items: Type.Array(itemSchema),
  total: Type.Number(),
  page: Type.Number(),
  limit: Type.Number(),
});
// TUnsafe 仅绑定历史泛型类型参数；运行时工厂始终要求真实 item schema。
export type PagedResponse<T> = Static<ReturnType<typeof PagedResponseSchema<TUnsafe<T>>>>;

export const CursorResponseSchema = <S extends TSchema>(itemSchema: S) => Type.Object({
  items: Type.Array(itemSchema),
  total: Type.Number(),
  limit: Type.Number(),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
});
export type CursorResponse<T> = Static<ReturnType<typeof CursorResponseSchema<TUnsafe<T>>>>;

export const ApiErrorResponseSchema = Type.Object({
  success: Type.Literal(false),
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    correlation_id: Type.String(),
    details: Type.Optional(JsonObjectSchema),
  }),
});
export type ApiErrorResponse = Static<typeof ApiErrorResponseSchema>;

// Supabase compatibility check result
export const CompatibilityCheckResultSchema = Type.Object({
  check_id: Type.String(),
  status: Type.Union([Type.Literal('pass'), Type.Literal('fail'), Type.Literal('warn')]),
  message: Type.String(),
  details: Type.Optional(JsonObjectSchema),
});
export type CompatibilityCheckResult = Static<typeof CompatibilityCheckResultSchema>;
