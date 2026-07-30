// @supauth/shared — shared schemas and types

// Re-export claims module
export * from './claims.js';

// Application types
export type ApplicationType = 'spa' | 'web' | 'native' | 'm2m';

export interface Application {
  id: string;
  name: string;
  type: ApplicationType;
  redirect_uris: string[];
  allowed_cors_origins: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  client_id: string;
  client_secret?: string; // only returned on create/rotate
  created_at: string;
  updated_at: string;
}

export interface CreateApplicationInput {
  name: string;
  type: ApplicationType;
  redirect_uris: string[];
  allowed_cors_origins?: string[];
  grant_types?: string[];
}

// API Resource / Scope
export interface ApiResource {
  id: string;
  name: string;
  indicator: string;
  scopes: Scope[];
  created_at: string;
  updated_at: string;
}

export interface Scope {
  id: string;
  name: string;
  description?: string;
  resource_id: string;
}

export interface CreateResourceInput {
  name: string;
  indicator: string;
  scopes?: Omit<Scope, 'id' | 'resource_id'>[];
}

// Connector (Social / Enterprise SSO)
export type ConnectorCategory = 'social' | 'enterprise_sso';

export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  provider_id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Organization
export interface Organization {
  id: string;
  name: string;
  description?: string;
  members: OrganizationMember[];
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  user_id: string;
  role: string;
  joined_at: string;
}

// Role / Permission
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface Permission {
  id: string;
  name: string;
  description?: string;
  resource_id?: string;
  scope_id?: string;
}

// Sign-in Experience
export interface SignInExperience {
  branding: {
    logo_url?: string;
    favicon_url?: string;
    primary_color?: string;
    page_title?: string;
    background_url?: string;
    button_label?: string;
    custom_css?: string;
  };
  sign_in_methods: string[];
  sign_up_enabled: boolean;
  password_policy: {
    min_length: number;
    require_uppercase: boolean;
    require_lowercase: boolean;
    require_numbers: boolean;
    require_symbols: boolean;
  };
}

export interface ApplicationSignInExperience {
  application_id: string;
  enabled: boolean;
  branding: {
    logo_url?: string | null;
    favicon_url?: string | null;
    primary_color?: string | null;
    page_title?: string | null;
    background_url?: string | null;
    button_label?: string | null;
    custom_css?: string | null;
  };
}

export interface EffectiveSignInExperience extends SignInExperience {
  application?: ApplicationSignInExperience | null;
  authorization?: {
    authorization_id: string;
    client_id: string;
    redirect_uri: string;
    scope?: string | null;
    state?: string | null;
    resource?: string | null;
    code_challenge?: string | null;
    code_challenge_method?: string | null;
    response_type: string;
    nonce?: string | null;
  } | null;
}

export interface PublicSignInConnector {
  id: string;
  name: string;
  type: string;
}

export interface PublicEffectiveSignInExperience extends EffectiveSignInExperience {
  connectors?: PublicSignInConnector[];
}

export interface PublicPhraseBundle {
  language_tag: string;
  phrases: Record<string, unknown>;
}

// Audit log
export interface AuditLogEntry {
  id: string;
  event_type: string;
  actor_id?: string;
  actor_type: 'admin' | 'user' | 'system';
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

// Webhook
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret_configured: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Runtime mode
/** SupaOAuth delegates the authentication runtime to stock Supabase GoTrue. */
export type RuntimeMode = 'gotrue';

export interface CapabilityStatus {
  available: boolean;
  source: 'gotrue' | 'supacloud' | 'supaoauth';
  version: string | null;
  reason_code: string | null;
}

export interface CapabilitiesResponse {
  runtime_mode: RuntimeMode;
  capabilities: Record<string, CapabilityStatus>;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CursorResponse<T> {
  items: T[];
  total: number;
  limit: number;
  next_cursor: string | null;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    correlation_id: string;
    details?: Record<string, unknown>;
  };
}

// Supabase compatibility check result
export interface CompatibilityCheckResult {
  check_id: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}
