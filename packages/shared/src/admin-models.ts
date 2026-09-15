import { Type, JsonObjectSchema } from './schema.js';

const optionalString = Type.Optional(Type.String());
const nullableString = Type.Union([Type.String(), Type.Null()]);
const strings = Type.Array(Type.String());

export const AdminPathSegmentSchema = Type.String();
export const StorageBucketIdSchema = Type.Union([Type.Literal('avatars'), Type.Literal('branding')]);
export const StorageObjectPathSchema = Type.String({ minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//).*[^/]$' });
export const BrandingAssetTypeSchema = Type.Union([Type.Literal('logo'), Type.Literal('favicon'), Type.Literal('apple_touch_icon')]);
export const ImageContentTypeSchema = Type.Union([
  Type.Literal('image/png'), Type.Literal('image/jpeg'), Type.Literal('image/gif'),
  Type.Literal('image/webp'), Type.Literal('image/svg+xml'), Type.Literal('image/x-icon'),
  Type.Literal('image/vnd.microsoft.icon'),
]);
export const UploadMetadataSchema = Type.Object({
  size: Type.Integer({ minimum: 0, maximum: 5 * 1024 * 1024 }),
  type: ImageContentTypeSchema,
}, { additionalProperties: false });
// branding 旧入口先去除 MIME 参数并转小写；仅其输入接受这些等价形式，响应仍使用规范白名单。
const brandingMediaTypes = ImageContentTypeSchema.anyOf.map((schema) => schema.const
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`));
export const BrandingImageContentTypeSchema = Type.String({
  pattern: `^\\s*(?:${brandingMediaTypes.join('|')})\\s*(?:;[^\\r\\n]*)?$`,
});
export const BrandingUploadMetadataSchema = Type.Object({
  ...UploadMetadataSchema.properties, type: BrandingImageContentTypeSchema,
}, { additionalProperties: false });
export const StorageBucketSchema = Type.Object({
  id: Type.String(), name: optionalString, public: Type.Boolean(),
  file_size_limit: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  allowed_mime_types: Type.Optional(Type.Union([strings, Type.Null()])),
  created_at: optionalString, updated_at: optionalString,
});
export const UploadedFileSchema = Type.Object({
  key: Type.String(), url: Type.String(), bucket: StorageBucketIdSchema,
  path: Type.String(), public: Type.Boolean(),
});
export const SignedStorageUrlSchema = Type.Object({
  url: Type.String(), public: Type.Boolean(), expiresIn: Type.Optional(Type.Number()),
});
export const DeletedFileSchema = Type.Object({
  deleted: Type.Literal(true), bucket: StorageBucketIdSchema, path: Type.String(),
});
export const UploadedAvatarSchema = Type.Object({
  storage_key: Type.String(), userId: Type.String(), bucket: Type.Literal('avatars'),
});
export const UploadedBrandingSchema = Type.Object({
  url: Type.String(), assetType: BrandingAssetTypeSchema, content_type: ImageContentTypeSchema,
});
export const CustomUiStatusSchema = Type.Object({
  status: Type.Union([Type.Literal('disabled'), Type.Literal('blocked_unsafe_origin'), Type.Literal('cleanup_pending')]),
  configured: Type.Boolean(), enabled: Type.Boolean(),
  lifecycle_state: Type.Union([Type.Literal('active'), Type.Literal('cleanup_pending'), Type.Literal('objects_deleted'), Type.Null()]),
  assets_id: nullableString, content_sha256: nullableString, uploaded_at: nullableString,
  file_count: Type.Integer({ minimum: 0 }),
  files: Type.Array(Type.Object({
    path: Type.String(), sha256: Type.String(), size: Type.Number(), content_type: Type.String(),
  })),
  cleanup_pending: Type.Boolean(), audit_pending: Type.Boolean(),
});
export const DeletedCustomUiSchema = Type.Union([
  Type.Object({
    status: Type.Literal('deleted'), deleted_file_count: Type.Integer({ minimum: 0 }),
    cleanup_pending: Type.Optional(Type.Literal(false)), audit_pending: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    status: Type.Literal('deactivated'), deleted_file_count: Type.Literal(0),
    cleanup_pending: Type.Literal(true), audit_pending: Type.Literal(true),
  }),
]);
export const AuthConfigRuntimeConsistencySchema = Type.Object({
  checked_at: Type.String(), consistent: Type.Boolean(),
  desired: Type.Object({
    signups_enabled: Type.Boolean(),
    enable_signup: Type.Union([Type.Boolean(), Type.Null()]),
    disable_signup: Type.Union([Type.Boolean(), Type.Null()]),
  }),
  runtime: Type.Object({
    signups_enabled: Type.Boolean(), disable_signup: Type.Union([Type.Boolean(), Type.Null()]),
  }),
});
export const CustomAccessTokenHookConfigSchema = Type.Object({
  enabled: Type.Boolean(), uri: Type.String(), secret_configured: Type.Boolean(),
});
export const CustomAccessTokenHookInputSchema = Type.Object({
  enabled: Type.Boolean(), uri: optionalString, secret: optionalString,
}, { additionalProperties: false });
export const SecurityConfigSchema = Type.Object({
  id: Type.String(), adminAuthMode: Type.Union([Type.Literal('auto'), Type.Literal('token'), Type.Literal('sso')]),
  adminAllowedEmails: strings, adminAllowedDomains: strings,
  rateLimitRpm: Type.Number(), rateLimitBurst: Type.Number(), bruteForceProtection: Type.Boolean(),
  maxLoginAttempts: Type.Number(), lockoutDurationSec: Type.Number(),
  secretRotationReminderDays: Type.Number(), enforceHttps: Type.Boolean(),
});
export const SecurityConfigInputSchema = Type.Partial(Type.Omit(SecurityConfigSchema, ['id']));

export const ConnectorFactoryInputSchema = Type.Object({
  name: Type.String({ minLength: 1 }), identifier: optionalString, client_id: optionalString,
  client_secret: optionalString, issuer: optionalString, enabled: Type.Optional(Type.Boolean()),
  scopes: Type.Optional(Type.Union([strings, Type.String()])),
  metadata_url: optionalString, metadata_xml: optionalString, resource_id: optionalString,
  name_id_format: optionalString, domains: Type.Optional(Type.Union([strings, Type.String()])),
  attribute_mapping: Type.Optional(Type.Union([JsonObjectSchema, Type.String()])),
});
export const InstantiatedConnectorSchema = Type.Object({
  provider_id: Type.String(), runtime_kind: Type.Union([Type.Literal('custom_oidc'), Type.Literal('saml')]),
  name: Type.String(), category: Type.String(), enabled: Type.Boolean(),
  id: Type.String(), connector_record_id: Type.String(), identifier: optionalString,
  config: Type.Optional(JsonObjectSchema),
});
export const UserOAuthGrantSchema = Type.Object({
  source: Type.Literal('gotrue'), client_id: Type.String(),
  user_id: optionalString, scopes: Type.Optional(strings),
  created_at: optionalString, updated_at: optionalString, revoked_at: Type.Optional(nullableString),
  client: Type.Optional(Type.Object({ client_id: Type.String(), client_name: optionalString })),
});
