import { Type, JsonValueSchema, type Static, type TSchema } from './schema.js';
import { AdminIdentitySchema, AdminLoginResponseSchema } from './admin-auth-contracts.js';
import { adminEndpoints } from './admin-endpoints.js';
import { AdminPathSegmentSchema, StorageBucketIdSchema, StorageObjectPathSchema, ImageContentTypeSchema, BrandingImageContentTypeSchema } from './admin-models.js';
import { commonServerErrors, type ServerRouteContract, type ServerResponseContract } from './server-contracts.js';

export const HostedLogoutQuerySchema = Type.Object({
  client_id: Type.Optional(Type.String({ maxLength: 256 })),
  id_token_hint: Type.Optional(Type.String()),
  post_logout_redirect_uri: Type.Optional(Type.String()),
  state: Type.Optional(Type.String({ maxLength: 1024 })),
});
export const LogoutClientMetadataSchema = Type.Object({
  client_id: Type.Optional(Type.String()),
  post_logout_redirect_uris: Type.Optional(Type.Array(Type.String())),
  redirect_uris: Type.Optional(Type.Array(Type.String())),
});
export const LogoutDiscoverySchema = Type.Object({ issuer: Type.String({ minLength: 1 }) });
export const LogoutJwksSchema = Type.Object({
  keys: Type.Array(Type.Object({
    kty: Type.String({ minLength: 1 }),
    kid: Type.Optional(Type.String()), alg: Type.Optional(Type.String()), use: Type.Optional(Type.String()),
    key_ops: Type.Optional(Type.Array(Type.String())), ext: Type.Optional(Type.Boolean()),
    crv: Type.Optional(Type.String()), x: Type.Optional(Type.String()), y: Type.Optional(Type.String()),
    n: Type.Optional(Type.String()), e: Type.Optional(Type.String()),
  })),
});
// 旧 handler 仅比较 token，缺省或非字符串凭据仍走失败计数和失败 envelope。
export const AdminLoginInputSchema = Type.Object({
  token: Type.Optional(JsonValueSchema),
}, { additionalProperties: JsonValueSchema });
export const AdminLogoutResultSchema = Type.Object({ success: Type.Literal(true), scope: Type.Literal('local') });

const empty = Type.Object({});
const json = (schema: TSchema): ServerResponseContract => ({ kind: 'validated', schema, contentTypes: ['application/json'] });
const mediaTypes = [
  'text/html', 'text/css', 'text/javascript', 'application/javascript', 'application/json',
  'application/octet-stream', 'image/gif', 'image/x-icon', 'image/jpeg', 'image/png', 'image/svg+xml',
  'image/webp', 'font/otf', 'font/ttf', 'font/woff', 'font/woff2', 'text/plain',
];
const html: ServerResponseContract = { kind: 'html', schema: Type.String({ pattern: '<html(?:\\s|>)' }), contentTypes: ['text/html'] };
const notFound: ServerResponseContract = {
  kind: 'protocol',
  alternatives: [
    { kind: 'protocol', schema: Type.Literal('Not Found'), contentTypes: ['text/plain'] },
    json(Type.Object({ error: Type.Union([
      Type.Literal('authorize_page_missing'), Type.Literal('claim_page_missing'),
      Type.Literal('account_page_missing'), Type.Literal('change_password_page_missing'),
    ]) })),
  ],
};
const logoutQueryValue = Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())]));
const logoutPageInput = Type.Object({
  query: Type.Object({
    client_id: logoutQueryValue, id_token_hint: logoutQueryValue,
    post_logout_redirect_uri: logoutQueryValue, state: logoutQueryValue,
  }),
});
const storageError: ServerResponseContract = {
  kind: 'protocol',
  alternatives: [
    ...Object.values(commonServerErrors).slice(0, 1),
    json(Type.Object({ code: Type.String(), message: Type.String() })),
    { kind: 'protocol', schema: Type.String({ pattern: '^(Bucket not allowed|Content-Type .+ not allowed|File too large|Invalid image type|Invalid storage path or parameters)' }), contentTypes: ['text/plain'] },
  ],
};
const storageErrors = Object.fromEntries(Object.keys(commonServerErrors).map((status) => [Number(status), storageError]));
const bucketParams = Type.Object({ bucketId: StorageBucketIdSchema });
const objectParams = Type.Object({ bucketId: StorageBucketIdSchema, '*': StorageObjectPathSchema });
const imageHeaders = Type.Object({ 'content-type': ImageContentTypeSchema });

