import { Type, JsonObjectSchema, JsonValueSchema, StringKeySchema, type Static, type TSchema } from './schema.js';
import * as M from './sdk-models.js';
import * as A from './admin-models.js';
import { SupaOAuthJWTClaimsSchema } from './claims.js';
import { commonServerErrors, type ServerRouteContract, type ServerRequestKind } from './server-contracts.js';

const text = Type.String();
const optionalText = Type.Optional(text);
const nullableText = Type.Union([text, Type.Null()]);
const flag = Type.Boolean();
const empty = Type.Object({}, { additionalProperties: false });
const optionalHeaders = Type.Optional(Type.Object({
  authorization: optionalText, 'user-agent': optionalText,
  'x-forwarded-for': optionalText, 'x-real-ip': optionalText,
}));
const auth = { headers: optionalHeaders };
const accountParams = {
  clientId: Type.Object({ clientId: text }),
  identityId: Type.Object({ identityId: text }),
  factorId: Type.Object({ factorId: text }),
};
const params = <P extends keyof typeof accountParams>(key: P) => accountParams[key];
const body = <S extends TSchema>(schema: S) => Type.Object({ ...auth, body: schema });
const onlyAuth = Type.Object(auth);
const success = <S extends Record<string, TSchema>>(fields: S) => Type.Object({ success: Type.Literal(true), ...fields });
const list = <S extends TSchema>(schema: S) => success({ items: Type.Array(schema), total: Type.Number() });

