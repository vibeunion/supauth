import { Type, type Static, type TSchema, JsonObjectSchema, JsonValueSchema, StringKeySchema } from './schema.js';
import { CursorResponseSchema } from './core.js';
export { JsonObjectSchema, JsonValueSchema } from './schema.js';
import { ApplicationSchema, CreateApplicationInputSchema, ApiResourceSchema, CreateResourceInputSchema, ScopeSchema, ConnectorSchema, OrganizationSchema, OrganizationMemberSchema, RoleSchema, PermissionSchema, SignInExperienceSchema, ApplicationSignInExperienceSchema, EffectiveSignInExperienceSchema, PublicEffectiveSignInExperienceSchema, PublicPhraseBundleSchema, AuditLogEntrySchema, WebhookSchema, CapabilitiesResponseSchema, CompatibilityCheckResultSchema } from './core.js';

export const ListResponseSchema = <S extends TSchema>(item: S) => Type.Object({ items: Type.Array(item), total: Type.Number(), page: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) });
export const CursorListResponseSchema = CursorResponseSchema;
export const ProjectResponseSchema = Type.Object({ id: Type.String(), ref: Type.Optional(Type.String()), project_ref: Type.Optional(Type.String()), name: Type.String(), region: Type.Optional(Type.String()) });
export type ProjectResponse = Static<typeof ProjectResponseSchema>;
export const AuthConfigResponseSchema = Type.Object({
  enable_signup: Type.Boolean(), enable_confirmations: Type.Boolean(), external_anonymous_users_enabled: Type.Boolean(),
  disable_signup: Type.Optional(Type.Boolean()),
  jwt_expiry: Type.Number(), password_min_length: Type.Number(), mfa_max_enrolled_factors: Type.Number(),
  site_url: Type.Optional(Type.String()), uri_allow_list: Type.Optional(Type.String()),
  external_email_enabled: Type.Optional(Type.Boolean()), external_phone_enabled: Type.Optional(Type.Boolean()),
  mailer_autoconfirm: Type.Optional(Type.Boolean()), sms_autoconfirm: Type.Optional(Type.Boolean()),
  security_captcha_enabled: Type.Optional(Type.Boolean()), security_captcha_provider: Type.Optional(Type.String()),
  password_required_characters: Type.Optional(Type.String()), password_hibp_enabled: Type.Optional(Type.Boolean()),
  security_refresh_token_reuse_interval: Type.Optional(Type.Number()),
  refresh_token_rotation_enabled: Type.Optional(Type.Boolean()),
  mfa_totp_enroll_enabled: Type.Optional(Type.Boolean()), mfa_totp_verify_enabled: Type.Optional(Type.Boolean()),
  mfa_phone_enroll_enabled: Type.Optional(Type.Boolean()), mfa_phone_verify_enabled: Type.Optional(Type.Boolean()),
});
export type AuthConfigResponse = Static<typeof AuthConfigResponseSchema>;
// Local repositories serialize Drizzle property names; legacy API fixtures used snake_case.
export const ApplicationBindingSchema = Type.Union([
  Type.Object({ id: Type.String(), applicationId: Type.String(), resourceId: Type.String(), scopeId: Type.Union([Type.String(), Type.Null()]), createdAt: Type.String() }),
  Type.Object({ id: Type.String(), application_id: Type.String(), resource_id: Type.String(), scope_id: Type.Optional(Type.Union([Type.String(), Type.Null()])), created_at: Type.String() }),
]);
export type ApplicationBinding = Static<typeof ApplicationBindingSchema>;
export const OAuthApplicationSchema = Type.Object({ client_id: Type.String(), client_name: Type.Optional(Type.String()), client_type: Type.Optional(Type.String()), redirect_uris: Type.Optional(Type.Array(Type.String())), grant_types: Type.Optional(Type.Array(Type.String())), token_endpoint_auth_method: Type.Optional(Type.String()), client_secret: Type.Optional(Type.String()), created_at: Type.Optional(Type.String()), updated_at: Type.Optional(Type.String()) });
export type OAuthApplication = Static<typeof OAuthApplicationSchema>;
export const RoleAssignmentSchema = Type.Object({ id: Type.String(), role_id: Type.String(), user_id: Type.Optional(Type.Union([Type.String(), Type.Null()])), organization_id: Type.Optional(Type.Union([Type.String(), Type.Null()])), application_id: Type.Optional(Type.Union([Type.String(), Type.Null()])), created_at: Type.String() });
export type RoleAssignment = Static<typeof RoleAssignmentSchema>;
export const SyncResultSchema = Type.Object({ synced: Type.Boolean(), warnings: Type.Optional(Type.Array(Type.String())) });
export type SyncResult = Static<typeof SyncResultSchema>;
export const WebhookEventListSchema = Type.Object({
  events: Type.Array(Type.String()),
  catalog: Type.Array(Type.Object({
    type: Type.String(),
    guarantee: Type.Union([Type.Literal('transactional'), Type.Literal('post_mutation')]),
  })),
});
export type WebhookEventList = Static<typeof WebhookEventListSchema>;
export const WebhookDeliveryLogSchema = Type.Object({
  id: Type.String(), outbox_id: Type.String(), project_ref: Type.String(), webhook_id: Type.String(),
  attempt: Type.Integer(), status: Type.Union([Type.Literal('delivered'), Type.Literal('failed'), Type.Literal('dead_lettered')]),
  status_code: Type.Union([Type.Number(), Type.Null()]), error: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(), event_id: Type.Optional(Type.String()), event_type: Type.Optional(Type.String()),
  response_preview: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  request_bytes: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  request_body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  signature_timestamp: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  signature_version: Type.Optional(Type.String()), secret_version: Type.Optional(Type.Number()),
  request_api_version: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  started_at: Type.Optional(Type.String()), completed_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  payload: Type.Optional(JsonObjectSchema), outbox_status: Type.Optional(Type.String()),
  attempt_count: Type.Optional(Type.Number()), max_attempts: Type.Optional(Type.Number()),
  next_attempt_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  replay_of_delivery_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  occurred_at: Type.Optional(Type.String()), api_version: Type.Optional(Type.String()), event_created_at: Type.Optional(Type.String()),
});
export type WebhookDeliveryLog = Static<typeof WebhookDeliveryLogSchema>;
export const OrganizationTemplateSchema = Type.Object({ id: Type.String(), name: Type.String(), description: Type.Optional(Type.Union([Type.String(), Type.Null()])), templateRoles: Type.Optional(Type.Array(Type.Object({ name: Type.String(), permissions: Type.Array(Type.String()) }))), template_roles: Type.Optional(Type.Array(Type.Object({ name: Type.String(), permissions: Type.Array(Type.String()) }))), templateScopes: Type.Optional(Type.Array(Type.Object({ name: Type.String(), description: Type.Optional(Type.String()) }))), template_scopes: Type.Optional(Type.Array(Type.Object({ name: Type.String(), description: Type.Optional(Type.String()) }))), isDefault: Type.Optional(Type.Boolean()), is_default: Type.Optional(Type.Boolean()) });
export type OrganizationTemplate = Static<typeof OrganizationTemplateSchema>;
export const SecurityStatusSchema = Type.Object({
  admin_auth_mode: Type.String(), token_auth_allowed: Type.Boolean(), rate_limit_rpm: Type.Number(),
  brute_force_protection: Type.Boolean(), enforce_https: Type.Boolean(), warnings: Type.Array(Type.String()),
  warning_codes: Type.Array(Type.Union([Type.Literal('admin_token_enabled'), Type.Literal('security_config_missing')])),
});
export type SecurityStatus = Static<typeof SecurityStatusSchema>;
export const EnterpriseSSOConfigSchema = Type.Object({ id: Type.String(), connectorId: Type.Optional(Type.String()), connector_id: Type.Optional(Type.String()), domains: Type.Array(Type.String()), ssoProtocol: Type.Optional(Type.String()), sso_protocol: Type.Optional(Type.String()), jitProvisioning: Type.Optional(Type.Boolean()), jit_provisioning: Type.Optional(Type.Boolean()), orgMembershipMapping: Type.Optional(Type.Record(StringKeySchema, Type.String())), org_membership_mapping: Type.Optional(Type.Record(StringKeySchema, Type.String())), roleMapping: Type.Optional(Type.Record(StringKeySchema, Type.String())), role_mapping: Type.Optional(Type.Record(StringKeySchema, Type.String())) });
export type EnterpriseSSOConfig = Static<typeof EnterpriseSSOConfigSchema>;
export const ApplicationConsentInputSchema = Type.Object({
  user_scopes: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  organization_scopes: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  allowed_organization_ids: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  require_explicit_consent: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  custom_data: Type.Optional(Type.Union([JsonObjectSchema, Type.Null()])),
});
export const ApplicationConsentSettingsSchema = Type.Object({
  applicationId: Type.String(), userScopes: Type.Union([Type.Array(Type.String()), Type.Null()]),
  organizationScopes: Type.Union([Type.Array(Type.String()), Type.Null()]),
  allowedOrganizationIds: Type.Union([Type.Array(Type.String()), Type.Null()]),
  requireExplicitConsent: Type.Boolean(), customData: Type.Union([JsonObjectSchema, Type.Null()]),
  id: Type.Optional(Type.String()), createdAt: Type.Optional(Type.String()), updatedAt: Type.Optional(Type.String()),
});
export type ApplicationConsentSettings = Static<typeof ApplicationConsentSettingsSchema>;
export const ApplicationSignInExperienceInputSchema = Type.Partial(Type.Object({
  ...Type.Omit(ApplicationSignInExperienceSchema, ['application_id']).properties,
  branding: Type.Union([ApplicationSignInExperienceSchema.properties.branding, Type.Null()]),
}));
export type ApplicationSignInExperienceInput = Static<typeof ApplicationSignInExperienceInputSchema>;
export const SignInExperienceInputSchema = Type.Partial(Type.Object({
  ...SignInExperienceSchema.properties,
  branding: Type.Union([SignInExperienceSchema.properties.branding, Type.Null()]),
  password_policy: Type.Union([Type.Partial(SignInExperienceSchema.properties.password_policy), Type.Null()]),
}));
export type SignInExperienceInput = Static<typeof SignInExperienceInputSchema>;
export const OrganizationInvitationSchema = Type.Object({ id: Type.String(), email: Type.String(), role: Type.String(), status: Type.String(), token: Type.Optional(Type.String()) });
export type OrganizationInvitation = Static<typeof OrganizationInvitationSchema>;
export const OrganizationJitSettingsSchema = Type.Object({ enabled: Type.Boolean(), domains: Type.Array(Type.String()) });
export type OrganizationJitSettings = Static<typeof OrganizationJitSettingsSchema>;
export const ConnectorFactorySchema = Type.Object({ id: Type.String(), factoryId: Type.Optional(Type.String()), factory_id: Type.Optional(Type.String()), name: Type.String(), protocol: Type.String(), category: Type.String(), configSchema: Type.Optional(JsonObjectSchema), config_schema: Type.Optional(JsonObjectSchema), enabled: Type.Boolean() });
export type ConnectorFactory = Static<typeof ConnectorFactorySchema>;
const configString = Type.Optional(Type.String());
const configBoolean = Type.Optional(Type.Boolean());
const configModule = Type.Union([Type.Boolean(), Type.Object({ enabled: configBoolean })]);
// 配置值按使用方协议区分；用户定义的 JSON 扩展仍保留，不伪造通用领域对象。
export const tenantConfigurationValues = {
  captcha: Type.Object({
    provider: configString, site_key: configString, secret: configString, secret_configured: configBoolean,
  }),
  email_template: Type.Object({ subject: configString, content: configString, content_path: configString }),
  sms_template: Type.Object({ content: configString, template: configString }),
  domain: Type.Object({ domain: configString, hostname: configString, status: configString }),
  phrase: Type.Record(StringKeySchema, Type.String()),
  profile_field: Type.Object({
    name: configString, label: configString, type: configString, required: configBoolean,
    options: Type.Optional(Type.Array(Type.String())), placeholder: configString,
  }),
  branding_asset: Type.Object({ url: configString, storage_key: configString, content_type: configString }),
  auth_hook: Type.Object({
    enabled: configBoolean, uri: configString, secret_configured: configBoolean,
    allowed_email_domains: Type.Optional(Type.Array(Type.String())),
    blocked_email_domains: Type.Optional(Type.Array(Type.String())),
    allowed_oauth_providers: Type.Optional(Type.Array(Type.String())),
    blocked_oauth_providers: Type.Optional(Type.Array(Type.String())),
    invite_only: configBoolean,
  }),
  account_center: Type.Object({
    enabled: configBoolean,
    profile: Type.Optional(Type.Object({ edit_mode: configString, fields: Type.Optional(Type.Array(Type.String())) })),
    security: Type.Optional(Type.Object({
      password_change: configBoolean, mfa: configBoolean, email_change: configBoolean, phone_change: configBoolean,
    })),
    grants: Type.Optional(configModule), identities: Type.Optional(configModule),
    delete_account: Type.Optional(Type.Object({
      enabled: configBoolean, url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    })),
    delete_account_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  account_claim: Type.Object({
    enabled: configBoolean, external_type: configString, password_mode: configString,
    password_min_length: Type.Optional(Type.Number()),
    password: Type.Optional(Type.Object({
      mode: configString, min_length: Type.Optional(Type.Number()), require_uppercase: configBoolean,
      require_lowercase: configBoolean, require_numbers: configBoolean, require_symbols: configBoolean,
    })),
    phrases: Type.Optional(Type.Record(StringKeySchema, Type.Record(StringKeySchema, Type.String()))),
  }),
} as const;
const customUiPendingEvent = Type.Object({
  event_id: Type.String(), event_type: Type.Union([
    Type.Literal('sign_in_experience.custom_ui_uploaded'),
    Type.Literal('sign_in_experience.custom_ui_delete_pending'),
    Type.Literal('sign_in_experience.custom_ui_deleted'),
  ]),
  created_at: Type.String(), actor_id: Type.String(), actor_type: Type.Literal('admin'), request_id: Type.String(),
  authorization_source: Type.Union([Type.Literal('development_token'), Type.Literal('admin_allowlist'), Type.Literal('rbac_projection')]),
  delivery_state: Type.Union([Type.Literal('ready'), Type.Literal('sending'), Type.Literal('delivered'), Type.Literal('delivery_unknown')]),
  file_count: Type.Integer(), content_sha256: Type.String(), cleanup_pending: Type.Boolean(),
});
export const StoredCustomUiValueSchema = Type.Union([
  Type.Object({
    schema_version: Type.Literal(1), assets_id: Type.String(), content_sha256: Type.String(),
    uploaded_at: Type.String(),
    files: Type.Array(Type.Object({
      path: Type.String(), object_key: Type.String(), sha256: Type.String(), size: Type.Number(), content_type: Type.String(),
    })),
    cleanup_pending_object_keys: Type.Array(Type.String()),
    lifecycle_state: Type.Union([Type.Literal('active'), Type.Literal('cleanup_pending'), Type.Literal('objects_deleted')]),
    audit_pending_event: Type.Union([customUiPendingEvent, Type.Null()]),
  }),
  Type.Object({
    schema_version: Type.Literal(1),
    batches: Type.Array(Type.Object({
      assets_id: Type.String(), created_at: Type.String(), state: Type.Union([
        Type.Literal('reserved'), Type.Literal('pending'), Type.Literal('upload_outcome_unknown'), Type.Literal('cleanup_claimed'),
      ]),
      lease_token: configString, claim_token: configString, claimed_at: configString, outcome_unknown_at: configString,
      object_keys: Type.Array(Type.String()),
    })),
  }),
]);
const storedConfigurationValues = { ...tenantConfigurationValues, custom_ui_assets: StoredCustomUiValueSchema };
export const TenantConfigSchema = Type.Union(Object.entries(storedConfigurationValues).map(([type, value]) => Type.Union([
  Type.Object({ id: Type.String(), configType: Type.Literal(type), key: Type.String(), value, enabled: Type.Boolean() }),
  Type.Object({ id: Type.String(), config_type: Type.Literal(type), key: Type.String(), value, enabled: Type.Boolean() }),
])));
export const TenantConfigInputSchema = Type.Union(Object.entries(tenantConfigurationValues).map(([type, value]) => Type.Object({
  params: Type.Object({ type: Type.Literal(type), key: Type.String() }),
  body: Type.Object({
    value: Type.Optional(Type.Union([value, Type.Null()])),
    enabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  }),
})));
export type TenantConfig = Static<typeof TenantConfigSchema>;
export const AuthHookRegistrationGuideSchema = Type.Object({ before_user_created: Type.String(), custom_access_token: Type.String(), protocol: Type.Literal('standard-webhooks-v1'), required_headers: Type.Array(Type.String()), secret_format: Type.String() });
export type AuthHookRegistrationGuide = Static<typeof AuthHookRegistrationGuideSchema>;
export const ExistingPolicySchema = Type.Object({ schemaname: Type.String(), tablename: Type.String(), policyname: Type.String(), policytype: Type.Union([Type.Literal('permissive'), Type.Literal('restrictive')]), cmd: Type.Union([Type.Literal('SELECT'), Type.Literal('INSERT'), Type.Literal('UPDATE'), Type.Literal('DELETE'), Type.Literal('ALL')]), qual: Type.Union([Type.String(), Type.Null()]), with_check: Type.Union([Type.String(), Type.Null()]), roles: Type.Array(Type.String()) });
export type ExistingPolicy = Static<typeof ExistingPolicySchema>;
export const WrapperPolicySchema = Type.Object({ original_policy: Type.String(), wrapper_policy_name: Type.String(), tablename: Type.String(), schemaname: Type.String(), cmd: Type.String(), original_using: Type.Union([Type.String(), Type.Null()]), original_with_check: Type.Union([Type.String(), Type.Null()]), wrapper_using: Type.Union([Type.String(), Type.Null()]), wrapper_with_check: Type.Union([Type.String(), Type.Null()]), sql: Type.String(), permission_name: Type.String() });
export type WrapperPolicy = Static<typeof WrapperPolicySchema>;
export const MigrationResultSchema = Type.Object({ scanned_policies: Type.Number(), candidate_policies: Type.Number(), wrappers: Type.Array(WrapperPolicySchema), migration_sql: Type.String(), warnings: Type.Array(Type.String()) });
export type MigrationResult = Static<typeof MigrationResultSchema>;
export const AuthorizationOperationSchema = Type.Union([Type.Literal('read'), Type.Literal('create'), Type.Literal('update'), Type.Literal('delete'), Type.Literal('manage')]);
export type AuthorizationOperation = Static<typeof AuthorizationOperationSchema>;
export const AuthorizationCompileRequestSchema = Type.Object({ project_ref: Type.Optional(Type.String()), tables: Type.Optional(Type.Array(Type.Object({ schema: Type.Optional(Type.String()), table: Type.String(), permission_prefix: Type.Optional(Type.String()), operations: Type.Optional(Type.Array(AuthorizationOperationSchema)), owner_column: Type.Optional(Type.String()), organization_column: Type.Optional(Type.String()) }))), storage_buckets: Type.Optional(Type.Array(Type.Object({ bucket_id: Type.String(), permission_prefix: Type.Optional(Type.String()), owner_path_prefix: Type.Optional(Type.String()), organization_path_prefix: Type.Optional(Type.String()), operations: Type.Optional(Type.Array(AuthorizationOperationSchema)) }))), realtime_channels: Type.Optional(Type.Array(Type.Object({ topic: Type.String(), permission: Type.String(), organization_claim: Type.Optional(Type.String()) }))), edge_functions: Type.Optional(Type.Array(Type.Object({ name: Type.String(), permission: Type.String(), require_organization: Type.Optional(Type.Boolean()) }))), include_helper_sql: Type.Optional(Type.Boolean()) });
export type AuthorizationCompileRequest = Static<typeof AuthorizationCompileRequestSchema>;
export const AuthorizationCompileResultSchema = Type.Object({ generated_at: Type.String(), assumptions: Type.Array(Type.String()), warnings: Type.Array(Type.String()), permissions: Type.Array(Type.String()), sql: Type.Object({ helpers: Type.String(), tables: Type.String(), storage: Type.String(), realtime: Type.String(), rollback: Type.String() }), edge_functions: Type.Array(Type.Object({ name: Type.String(), permission: Type.String(), middleware: Type.String(), negative_tests: Type.Array(Type.String()) })), negative_tests: Type.Array(Type.String()), deploy_checklist: Type.Array(Type.String()) });
export type AuthorizationCompileResult = Static<typeof AuthorizationCompileResultSchema>;

const nullableString = Type.Union([Type.String(), Type.Null()]);
const optionalString = Type.Optional(Type.String());
const optionalNullableString = Type.Optional(nullableString);
const strings = Type.Array(Type.String());

export const HealthSchema = Type.Object({ status: Type.String(), runtime_mode: Type.Literal('gotrue'), project_ref: Type.String() });
export const RuntimeHealthSchema = Type.Object({
  discovery: Type.Boolean(), jwks: Type.Boolean(), authorize: Type.Boolean(),
  token: Type.Boolean(), userinfo: Type.Boolean(), issuer: nullableString, signing_alg: nullableString,
});
export type RuntimeHealth = Static<typeof RuntimeHealthSchema>;
export const OAuthServerStatusSchema = Type.Object({
  enabled: Type.Boolean(), signing_alg: Type.String(), allow_dynamic_registration: Type.Boolean(),
  migration_status: optionalString,
});
export const DiscoverySchema = Type.Object({
  issuer: Type.String(), authorization_endpoint: Type.String(), token_endpoint: Type.String(),
  userinfo_endpoint: Type.String(), jwks_uri: Type.String(),
  scopes_supported: Type.Optional(strings), response_types_supported: Type.Optional(strings),
  grant_types_supported: Type.Optional(strings), subject_types_supported: Type.Optional(strings),
  id_token_signing_alg_values_supported: Type.Optional(strings),
  token_endpoint_auth_methods_supported: Type.Optional(strings),
  code_challenge_methods_supported: Type.Optional(strings), claims_supported: Type.Optional(strings),
  registration_endpoint: optionalString, end_session_endpoint: optionalString,
});
export const JWKSchema = Type.Object({
  kty: Type.String(), kid: optionalString, use: optionalString, alg: optionalString,
  key_ops: Type.Optional(strings), n: optionalString, e: optionalString, crv: optionalString,
  x: optionalString, y: optionalString, x5c: Type.Optional(strings), x5t: optionalString,
});
export const JWKSSchema = Type.Object({ keys: Type.Array(JWKSchema) });
export const UserPermissionsSchema = Type.Object({ roles: strings, permissions: strings, scopes: strings });

export const CreateOAuthApplicationInputSchema = Type.Object({
  redirect_uris: Type.Array(Type.String(), { minItems: 1, maxItems: 10, uniqueItems: true }),
  client_name: optionalString, client_uri: optionalString, logo_uri: optionalString,
  client_type: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('confidential')])),
  token_endpoint_auth_method: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('client_secret_basic'), Type.Literal('client_secret_post')])),
  grant_types: Type.Optional(Type.Array(Type.Union([Type.Literal('authorization_code'), Type.Literal('refresh_token')]), { minItems: 1 })),
  // Preserve historical SDK input fields while exposing the actual GoTrue fields.
  name: optionalString,
  // GoTrue 未定义此扩展字段；不能把 SDK/UI 分类枚举提升为上游 wire 限制。
  type: Type.Optional(JsonValueSchema),
  allowed_cors_origins: Type.Optional(strings),
});
export const UpdateOAuthApplicationInputSchema = Type.Partial(CreateOAuthApplicationInputSchema);
export const RotatedApplicationSecretSchema = Type.Object({
  client_secret: Type.String(), client_id: optionalString,
});
export const ApplicationScopeSchema = Type.Union([
  ScopeSchema,
  Type.Object({
    bindingId: Type.String(), resourceId: Type.String(),
    scope: Type.Union([Type.Object({ id: Type.String(), name: Type.String(), description: optionalNullableString, resourceId: Type.String() }), Type.Null()]),
  }),
]);

