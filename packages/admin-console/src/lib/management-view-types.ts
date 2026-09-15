import type {
  AdminEndpointResult,
  OrganizationTemplate,
  JsonObject,
} from '@supauth/shared';

export type {
  CollectionPage,
  CollectionPayload,
  ResourceLoadContext,
  Operation,
  KeyedOperation,
} from './resource-page.js';
export type { DurableMutationLocks, MutationLockDescriptor } from './mutation-reconciliation.js';

type VariantKeys<T> = T extends T ? keyof T : never;
type VariantField<T, K extends PropertyKey> = T extends T ? K extends keyof T ? T[K] : never : never;
// 保留响应联合共有字段的必填性，仅将版本间独有字段投影为可选显示字段。
type View<T> = Pick<T, keyof T> & {
  [K in Exclude<VariantKeys<T>, keyof T>]?: VariantField<T, K>;
};

export type ApplicationView = AdminEndpointResult<'getApplication'> & {
  id?: string; name?: string; type?: string;
  clientId?: string; application_id?: string; clientName?: string;
};
export type UserView = AdminEndpointResult<'getUser'> & {
  user_id?: string; userId?: string; name?: string; full_name?: string;
  raw_user_meta_data?: JsonObject;
};
export type RoleView = AdminEndpointResult<'getRole'>;
export type PermissionView = AdminEndpointResult<'listRolePermissions'>['items'][number];
export type AssignmentView = AdminEndpointResult<'assignRole'> & {
  assignment_id?: string; userId?: string; applicationId?: string;
  organizationId?: string; createdAt?: string; user_email?: string; application_name?: string;
  name?: string; role_name?: string; description?: string;
};
export type UserRoleView = AdminEndpointResult<'getUserRoles'>['items'][number] & {
  role?: { id?: string; name?: string; role_id?: string; role_name?: string; description?: string };
  name?: string; role_name?: string; assignment_id?: string; description?: string;
};
export type UserPermissionView = string | (Partial<PermissionView> & { permission?: string });
export type OrganizationView = View<AdminEndpointResult<'getOrganization'>> & {
  organization_id?: string; organizationId?: string; organization_name?: string;
  role?: string; role_name?: string;
};
export type OrganizationMemberView = View<AdminEndpointResult<'addOrganizationMember'>> & {
  userId?: string; role_name?: string;
};
export type OrganizationApplicationView = AdminEndpointResult<'upsertOrganizationApplication'> & {
  applicationId?: string;
};
export type OrganizationJitView = AdminEndpointResult<'getOrganizationJit'> & {
  emailDomains?: string[]; email_domains?: string[];
};
export type EnterpriseSsoView = AdminEndpointResult<'getEnterpriseSSOConfig'>;
export type ConnectorView = View<AdminEndpointResult<'getConnector'>> & {
  category?: string;
  _meta?: { id?: string };
};
export type ConnectorFactoryView = AdminEndpointResult<'listConnectorFactories'>['items'][number];
export type TemplateView = OrganizationTemplate;
export type ResourceView = View<AdminEndpointResult<'getResource'>>;
export type ResourceApplicationView = View<AdminEndpointResult<'listResourceApplications'>['items'][number]> & {
  client_id?: string; client_name?: string;
};
export type WebhookView = View<AdminEndpointResult<'getWebhook'>> & {
  hasSecret?: boolean; signingKeyId?: string;
};
export type WebhookDeliveryView = View<AdminEndpointResult<'getWebhookDelivery'>> & {
  delivery_id?: string; deliveryId?: string; createdAt?: string;
  eventType?: string; statusCode?: number | null; event?: string;
};
export type ApplicationBindingView = View<AdminEndpointResult<'listApplicationBindings'>['items'][number]>;
export type ApplicationConsentView = AdminEndpointResult<'getApplicationConsent'> & {
  user_scopes?: string[]; organization_scopes?: string[]; allowed_organization_ids?: string[];
  require_explicit_consent?: boolean;
};
export type ApplicationAccessControlView = AdminEndpointResult<'getApplicationAccessControl'> & {
  enabled?: boolean; organization_required?: boolean; allowed_organization_ids?: string[];
};
export type ApplicationBrandingView = AdminEndpointResult<'getApplicationSignInExperience'> & {
  _meta?: JsonObject;
};
export type WebhookAction = "create" | "delete" | "replay" | "rotate" | "test" | "toggle";
export type CapabilitiesView = AdminEndpointResult<'getCapabilities'>;
export type AuditEntryView = AdminEndpointResult<'listUserLogs'>['items'][number] & {
  eventType?: string; createdAt?: string; actorId?: string; resourceType?: string;
};
export type UserGrantView = AdminEndpointResult<'listUserGrants'>['items'][number] & {
  id?: string; client_name?: string; granted_at?: string;
};
export type WebhookEventCatalogEntry = AdminEndpointResult<'listWebhookEvents'>['catalog'][number] & {
  resource?: string; description?: string;
};

export type ValueEvent<T extends HTMLElement = HTMLInputElement> = Event & { currentTarget: T };
export type TextValues = Record<string, string | number>;
export type JsonForm = Record<string, string>;
export type JsonMetadata = JsonObject;
export type RotationState = { pending: boolean; outcomeUnknown: boolean };
export type EnterpriseSsoForm = {
  connector_id?: string;
  domains: string;
  sso_protocol: string;
  jit_provisioning: boolean;
  org_membership_mapping: string;
  role_mapping: string;
};