export const AccountCenterSchema = Type.Object({
  enabled: flag,
  profile: Type.Object({ edit_mode: Type.Union([Type.Literal('disabled'), Type.Literal('read_only'), Type.Literal('editable')]), fields: Type.Array(text) }),
  security: Type.Object({ password_change: flag, mfa: flag, email_change: flag, phone_change: flag }),
  grants: Type.Object({ enabled: flag }), identities: Type.Object({ enabled: flag }),
  delete_account: Type.Object({ enabled: flag, url: nullableText }),
});
export const ProviderLinkingSchema = Type.Object({
  available: flag, source: Type.Literal('gotrue'), version: nullableText, reason_code: nullableText,
  providers: Type.Array(text), redirect_to: nullableText,
});
// Account facade projects a subset of GoTrue fields; metadata remains its documented extension point.
export const AccountUserSchema = Type.Composite([Type.Partial(M.UserSchema), Type.Object({ id: text })]);
const accountUser = success({ user: AccountUserSchema });
const contactUser = success({ user: AccountUserSchema, status: Type.Literal('verification_required') });
const grantFields = {
  client_id: text, client_name: optionalText, scopes: Type.Optional(Type.Array(text)),
  created_at: optionalText, updated_at: optionalText,
};
const grant = Type.Union([
  Type.Object(grantFields),
  Type.Object({
    ...grantFields, client_id: optionalText,
    client: Type.Object({ id: text, name: optionalText, client_id: optionalText, client_name: optionalText }),
  }),
]);
const identity = Type.Composite([Type.Partial(M.UserIdentitySchema), Type.Object({ id: text, provider: text })]);
const factor = Type.Composite([Type.Partial(M.UserFactorSchema), Type.Object({ id: text })]);
const actionFields = {
  id: optionalText, deleted: Type.Optional(flag), revoked: Type.Optional(flag), status: optionalText,
  success: Type.Optional(flag), unlinked: Type.Optional(flag), scope: optionalText, client_id: optionalText,
};
const actionResult = Type.Union([
  empty,
  ...(['id', 'scope', 'client_id'] as const).map(key => Type.Object({ ...actionFields, [key]: text })),
  ...(['deleted', 'revoked', 'success', 'unlinked'] as const).map(key => Type.Object({ ...actionFields, [key]: flag })),
]);
const session = Type.Object({ access_token: text, refresh_token: text });
const verificationResult = Type.Object({
  id: optionalText, factor_id: optionalText, verified: Type.Optional(flag), type: optionalText,
  token_type: optionalText, expires_in: Type.Optional(Type.Number()), expires_at: Type.Optional(Type.Number()),
  user: Type.Optional(AccountUserSchema),
});
const enrollment = Type.Object({
  factor_id: text, id: text, type: text, status: text, friendly_name: nullableText,
  totp: Type.Object({ qr_code: text, uri: text }),
});
const normalizedProfile = Type.Record(StringKeySchema, Type.Union([text, Type.Number(), flag, Type.Null()]), { minProperties: 1, maxProperties: 30 });
export const AccountNormalizationSchemas = {
  profile: normalizedProfile,
  password: Type.Object({ email: text, currentPassword: text, newPassword: text }),
  enrollment: Type.Object({ friendly_name: text, issuer: optionalText }),
  claim: Type.Object({ external_id: text, new_password: text }),
};
const claimConfig = Type.Object({
  enabled: flag, external_type: text,
  password: Type.Object({
    mode: Type.Union([Type.Literal('show_initial_password'), Type.Literal('set_on_claim')]),
    min_length: Type.Number(), require_uppercase: flag, require_lowercase: flag, require_numbers: flag, require_symbols: flag,
  }),
  phrases: Type.Record(StringKeySchema, Type.Record(StringKeySchema, text)),
});
const importRecord = Type.Object({
  external_id: text, external_type: optionalText, display_name: text, email: Type.Optional(text),
  user_id: Type.Optional(nullableText), initial_password: optionalText, source_status: optionalText,
  profile: Type.Optional(JsonObjectSchema), import_batch: Type.Optional(nullableText),
  metadata: Type.Optional(JsonObjectSchema), generate_initial_password: Type.Optional(flag), claim_proof: optionalText,
});
// 旧导入/同步将非数组 records 视为空列表；数组中的领域记录仍逐项严格校验。
const ignoredRecordList = Type.Union([Type.Null(), text, Type.Number(), flag, JsonObjectSchema]);
const importInput = Type.Object({
  records: Type.Optional(Type.Union([Type.Array(importRecord), ignoredRecordList])), create_users: Type.Optional(flag),
  dry_run: Type.Optional(flag), generate_emails: Type.Optional(flag), email_domain: optionalText,
});
const syncInput = Type.Object({
  records: Type.Optional(Type.Union([Type.Array(Type.Object({
    external_id: text, source_status: optionalText, display_name: optionalText, email: optionalText,
  })), ignoredRecordList])),
  external_type: optionalText, suspend_users: Type.Optional(flag), reactivate_users: Type.Optional(flag), dry_run: Type.Optional(flag),
});
const syncResult = Type.Object({
  total: Type.Number(), unchanged: Type.Number(), updated: Type.Number(), suspended: Type.Number(), reactivated: Type.Number(),
  errors: Type.Array(Type.Object({ external_id: optionalText, error: text })),
});
const provisioningRecord = Type.Object({
  id: text, externalId: text, externalType: text, displayName: text, email: text, userId: nullableText,
  initialPasswordClaimed: flag, claimedAt: nullableText,
  claimState: Type.Union(['ready', 'pending', 'password_applied', 'password_update_unknown', 'claimed'].map(value => Type.Literal(value))),
  claimMode: nullableText, claimOperationId: nullableText, claimLeaseExpiresAt: nullableText,
  sourceStatus: text, profile: Type.Union([JsonObjectSchema, Type.Null()]), importBatch: nullableText,
  createdAt: text, updatedAt: text,
});
const hookError = Type.Object({ error: Type.Object({ http_code: Type.Number(), message: text, code: optionalText }) });
const probe = Type.Object({ supaoauth_hook_probe: Type.Object({
  verified: Type.Literal(true), protocol: Type.Literal('standard-webhooks-v1'), hook_name: text, project_ref: text,
}) });
export const BeforeSignupPayloadSchema = Type.Object({
  user: Type.Optional(Type.Object({
    email: Type.Optional(nullableText), phone: Type.Optional(nullableText),
    app_metadata: Type.Optional(Type.Union([JsonObjectSchema, Type.Null()])),
    user_metadata: Type.Optional(Type.Union([JsonObjectSchema, Type.Null()])),
  })),
  metadata: Type.Optional(JsonObjectSchema),
});
export const HookClaimsSchema = Type.Intersect([Type.Partial(SupaOAuthJWTClaimsSchema), JsonObjectSchema]);
export const AccessTokenPayloadSchema = Type.Object({
  user_id: optionalText, claims: Type.Optional(HookClaimsSchema), authentication_method: optionalText,
});
// 原始签名载荷保留旧空容器形式；归一化后仍使用上面的严格 payload/claims schema。
export const BeforeSignupRequestSchema = Type.Union([
  Type.Object({
    ...BeforeSignupPayloadSchema.properties,
    metadata: Type.Optional(Type.Union([JsonObjectSchema, Type.Null(), Type.Array(JsonValueSchema)])),
  }),
  Type.Array(JsonValueSchema),
]);
export const AccessTokenRequestSchema = Type.Object({
  ...AccessTokenPayloadSchema.properties,
  claims: Type.Optional(Type.Intersect([
    Type.Object({
      ...Type.Partial(Type.Omit(SupaOAuthJWTClaimsSchema, ['app_metadata'])).properties,
      app_metadata: Type.Optional(Type.Union([JsonObjectSchema, Type.Null()])),
    }),
    JsonObjectSchema,
  ])),
});
const signedHeaders = Type.Object({
  'webhook-id': text, 'webhook-timestamp': text, 'webhook-signature': text,
});
const authorizeQuery = Type.Object(Object.fromEntries([
  'response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge',
  'code_challenge_method', 'resource', 'prompt', 'max_age', 'login_hint', 'ui_locales', 'acr_values',
].map(key => [key, optionalText])));
const endpoint = <I extends TSchema, R extends TSchema>(method: string, path: string, input: I, result: R, request: ServerRequestKind = 'validated') =>
  ({ method, path, input, result, request });