export const ProviderSchema = Type.Object({
  id: Type.String(), name: optionalString, type: optionalString, enabled: Type.Boolean(),
  provider_enabled: Type.Optional(Type.Boolean()), configuration_required: Type.Optional(Type.Boolean()),
  connector_record_id: optionalString, runtime_kind: optionalString, config: Type.Optional(JsonObjectSchema),
  client_id: optionalString, secret_configured: Type.Optional(Type.Boolean()),
  authorization_endpoint: optionalString, authorizationEndpoint: optionalString,
  identifier: optionalString, issuer: optionalString, scopes: Type.Optional(strings),
});
export const UpdateConnectorInputSchema = Type.Partial(Type.Composite([
  ConnectorSchema,
  Type.Object({ client_id: Type.String(), client_secret: Type.String(), scopes: strings, authorization_endpoint: Type.String() }),
]));
export const ConnectorPreflightSchema = Type.Object({
  status: Type.Literal('reachable'), check_kind: Type.Literal('runtime_configuration'),
  runtime_kind: Type.Union([Type.Literal('builtin_oauth'), Type.Literal('custom_oidc'), Type.Literal('saml')]),
  authorization_url: Type.String(),
});
export const ConnectorAuthorizationSchema = Type.Union([
  Type.Object({ connector_id: Type.String(), authorization_uri: Type.String() }),
  Type.Object({ connector_id: Type.String(), status: Type.Literal('unavailable'), reason: Type.Literal('authorization_endpoint_missing') }),
]);

