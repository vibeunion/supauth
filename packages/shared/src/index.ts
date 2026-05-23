// @supaoauth/shared — shared schemas and types

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
  };
  sign_in_methods: string[];
  sign_up_enabled: boolean;
  mfa_required: boolean;
  password_policy: {
    min_length: number;
    require_uppercase: boolean;
    require_lowercase: boolean;
    require_numbers: boolean;
    require_symbols: boolean;
  };
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
  secret: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Runtime mode
export type RuntimeMode = 'gotrue' | 'external_oidc';

// Supabase compatibility check result
export interface CompatibilityCheckResult {
  check_id: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}