const retired = (method: string, path: string) => ({ ...endpoint(method, path, empty, Type.Never(), 'none'), retired: true as const });

export const accountEndpoints = {
  config: endpoint('GET', '/v1/public/account/config', empty, success({ config: AccountCenterSchema, capabilities: Type.Object({ provider_linking: ProviderLinkingSchema }) }), 'none'),
  me: endpoint('GET', '/v1/public/account/me', onlyAuth, accountUser),
  permissions: endpoint('GET', '/v1/public/account/permissions', Type.Object({ ...auth, query: Type.Object({ application_id: text, org_id: optionalText }) }), Type.Composite([M.UserPermissionsSchema, success({ application_id: text })])),
  profile: endpoint('PATCH', '/v1/public/account/profile', body(Type.Union([Type.Object({ data: JsonObjectSchema }), Type.Object({ user_metadata: JsonObjectSchema }), JsonObjectSchema])), accountUser, 'protocol'),
  email: endpoint('PATCH', '/v1/public/account/email', body(Type.Object({ email: text })), contactUser),
  phone: endpoint('PATCH', '/v1/public/account/phone', body(Type.Object({ phone: text })), contactUser),
  sessions: retired('GET', '/v1/public/account/sessions'),
  revokeSession: retired('POST', '/v1/public/account/sessions/:sessionId/revoke'),
  grants: endpoint('GET', '/v1/public/account/grants', onlyAuth, list(grant)),
  revokeGrant: endpoint('DELETE', '/v1/public/account/grants/:clientId', Type.Object({ ...auth, params: params('clientId') }), success({ result: actionResult })),
  identities: endpoint('GET', '/v1/public/account/identities', onlyAuth, list(identity)),
  authorizeIdentity: endpoint('POST', '/v1/public/account/identities/authorize', body(Type.Object({ provider: text, redirect_to: text })), success({ authorization: Type.Object({ url: text, provider: optionalText }) })),
  unlinkIdentity: endpoint('DELETE', '/v1/public/account/identities/:identityId', Type.Object({ ...auth, params: params('identityId') }), success({ result: actionResult })),
  logout: endpoint('POST', '/v1/public/account/logout', Type.Object({ ...auth, query: Type.Object({ scope: Type.Union(['local', 'global', 'others'].map(value => Type.Literal(value))) }) }), success({ result: actionResult })),
  passkeys: retired('GET', '/v1/public/account/passkeys'),
  renamePasskey: retired('PUT', '/v1/public/account/passkeys/:passkeyId/rename'),
  deletePasskey: retired('DELETE', '/v1/public/account/passkeys/:passkeyId'),
  mfa: endpoint('GET', '/v1/public/account/mfa', onlyAuth, list(factor)),
  enroll: endpoint('POST', '/v1/public/account/mfa/totp/enroll', Type.Object({ ...auth, body: Type.Optional(Type.Object({ friendly_name: optionalText, name: optionalText, issuer: optionalText })) }), success({ enrollment }), 'protocol'),
  // challengeIdFrom 保留历史别名优先级，非字符串值视为缺省并重新创建 challenge。
  verify: endpoint('POST', '/v1/public/account/mfa/:factorId/verify', Type.Object({ ...auth, params: params('factorId'), body: Type.Object({ code: text, challenge_id: Type.Optional(JsonValueSchema), challengeId: Type.Optional(JsonValueSchema) }) }), success({ result: verificationResult, session, status: Type.Literal('verified') })),
  unenroll: endpoint('DELETE', '/v1/public/account/mfa/:factorId', Type.Object({ ...auth, params: params('factorId') }), success({ result: actionResult, status: Type.Literal('unenrolled') })),
  delete: endpoint('DELETE', '/v1/public/account', body(Type.Object({ confirmation: Type.Literal('DELETE') })), success({ result: Type.Union([actionResult, Type.Null()]), status: Type.Literal('deleted') })),
  password: endpoint('POST', '/v1/public/account-password/change', body(Type.Object({ email: text, current_password: optionalText, currentPassword: optionalText, new_password: optionalText, newPassword: optionalText, confirm_password: optionalText, confirmPassword: optionalText })), success({ status: Type.Literal('password_changed') }), 'protocol'),
  claimConfig: endpoint('GET', '/v1/public/account-claims/config', empty, success({ config: claimConfig }), 'none'),
  claim: endpoint('POST', '/v1/public/account-claims/claim', body(Type.Object({ external_id: Type.Union([text, Type.Number()]), new_password: optionalText })), Type.Union([success({ status: Type.Literal('claimed'), email: text, password_set: Type.Literal(true) }), success({ status: Type.Literal('claimed'), email: text, initial_password: text })]), 'protocol'),
  import: endpoint('POST', '/v1/account-provisioning/import', body(importInput), Type.Object({
    total: Type.Number(), eligible: Type.Number(), skipped: Type.Number(), upserted: Type.Number(),
    users_created: Type.Number(), users_updated: Type.Number(), users_suspended: Type.Number(),
    passwords_reset: Type.Number(), emails_generated: Type.Number(),
    errors: Type.Array(Type.Object({ external_id: optionalText, email: optionalText, error: text })),
  })),
  records: endpoint('GET', '/v1/account-provisioning/records', Type.Object({ query: Type.Object({ limit: optionalText, offset: optionalText }) }), Type.Object({ items: Type.Array(provisioningRecord), total: Type.Number() })),
  sync: endpoint('POST', '/v1/account-provisioning/sync', body(syncInput), syncResult),
  reconcile: endpoint('POST', '/v1/account-provisioning/sync/reconcile', body(Type.Object({ external_type: optionalText, dry_run: Type.Optional(flag), batch_size: Type.Optional(Type.Number()) })), syncResult),
  syncStatus: endpoint('GET', '/v1/account-provisioning/sync/status', Type.Object({ query: Type.Object({ external_type: optionalText }) }), Type.Object({ external_type: text, counts: Type.Record(StringKeySchema, Type.Number()) })),
  beforeSignup: endpoint('POST', '/v1/auth-hooks/before-user-created', Type.Object({ headers: signedHeaders, body: BeforeSignupRequestSchema }), Type.Union([empty, hookError, probe]), 'raw-signed'),
  accessToken: endpoint('POST', '/v1/auth-hooks/custom-access-token', Type.Object({ headers: signedHeaders, body: AccessTokenRequestSchema }), Type.Union([Type.Object({ claims: HookClaimsSchema }), hookError, probe]), 'raw-signed'),
  hookGuide: endpoint('GET', '/v1/auth-hooks/registration-guide', empty, M.AuthHookRegistrationGuideSchema, 'none'),
  accessTokenStatus: endpoint('GET', '/v1/auth-hooks/custom-access-token/status', empty, M.AuthHookStatusSchema, 'none'),
  accessTokenConfig: endpoint('GET', '/v1/auth-hooks/custom-access-token/config', empty, A.CustomAccessTokenHookConfigSchema, 'none'),
  updateAccessTokenConfig: endpoint('PATCH', '/v1/auth-hooks/custom-access-token/config', body(A.CustomAccessTokenHookInputSchema), A.CustomAccessTokenHookConfigSchema),
  verifyAccessToken: endpoint('POST', '/v1/auth-hooks/custom-access-token/verify', empty, M.AuthHookStatusSchema, 'none'),
  beforeSignupStatus: endpoint('GET', '/v1/auth-hooks/before-user-created/status', empty, M.AuthHookStatusSchema, 'none'),
  verifyBeforeSignup: endpoint('POST', '/v1/auth-hooks/before-user-created/verify', empty, M.AuthHookStatusSchema, 'none'),
  authorize: endpoint('GET', '/v1/public/oauth/sso/authorize', Type.Object({ query: authorizeQuery }), Type.Object({ redirect: text }), 'protocol'),
};
export type AccountEndpointName = keyof typeof accountEndpoints;
export type AccountInput<K extends AccountEndpointName> = Static<(typeof accountEndpoints)[K]['input']>;
export type AccountOutput<K extends AccountEndpointName> = Static<(typeof accountEndpoints)[K]['result']>;

export function accountRouteContract(name: AccountEndpointName): ServerRouteContract {
  const e = accountEndpoints[name];
  const signed = e.request === 'raw-signed';
  const errors = signed ? Object.fromEntries(Object.entries(commonServerErrors).map(([status, branch]) => {
    if (!branch.schema) throw new Error(`Missing common error schema: ${status}`);
    return [status, {
      kind: 'protocol' as const, schema: Type.Union([branch.schema, Type.Literal('Unauthorized auth hook request'), Type.Literal('Auth hook verification is unavailable')]),
      contentTypes: ['application/json', 'text/plain'],
    }];
  })) : commonServerErrors;
  return {
    input: e.input, request: e.request,
    ...('retired' in e ? { hidden: true, retired: true } : {}),
    responses: {
      ...errors,
      ...('retired' in e ? {} : name === 'authorize' ? {
        302: { kind: 'protocol' as const, schema: e.result, contentTypes: ['application/json'] },
        400: { kind: 'validated' as const, schema: Type.Object({ error: text, error_description: text }), contentTypes: ['application/json'] },
      } : { 200: { kind: signed ? 'protocol' as const : 'validated' as const, schema: e.result, contentTypes: ['application/json'] } }),
    },
  };
}