export const UserIdentitySchema = Type.Object({
  id: Type.String(), identity_id: optionalString, user_id: Type.String(), provider: Type.String(),
  identity_data: Type.Optional(JsonObjectSchema), last_sign_in_at: optionalNullableString,
  created_at: optionalString, updated_at: optionalString, email: optionalString,
});
export const UserFactorSchema = Type.Object({
  id: Type.String(), factor_type: Type.String(), status: Type.String(),
  friendly_name: optionalString, created_at: optionalString, updated_at: optionalString,
  phone: optionalString, last_challenged_at: optionalNullableString,
});
export const UserSchema = Type.Object({
  id: Type.String(), aud: Type.String(), role: optionalString, email: optionalString, phone: optionalString,
  app_metadata: JsonObjectSchema, user_metadata: JsonObjectSchema, created_at: Type.String(),
  updated_at: optionalString, identities: Type.Optional(Type.Array(UserIdentitySchema)),
  factors: Type.Optional(Type.Array(UserFactorSchema)), is_anonymous: Type.Optional(Type.Boolean()),
  is_sso_user: Type.Optional(Type.Boolean()), banned_until: optionalNullableString,
  confirmed_at: optionalNullableString, email_confirmed_at: optionalNullableString, phone_confirmed_at: optionalNullableString,
  last_sign_in_at: optionalNullableString, invited_at: optionalNullableString,
  confirmation_sent_at: optionalNullableString, recovery_sent_at: optionalNullableString,
  email_change_sent_at: optionalNullableString, new_email: optionalString, new_phone: optionalString,
  deleted_at: optionalNullableString,
});
export type User = Static<typeof UserSchema>;
const UpdateUserFieldsSchema = Type.Object({
  email: optionalString, phone: optionalString, password: optionalString,
  email_confirm: Type.Optional(Type.Boolean()), phone_confirm: Type.Optional(Type.Boolean()),
  user_metadata: Type.Optional(JsonObjectSchema), app_metadata: Type.Optional(JsonObjectSchema),
  ban_duration: optionalString,
});
// The upstream sanitizer forwards extension keys; known user fields retain their own types.
export const UpdateUserInputSchema = Type.Intersect([UpdateUserFieldsSchema, JsonObjectSchema]);
export const SuspendUserInputSchema = Type.Object({ ban_duration: optionalString }, { additionalProperties: false });
export const MfaResetSchema = Type.Object({
  reset: Type.Literal(true), factor_id: Type.String(),
  result: Type.Union([Type.Null(), Type.Object({ id: optionalString })]),
});
export const OrganizationBrandingSchema = Type.Object({
  logo_url: optionalNullableString, favicon_url: optionalNullableString, primary_color: optionalNullableString,
  page_title: optionalNullableString, background_url: optionalNullableString,
  button_label: optionalNullableString, custom_css: optionalNullableString,
  dark_logo_url: optionalNullableString, name: optionalString,
});
export const WireOrganizationSchema = Type.Union([
  OrganizationSchema,
  Type.Object({
    id: Type.String(), name: Type.String(), slug: Type.String(), project_ref: Type.String(),
    description: nullableString, branding: OrganizationBrandingSchema,
    jit_enabled: Type.Boolean(), jit_domains: strings, created_at: Type.String(), updated_at: Type.String(),
    created_by: optionalNullableString, deleted_at: optionalNullableString, member_role: optionalString, joined_at: optionalString,
  }),
]);
export const WireOrganizationMemberSchema = Type.Union([
  OrganizationMemberSchema,
  Type.Object({
    id: Type.String(), organization_id: Type.String(), user_id: Type.String(), role: Type.String(),
    created_at: Type.String(), updated_at: Type.String(), created_by: optionalNullableString,
    email: optionalNullableString, display_name: optionalNullableString,
  }),
]);
export const OrganizationApplicationSchema = Type.Object({
  id: Type.String(), organization_id: Type.String(), application_id: Type.String(), created_at: Type.String(),
  created_by: optionalNullableString,
});
export const RemovedOrganizationApplicationSchema = Type.Object({ deleted: Type.Boolean(), binding: OrganizationApplicationSchema });
export const AcceptedOrganizationInvitationSchema = WireOrganizationMemberSchema;
export const RevokedOrganizationInvitationSchema = Type.Object({ revoked: Type.Boolean(), invitation: OrganizationInvitationSchema });
export const InstantiatedOrganizationSchema = Type.Object({ org: WireOrganizationSchema, template: OrganizationTemplateSchema, rolesCreated: Type.Number() });

