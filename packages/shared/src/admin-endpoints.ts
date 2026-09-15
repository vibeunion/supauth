import { Type, type Static, type TSchema } from './schema.js';
import { sdkEndpoints, type SdkEndpoint } from './sdk-endpoints.js';
import * as M from './sdk-models.js';
import * as A from './admin-models.js';

const endpoint = <I extends TSchema, R extends TSchema, K extends SdkEndpoint['responseKind']>(
  method: SdkEndpoint['method'], path: string, input: I, result: R, responseKind: K,
) => ({ method, path, input, result, responseKind });
const empty = Type.Object({});
const orgParams = Type.Object({ orgId: A.AdminPathSegmentSchema });
const configParams = Type.Object({ configId: A.AdminPathSegmentSchema });
const storageParams = Type.Object({ bucketId: A.StorageBucketIdSchema, filePath: A.StorageObjectPathSchema });
const uploadInput = <P extends TSchema>(params: P) => Type.Object({
  params, upload: A.UploadMetadataSchema, headers: Type.Object({ 'Content-Type': A.ImageContentTypeSchema }),
});

// 别名直接引用同源契约；只有 SDK 尚未覆盖的管理端接口在此定义。
export const adminEndpoints = {
  ...sdkEndpoints,
  getApplicationConsent: sdkEndpoints.getApplicationConsentSettings,
  updateApplicationConsent: sdkEndpoints.updateApplicationConsentSettings,
  createResourceScope: sdkEndpoints.addScope,
  updateResourceScope: sdkEndpoints.updateScope,
  deleteResourceScope: sdkEndpoints.removeScope,
  upsertOrganizationApplication: sdkEndpoints.bindOrganizationApplication,
  deleteOrganizationApplication: sdkEndpoints.removeOrganizationApplication,
  updateOrganizationMember: sdkEndpoints.updateOrganizationMemberRole,
  getCustomAccessTokenHookStatus: sdkEndpoints.getAuthHookStatus,
  verifyCustomAccessTokenHook: sdkEndpoints.verifyAuthHook,
  exportAuditLogs: sdkEndpoints.createAuditExport,
  downloadAuditExport: sdkEndpoints.getAuditExportDownload,
  createConnectorFromFactory: endpoint('POST', '/v1/connectors/from-factory/:factoryId',
    Type.Object({ params: Type.Object({ factoryId: A.AdminPathSegmentSchema }), body: A.ConnectorFactoryInputSchema }),
    A.InstantiatedConnectorSchema, 'json'),
  unsuspendUser: endpoint('POST', '/v1/users/:userId/unsuspend',
    Type.Object({ params: Type.Object({ userId: A.AdminPathSegmentSchema }) }), M.UserSchema, 'json'),
  listUserGrants: endpoint('GET', '/v1/users/:userId/grants',
    Type.Object({ params: Type.Object({ userId: A.AdminPathSegmentSchema }) }), M.ListResponseSchema(A.UserOAuthGrantSchema), 'json'),
  updateOrganizationInvitationStatus: endpoint('POST', '/v1/organizations/:orgId/invitations/:invitationId/:action',
    Type.Object({ params: Type.Object({
      orgId: A.AdminPathSegmentSchema, invitationId: A.AdminPathSegmentSchema,
      action: Type.Union([Type.Literal('revoked'), Type.Literal('accepted'), Type.Literal('expired')]),
    }) }), M.RevokedOrganizationInvitationSchema, 'json'),
  getOrganizationJit: endpoint('GET', '/v1/organizations/:orgId/jit', Type.Object({ params: orgParams }), M.OrganizationJitSettingsSchema, 'json'),
  updateOrganizationJit: endpoint('PUT', '/v1/organizations/:orgId/jit',
    Type.Object({ params: orgParams, body: M.OrganizationJitSettingsSchema }), M.OrganizationJitSettingsSchema, 'json'),
  getCustomUiStatus: endpoint('GET', '/v1/sign-in-experience/custom-ui-assets', empty, A.CustomUiStatusSchema, 'json'),
  deleteCustomUiAssets: endpoint('DELETE', '/v1/sign-in-experience/custom-ui-assets', empty, A.DeletedCustomUiSchema, 'json'),
  getAuthConfigRuntimeConsistency: endpoint('GET', '/v1/auth-config/runtime-consistency', empty, A.AuthConfigRuntimeConsistencySchema, 'json'),
  getCustomAccessTokenHookConfig: endpoint('GET', '/v1/auth-hooks/custom-access-token/config', empty, A.CustomAccessTokenHookConfigSchema, 'json'),
  updateCustomAccessTokenHookConfig: endpoint('PATCH', '/v1/auth-hooks/custom-access-token/config',
    Type.Object({ body: A.CustomAccessTokenHookInputSchema }), A.CustomAccessTokenHookConfigSchema, 'json'),
  listStorageBuckets: endpoint('GET', '/v1/storage/buckets', empty, Type.Object({ buckets: Type.Array(A.StorageBucketSchema) }), 'json'),
  createStorageBucket: endpoint('POST', '/v1/storage/buckets/:bucketId',
    Type.Object({ params: Type.Object({ bucketId: A.StorageBucketIdSchema }) }), Type.Object({ bucket: A.StorageBucketSchema }), 'json'),
  uploadFile: endpoint('POST', '/v1/storage/upload/:bucketId/*filePath', uploadInput(storageParams), A.UploadedFileSchema, 'json'),
  getSignedUrl: endpoint('GET', '/v1/storage/sign-url/:bucketId/*filePath',
    Type.Object({ params: storageParams, query: Type.Object({ expires: Type.Integer({ minimum: 1 }) }) }), A.SignedStorageUrlSchema, 'json'),
  deleteFile: endpoint('DELETE', '/v1/storage/delete/:bucketId/*filePath',
    Type.Object({ params: storageParams }), A.DeletedFileSchema, 'json'),
  uploadAvatar: endpoint('POST', '/v1/storage/avatar/:userId',
    uploadInput(Type.Object({ userId: A.AdminPathSegmentSchema })), A.UploadedAvatarSchema, 'json'),
  uploadBranding: endpoint('POST', '/v1/storage/branding/:assetType',
    Type.Object({
      params: Type.Object({ assetType: A.BrandingAssetTypeSchema }),
      upload: A.BrandingUploadMetadataSchema,
      headers: Type.Object({ 'Content-Type': A.BrandingImageContentTypeSchema }),
    }), A.UploadedBrandingSchema, 'json'),
  getBrandingAsset: endpoint('GET', '/v1/storage/branding/:assetType',
    Type.Object({ params: Type.Object({ assetType: A.AdminPathSegmentSchema }) }), Type.String({ format: 'binary' }), 'blob'),
  deleteOrgTemplate: endpoint('DELETE', '/v1/org-templates/:templateId',
    Type.Object({ params: Type.Object({ templateId: A.AdminPathSegmentSchema }) }), Type.Void(), 'void'),
  getSecurityConfig: endpoint('GET', '/v1/security-config', empty, A.SecurityConfigSchema, 'json'),
  updateSecurityConfig: endpoint('PUT', '/v1/security-config',
    Type.Object({ body: A.SecurityConfigInputSchema }), A.SecurityConfigSchema, 'json'),
  getEnterpriseSSOConfig: endpoint('GET', '/v1/enterprise-sso/:configId',
    Type.Object({ params: configParams }), M.EnterpriseSSOConfigSchema, 'json'),
  updateEnterpriseSSOConfig: endpoint('PUT', '/v1/enterprise-sso/:configId',
    Type.Object({ params: configParams, body: Type.Partial(Type.Omit(sdkEndpoints.createEnterpriseSSOConfig.input.properties.body, ['connector_id'])) }),
    M.EnterpriseSSOConfigSchema, 'json'),
  deleteEnterpriseSSOConfig: endpoint('DELETE', '/v1/enterprise-sso/:configId',
    Type.Object({ params: configParams }), Type.Void(), 'void'),
} as const;

export type AdminEndpointName = keyof typeof adminEndpoints;
export type AdminEndpointInput<K extends AdminEndpointName> = Static<(typeof adminEndpoints)[K]['input']>;
// 二进制载体由 transport 指定，共享声明不依赖 DOM 的 Blob。
export type AdminEndpointResult<K extends AdminEndpointName, Binary = Uint8Array> =
  (typeof adminEndpoints)[K]['responseKind'] extends 'blob' ? Binary :
  (typeof adminEndpoints)[K]['responseKind'] extends 'void' ? null :
  Static<(typeof adminEndpoints)[K]['result']>;