function storage(input: TSchema, result: TSchema, raw = false): ServerRouteContract {
  return { input, request: raw ? 'protocol' : input === empty ? 'none' : 'validated', responses: { ...storageErrors, 200: json(result) } };
}

export const hostedServerContracts = {
  page: { input: empty, request: 'none', responses: { ...commonServerErrors, 200: html, 404: notFound } },
  logoutPage: { input: logoutPageInput, request: 'validated', responses: { ...commonServerErrors, 200: html, 404: notFound } },
  script: {
    input: empty, request: 'none', responses: {
      ...commonServerErrors, 200: { kind: 'protocol', schema: Type.String({ minLength: 1 }), contentTypes: ['application/javascript'] },
    },
  },
  favicon: {
    input: empty, request: 'none', responses: {
      ...commonServerErrors, 200: { kind: 'binary', contentTypes: ['image/svg+xml'] },
    },
  },
  robots: {
    input: empty, request: 'none', responses: {
      ...commonServerErrors, 200: { kind: 'protocol', schema: Type.String(), contentTypes: ['text/plain'] },
    },
  },
  staticAsset: {
    input: Type.Object({ params: Type.Object({ '*': Type.String() }) }), request: 'validated',
    responses: {
      ...commonServerErrors, 200: { kind: 'binary', contentTypes: mediaTypes },
      307: { kind: 'redirect', schema: Type.String({ pattern: '^/admin(?:/|$)' }) }, 404: notFound,
    },
  },
  adminRoot: {
    input: empty, request: 'none', responses: {
      ...commonServerErrors, 200: { kind: 'binary', contentTypes: mediaTypes },
      307: { kind: 'redirect', schema: Type.String({ pattern: '^/admin(?:/|$)' }) }, 404: notFound,
    },
  },
  removedAsset: {
    input: Type.Object({ params: Type.Object({ '*': Type.String() }) }), request: 'validated', responses: { ...commonServerErrors, 404: notFound },
  },
  adminLogin: { input: Type.Object({ body: AdminLoginInputSchema }), request: 'validated', responses: { ...commonServerErrors, 200: json(AdminLoginResponseSchema) } },
  adminLogout: { input: empty, request: 'none', responses: { ...commonServerErrors, 200: json(AdminLogoutResultSchema) } },
  adminIdentity: { input: empty, request: 'none', responses: { ...commonServerErrors, 200: json(AdminIdentitySchema) } },
  adminHealth: { input: empty, request: 'none', responses: { ...commonServerErrors, 200: json(Type.Object({ status: Type.Literal('ok') })) } },
  retired: { input: empty, request: 'none', responses: commonServerErrors, hidden: true, retired: true },
  storageList: storage(empty, adminEndpoints.listStorageBuckets.result),
  storageCreate: storage(Type.Object({ params: bucketParams }), adminEndpoints.createStorageBucket.result),
  storageUpload: storage(Type.Object({ params: objectParams, headers: imageHeaders }), adminEndpoints.uploadFile.result, true),
  storageSign: storage(Type.Object({
    params: objectParams, query: Type.Object({ expires: Type.Optional(Type.Integer({ minimum: 1, maximum: 604800 })) }),
  }), adminEndpoints.getSignedUrl.result),
  storageDelete: storage(Type.Object({ params: objectParams }), adminEndpoints.deleteFile.result),
  storageAvatar: storage(Type.Object({
    params: Type.Object({ userId: AdminPathSegmentSchema }), headers: imageHeaders,
  }), adminEndpoints.uploadAvatar.result, true),
  storageBrandingUpload: storage(Type.Object({
    params: Type.Object({ assetType: Type.Union([Type.Literal('logo'), Type.Literal('favicon'), Type.Literal('apple_touch_icon')]) }),
    headers: Type.Object({ 'content-type': BrandingImageContentTypeSchema }),
  }), adminEndpoints.uploadBranding.result, true),
  storageBrandingRead: {
    input: Type.Object({ params: Type.Object({ assetType: AdminPathSegmentSchema }) }), request: 'validated',
    responses: { ...storageErrors, 200: { kind: 'binary', contentTypes: [...mediaTypes.filter(type => type.startsWith('image/')), 'image/vnd.microsoft.icon'] } },
  },
} as const satisfies Record<string, ServerRouteContract>;

export type HostedServerContractName = keyof typeof hostedServerContracts;
export type AdminLoginInput = Static<typeof AdminLoginInputSchema>;