export const TenantMemberRoleSchema = Type.Union([Type.Literal('owner'), Type.Literal('admin'), Type.Literal('member'), Type.Literal('viewer')]);
export const TenantInvitationRoleSchema = Type.Exclude(TenantMemberRoleSchema, Type.Literal('owner'));
export const TenantMemberStatusSchema = Type.Union([Type.Literal('active'), Type.Literal('suspended')]);

// 上游先 trim/lowercase；输入接受同样的拼写，输出仍使用规范枚举。
function normalizedEnumInput(values: readonly string[], allowEmpty = false) {
  const alternatives = values.map(value => [...value]
    .map(letter => `[${letter}${letter.toUpperCase()}]`).join('')).join('|');
  return Type.String({ pattern: `^\\s*(?:${alternatives})${allowEmpty ? '?' : ''}\\s*$` });
}
const tenantMemberRoleInput = normalizedEnumInput(TenantMemberRoleSchema.anyOf.map(value => value.const));
const tenantInvitationRoleInput = normalizedEnumInput(TenantInvitationRoleSchema.anyOf.map(value => value.const));
const tenantMemberStatusInput = normalizedEnumInput(TenantMemberStatusSchema.anyOf.map(value => value.const), true);

export const TenantMemberSchema = Type.Object({
  id: Type.String(), project_ref: Type.String(), principal_id: Type.String(),
  email: nullableString, role: TenantMemberRoleSchema,
  status: TenantMemberStatusSchema,
  scope: Type.Literal('project'), capabilities: strings,
  created_by: optionalNullableString, created_at: Type.String(), updated_at: Type.String(),
});
export const UpdateTenantMemberInputSchema = Type.Object({
  role: Type.Optional(tenantMemberRoleInput),
  status: Type.Optional(tenantMemberStatusInput),
}, { additionalProperties: false });
export const TenantInvitationSchema = Type.Object({
  id: Type.String(), project_ref: Type.String(), email: Type.String(), role: TenantMemberRoleSchema,
  status: Type.Union([Type.Literal('pending'), Type.Literal('accepted'), Type.Literal('revoked'), Type.Literal('expired')]),
  expires_at: Type.String(), created_at: Type.String(), updated_at: Type.String(), scope: Type.Literal('project'),
  invited_by: optionalNullableString, accepted_principal_id: optionalNullableString,
  accepted_at: optionalNullableString, effective_status: optionalString, token: optionalString,
});
export const CreateTenantInvitationInputSchema = Type.Object({
  email: Type.String(), role: tenantInvitationRoleInput,
  ttl_hours: Type.Optional(Type.Number({ minimum: 1, maximum: 720 })),
}, { additionalProperties: false });
export const AuthHookStatusSchema = Type.Object({
  hook_name: Type.Union([Type.Literal('before-user-created'), Type.Literal('custom-access-token')]),
  registered: Type.Boolean(), verified: Type.Boolean(), protocol: Type.Literal('standard-webhooks-v1'),
  version: nullableString, reason_code: nullableString, authority_project_ref: optionalString,
  managed_by_owner: Type.Optional(Type.Boolean()),
});
export const DomainCheckSchema = Type.Object({
  domain: Type.String(), status: Type.String(), checked_at: Type.String(), error: optionalString,
});

export const AuditExportInputSchema = Type.Object({
  event_type: optionalString, resource_type: optionalString, resource_id: optionalString, actor_id: optionalString,
  status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })), method: optionalString,
  from: optionalString, to: optionalString, format: Type.Optional(Type.Union([Type.Literal('jsonl'), Type.Literal('csv')])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50000 })),
});
export const AuditExportSchema = Type.Object({
  id: Type.String(), project_ref: Type.String(), actor: Type.String(),
  format: Type.Union([Type.Literal('jsonl'), Type.Literal('csv')]), status: Type.String(),
  row_count: Type.Number(), checksum: nullableString, checkpoint_hash: nullableString,
  filters: Type.Object({
    eventType: nullableString, resourceType: nullableString, resourceId: nullableString, actorId: nullableString,
    status: Type.Union([Type.Number(), Type.Null()]), method: nullableString, from: nullableString, to: nullableString,
  }),
  expires_at: Type.String(), created_at: Type.String(), completed_at: nullableString,
  download_url: Type.Optional(nullableString),
});
export const AuditIntegritySchema = Type.Object({
  status: Type.Union([Type.Literal('verified'), Type.Literal('mismatch'), Type.Literal('legacy_unverified')]),
  consistent: Type.Boolean(), reason: nullableString, total_event_count: Type.Number(), verified_event_count: Type.Number(),
  checkpoint: Type.Union([Type.Null(), Type.Object({
    project_ref: Type.String(), last_event_id: nullableString, last_event_hash: nullableString,
    event_count: Type.Union([Type.Number(), Type.String({ pattern: '^[0-9]+$' })]), updated_at: optionalString,
  })]),
});
export const WebhookReplaySchema = Type.Object({
  queued: Type.Literal(true), outbox_id: Type.String(), event_id: Type.String(), original_delivery_id: Type.String(),
});

export const ProvisioningDetailsSchema = Type.Object({
  error_code: optionalString, upstream_status: Type.Optional(Type.Number()), state_persistence: optionalString,
  migration: optionalString, mode: optionalString, error: optionalString,
  probes: Type.Optional(Type.Array(Type.Object({
    name: Type.String(), path: Type.String(), status: Type.Union([Type.Number(), Type.Null()]), ok: Type.Boolean(), error: optionalString,
  }))),
});
export const ProvisioningStepSchema = Type.Object({
  step: Type.String(), status: Type.Union([Type.Literal('pending'), Type.Literal('completed'), Type.Literal('failed')]),
  details: Type.Optional(Type.Union([ProvisioningDetailsSchema, Type.Null()])),
  id: optionalString, projectRef: optionalString, createdAt: optionalString, updatedAt: optionalString,
});
export const ProvisioningStatusSchema = Type.Union([
  Type.Object({ project_ref: Type.String(), steps: Type.Array(ProvisioningStepSchema), fully_provisioned: Type.Boolean() }),
  Type.Object({ error: Type.String(), project_ref: Type.String() }),
]);
export const ProvisioningReconcileSchema = Type.Object({
  project_ref: Type.String(), results: Type.Array(ProvisioningStepSchema), fully_provisioned: Type.Boolean(), error: optionalString,
});

export const WireScopeSchema = Type.Union([
  ScopeSchema,
  Type.Object({ id: Type.String(), name: Type.String(), resourceId: Type.String(), description: nullableString }),
]);
const LocalResourceSchema = Type.Object({
  id: Type.String(), name: Type.String(), indicator: Type.String(), description: nullableString,
  createdAt: Type.String(), updatedAt: Type.String(),
});
export const WireResourceSchema = Type.Union([
  ApiResourceSchema, Type.Composite([LocalResourceSchema, Type.Object({ scopes: Type.Array(WireScopeSchema) })]),
]);
export const UpdatedResourceSchema = Type.Union([ApiResourceSchema, LocalResourceSchema]);
export const WireWebhookSchema = Type.Union([
  WebhookSchema,
  Type.Object({
    id: Type.String(), url: Type.String(), events: strings, enabled: Type.Boolean(),
    has_secret: Type.Boolean(), created_at: Type.String(), updated_at: Type.String(),
    project_ref: optionalString, signing_key_id: optionalString, signature_version: optionalString,
    secret_version: Type.Optional(Type.Number()), previous_secret_expires_at: optionalNullableString,
    created_by: optionalNullableString,
  }),
]);
export const WebhookQueuedSchema = Type.Object({ queued: Type.Literal(true), outbox_id: Type.String(), event_id: Type.String() });

export const WirePermissionSchema = Type.Composite([
  Type.Omit(PermissionSchema, ['description', 'resource_id', 'scope_id']),
  Type.Object({ description: optionalNullableString, resource_id: optionalNullableString, scope_id: optionalNullableString, created_at: optionalString, updated_at: optionalString }),
]);
export const WireRoleSchema = Type.Composite([
  Type.Omit(RoleSchema, ['description', 'permissions']),
  Type.Object({ description: optionalNullableString, permissions: Type.Array(WirePermissionSchema), created_at: optionalString, updated_at: optionalString }),
]);
// The server limits the trimmed name, without rewriting the transport payload here.
export const RbacNameInputSchema = Type.String({ pattern: '^\\s*\\S(?:[\\s\\S]{0,253}\\S)?\\s*$' });
export const CreateRoleInputSchema = Type.Object({
  name: RbacNameInputSchema,
  description: optionalNullableString,
  permissions: Type.Optional(Type.Array(RbacNameInputSchema, { uniqueItems: true })),
});
export const UpdateRoleInputSchema = Type.Partial(Type.Omit(CreateRoleInputSchema, ['permissions']));

// SupaCloud appends principal.type, including project/anonymous, not just BFF actor types.
export const WireAuditLogEntrySchema = Type.Composite([
  Type.Omit(AuditLogEntrySchema, ['actor_type']),
  Type.Object({
    actor_type: Type.String(), project_ref: optionalString, method: optionalString, path: optionalString,
    status: Type.Optional(Type.Integer()), source: optionalString, request_id: optionalNullableString,
    previous_hash: optionalNullableString, event_hash: optionalNullableString,
    chain_sequence: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    ip_address: optionalNullableString, user_agent: optionalNullableString,
  }),
]);

export const DeletedOrganizationSchema = Type.Object({ deleted: Type.Literal(true), organization: WireOrganizationSchema });
export const RemovedOrganizationMemberSchema = Type.Object({ deleted: Type.Literal(true), member: WireOrganizationMemberSchema });
export const RemovedTenantMemberSchema = Type.Object({ deleted: Type.Literal(true), collaborator: TenantMemberSchema });
