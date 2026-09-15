import { describe, expect, it } from 'bun:test';
import * as Core from '../core.js';
import * as Claims from '../claims.js';
import {
  decodeSchema,
  JsonObjectSchema,
  JsonValueSchema,
  SchemaDecodeError,
  Type,
  type JsonObject,
  type JsonValue,
  type Static,
  type TSchema,
} from '../schema.js';

const timestamps = { created_at: '2026-09-08', updated_at: '2026-09-08' };
const application = {
  id: 'app',
  name: 'Example',
  type: 'spa',
  redirect_uris: [],
  allowed_cors_origins: [],
  grant_types: [],
  token_endpoint_auth_method: 'none',
  client_id: 'client',
  ...timestamps,
} satisfies Core.Application;
const permission = { id: 'permission', name: 'read' } satisfies Core.Permission;
const role = { id: 'role', name: 'reader', permissions: [permission] } satisfies Core.Role;
const signIn = {
  branding: {},
  sign_in_methods: ['password'],
  sign_up_enabled: true,
  password_policy: {
    min_length: 8,
    require_uppercase: false,
    require_lowercase: true,
    require_numbers: false,
    require_symbols: false,
  },
} satisfies Core.SignInExperience;
const capability = {
  source: 'gotrue',
  version: null,
  last_verified_at: '2026-09-08',
  available: true,
  reason_code: null,
} satisfies Core.CapabilityStatus;
const claims = {
  sub: 'user',
  role: 'authenticated',
  aud: 'authenticated',
  iss: 'issuer',
  exp: 10,
  iat: 1,
  aal: 'aal1',
  session_id: 'session',
  is_anonymous: false,
} satisfies Claims.SupaOAuthJWTClaims;

const domainCases: Array<{ name: string; schema: TSchema; valid: unknown; invalid: unknown }> = [
  { name: 'ApplicationType', schema: Core.ApplicationTypeSchema, valid: 'spa', invalid: 'server' },
  { name: 'Application', schema: Core.ApplicationSchema, valid: application, invalid: { ...application, redirect_uris: [1] } },
  { name: 'CreateApplicationInput', schema: Core.CreateApplicationInputSchema, valid: { name: 'App', type: 'm2m', redirect_uris: [] }, invalid: { name: 'App', type: 'm2m' } },
  { name: 'Scope', schema: Core.ScopeSchema, valid: { id: 's', name: 'read', resource_id: 'r' }, invalid: { id: 's', name: 'read' } },
  { name: 'ApiResource', schema: Core.ApiResourceSchema, valid: { id: 'r', name: 'API', indicator: 'api', scopes: [], ...timestamps }, invalid: { id: 'r', scopes: [{}] } },
  { name: 'CreateResourceInput', schema: Core.CreateResourceInputSchema, valid: { name: 'API', indicator: 'api', scopes: [{ name: 'read' }] }, invalid: { name: 'API', indicator: 'api', scopes: [{ name: 1 }] } },
  { name: 'ConnectorCategory', schema: Core.ConnectorCategorySchema, valid: 'enterprise_sso', invalid: 'oauth' },
  { name: 'Connector', schema: Core.ConnectorSchema, valid: { id: 'c', name: 'SSO', category: 'social', provider_id: 'p', enabled: true, config: { nested: [null, true] }, ...timestamps }, invalid: { id: 'c', config: [] } },
  { name: 'OrganizationMember', schema: Core.OrganizationMemberSchema, valid: { user_id: 'u', role: 'member', joined_at: '' }, invalid: { user_id: 'u', role: 1, joined_at: '' } },
  { name: 'Organization', schema: Core.OrganizationSchema, valid: { id: 'o', name: 'Org', members: [], ...timestamps }, invalid: { id: 'o', name: 'Org', members: [{}], ...timestamps } },
  { name: 'Permission', schema: Core.PermissionSchema, valid: permission, invalid: { ...permission, resource_id: null } },
  { name: 'Role', schema: Core.RoleSchema, valid: role, invalid: { ...role, permissions: [{ arbitrary: 'json' }] } },
  { name: 'SignInExperience', schema: Core.SignInExperienceSchema, valid: signIn, invalid: { ...signIn, password_policy: { min_length: 8 } } },
  { name: 'ApplicationSignInExperience', schema: Core.ApplicationSignInExperienceSchema, valid: { application_id: 'a', enabled: true, branding: { logo_url: null } }, invalid: { application_id: 'a', enabled: true, branding: { logo_url: 1 } } },
  { name: 'EffectiveSignInExperience', schema: Core.EffectiveSignInExperienceSchema, valid: { ...signIn, application: null, authorization: null }, invalid: { ...signIn, authorization: { arbitrary: 'json' } } },
  { name: 'PublicSignInConnector', schema: Core.PublicSignInConnectorSchema, valid: { id: 'c', name: 'SSO', type: 'social' }, invalid: { id: 'c', name: 'SSO' } },
  { name: 'PublicEffectiveSignInExperience', schema: Core.PublicEffectiveSignInExperienceSchema, valid: { ...signIn, connectors: [{ id: 'c', name: 'SSO', type: 'social' }] }, invalid: { ...signIn, connectors: [{}] } },
  { name: 'PublicPhraseBundle', schema: Core.PublicPhraseBundleSchema, valid: { language_tag: 'en', phrases: { login: { title: 'Login' } } }, invalid: { language_tag: 'en', phrases: { login: undefined } } },
  { name: 'AuditLogEntry', schema: Core.AuditLogEntrySchema, valid: { id: 'a', event_type: 'created', actor_type: 'system', resource_type: 'role', resource_id: 'r', details: {}, created_at: '' }, invalid: { id: 'a', actor_type: 'bot' } },
  { name: 'Webhook', schema: Core.WebhookSchema, valid: { id: 'w', url: 'https://example.test', events: [], secret_configured: true, enabled: true, ...timestamps }, invalid: { id: 'w', secret: 'not-the-public-contract' } },
  { name: 'RuntimeMode', schema: Core.RuntimeModeSchema, valid: 'gotrue', invalid: 'embedded' },
  { name: 'CapabilityStatus', schema: Core.CapabilityStatusSchema, valid: capability, invalid: { ...capability, reason_code: 'not_supported' } },
  { name: 'CapabilitiesResponse', schema: Core.CapabilitiesResponseSchema, valid: { runtime_mode: 'gotrue', capabilities: { oauth: capability } }, invalid: { runtime_mode: 'gotrue', capabilities: { oauth: {} } } },
  { name: 'ApiErrorResponse', schema: Core.ApiErrorResponseSchema, valid: { success: false, error: { code: 'FAILED', message: 'Failed', correlation_id: 'id' } }, invalid: { success: true, error: { code: 'FAILED', message: 'Failed', correlation_id: 'id' } } },
  { name: 'CompatibilityCheckResult', schema: Core.CompatibilityCheckResultSchema, valid: { check_id: 'c', status: 'warn', message: 'Warning' }, invalid: { check_id: 'c', status: 'ok', message: 'Wrong' } },
];

describe('schema-first core contracts', () => {
  for (const { name, schema, valid, invalid } of domainCases) {
    it(`${name} accepts its declared shape and rejects invalid domain data`, () => {
      expect(decodeSchema(schema, valid)).toBe(valid);
      expect(() => decodeSchema(schema, invalid)).toThrow(SchemaDecodeError);
    });
  }

  it('covers every exported core schema except the separately tested pagination factories', () => {
    const covered = domainCases.map(({ name }) => `${name}Schema`).sort();
    const schemas = Object.keys(Core).filter((name) => name.endsWith('Schema')
      && name !== 'PagedResponseSchema' && name !== 'CursorResponseSchema').sort();
    expect(covered).toEqual(schemas);
  });

  it('preserves additive fields, optional create-only secrets and null overrides', () => {
    const input = { ...application, future_field: 'preserved', client_secret: 'fixture-only' };
    expect(decodeSchema(Core.ApplicationSchema, input)).toBe(input);
    expect(() => decodeSchema(Core.ApplicationSchema, { ...application, client_secret: null })).toThrow(SchemaDecodeError);
    const authorization = {
      authorization_id: 'auth', client_id: 'client', redirect_uri: '', response_type: 'code',
      scope: null, state: null, resource: null, code_challenge: null,
      code_challenge_method: null, nonce: null,
    };
    expect(decodeSchema(Core.EffectiveSignInExperienceSchema, { ...signIn, authorization }).authorization)
      .toEqual(authorization);
  });

  it('keeps the unavailable capability branch and verification timestamp mandatory', () => {
    expect(decodeSchema(Core.CapabilityStatusSchema, {
      ...capability, available: false, reason_code: 'not_supported',
    }).available).toBe(false);
    expect(() => decodeSchema(Core.CapabilityStatusSchema, {
      ...capability, available: false,
    })).toThrow(SchemaDecodeError);
    expect(() => decodeSchema(Core.CapabilityStatusSchema, {
      source: 'gotrue', version: null, available: true, reason_code: null,
    })).toThrow(SchemaDecodeError);
  });

  it('validates concrete pagination items and infers legacy generic aliases', () => {
    const pagedSchema = Core.PagedResponseSchema(Core.RoleSchema);
    const page = { items: [role], total: 1, page: 1, limit: 20 };
    const decoded: Core.PagedResponse<Core.Role> = decodeSchema(pagedSchema, page);
    const inferred: Static<typeof pagedSchema> = decoded;
    expect(inferred.items[0]?.permissions[0]?.name).toBe('read');
    expect(() => decodeSchema(pagedSchema, { ...page, items: [{}] })).toThrow(SchemaDecodeError);
    expect(() => decodeSchema(pagedSchema, { ...page, total: '1' })).toThrow(SchemaDecodeError);

    const cursorSchema = Core.CursorResponseSchema(Core.ApplicationSchema);
    const cursor: Core.CursorResponse<Core.Application> = decodeSchema(cursorSchema, {
      items: [application], total: 1, limit: 20, next_cursor: null,
    });
    expect(cursor.items[0]?.client_id).toBe('client');
    expect(() => decodeSchema(cursorSchema, { ...cursor, next_cursor: 1 })).toThrow(SchemaDecodeError);

    const wrongPage = { ...page, items: ['wrong'] };
    // @ts-expect-error 分页泛型必须保留具体领域类型，不能退化为宽泛类型。
    const rejected: Core.PagedResponse<Core.Role> = wrongPage;
    expect(() => decodeSchema(pagedSchema, rejected)).toThrow(SchemaDecodeError);
    // @ts-expect-error exactOptionalPropertyTypes 不允许显式 undefined 冒充省略字段。
    const wrongOptional: Core.Permission = { ...permission, description: undefined };
    expect(wrongOptional.description).toBeUndefined();
  });
});

describe('open JSON metadata', () => {
  it('rejects hidden fields and accessors without executing them', () => {
    const hidden = Object.defineProperty({ ...permission }, 'description', { value: undefined });
    expect(() => decodeSchema(Core.PermissionSchema, hidden)).toThrow(SchemaDecodeError);
    let reads = 0;
    const accessor = Object.defineProperty({ ...permission }, 'description', {
      enumerable: true,
      get() { reads++; return reads < 3 ? 'valid' : undefined; },
    });
    expect(() => decodeSchema(Core.PermissionSchema, accessor)).toThrow(SchemaDecodeError);
    expect(reads).toBe(0);
    for (const key of ['extra', Symbol('extra')]) {
      const array = Object.defineProperty(['valid'], key, { value: 'hidden', enumerable: true });
      expect(() => decodeSchema(JsonValueSchema, array)).toThrow(SchemaDecodeError);
    }
    expect(() => decodeSchema(JsonValueSchema, Object.defineProperty(['valid'], '0', {
      value: 'valid', enumerable: false,
    }))).toThrow(SchemaDecodeError);
    expect(decodeSchema(JsonValueSchema, Object.freeze(['valid']))).toEqual(['valid']);
  });

  it('rejects explicit undefined in optional fields without relying on a mutable TypeBox policy', () => {
    expect(() => decodeSchema(Core.PermissionSchema, { ...permission, description: undefined }))
      .toThrow(SchemaDecodeError);
    expect(() => decodeSchema(Claims.SupaOAuthAppMetadataSchema, {
      schema_version: 2, projects: { project: { roles: undefined } },
    })).toThrow(SchemaDecodeError);
    expect(() => decodeSchema(Type.Union([
      Type.Object({ kind: Type.Literal('one'), note: Type.Optional(Type.String()) }),
      Type.Object({ kind: Type.Literal('two'), note: Type.Optional(Type.Number()) }),
    ]), { kind: 'one', note: undefined })).toThrow(SchemaDecodeError);
    expect(decodeSchema(Type.Void(), undefined)).toBeUndefined();
  });

  it('rejects host containers and sparse arrays that would lose data in JSON', () => {
    for (const value of [new Map([['hidden', 'value']]), new Set(['value']), new Date(), Array(1)]) {
      expect(() => decodeSchema(JsonValueSchema, value)).toThrow(SchemaDecodeError);
    }
    const dictionary: unknown = Object.assign(Object.create(null), { value: ['valid', null] });
    expect(dictionary).toBe(decodeSchema(JsonObjectSchema, dictionary));
    const shared = { value: true };
    expect(decodeSchema(JsonValueSchema, { first: shared, second: shared }))
      .toEqual({ first: shared, second: shared });
  });

  it('supports recursively nested objects, arrays and primitive JSON values', () => {
    const metadata: JsonObject = { nested: [{ active: true, score: 1, missing: null, names: ['a'] }] };
    expect(decodeSchema(JsonObjectSchema, metadata)).toBe(metadata);
    const value: JsonValue = [metadata, null, 1, 'text', false];
    expect(decodeSchema(JsonValueSchema, value)).toBe(value);
    expect(decodeSchema(Type.Object({ first: JsonObjectSchema, second: JsonObjectSchema }), {
      first: metadata, second: { another: [metadata] },
    }).first).toBe(metadata);
  });

  it('rejects non-JSON nested values and non-object dictionary roots', () => {
    for (const value of [undefined, 1n, () => 'value', Symbol('value'), NaN, Infinity, new Date()]) {
      expect(() => decodeSchema(JsonValueSchema, { nested: [value] })).toThrow(SchemaDecodeError);
    }
    for (const value of [null, [], 'text', 1, false]) {
      expect(() => decodeSchema(JsonObjectSchema, value)).toThrow(SchemaDecodeError);
    }
    // @ts-expect-error 开放 metadata 仍然只能包含 JSON 数据。
    const invalid: JsonValue = { nested: { run: () => true } };
    expect(() => decodeSchema(JsonValueSchema, invalid)).toThrow(SchemaDecodeError);
  });
});

describe('redacted runtime boundary', () => {
  it('returns a stable error without retaining input values, field paths or causes', () => {
    const secret = 'fixture-sensitive-value';
    let caught: unknown;
    try {
      decodeSchema(Type.Object({ [secret]: Type.Number() }), { [secret]: secret });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SchemaDecodeError);
    if (!(caught instanceof SchemaDecodeError)) throw new Error('Expected schema error');
    expect(caught.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(caught.message).toBe('Response does not match the expected schema.');
    expect(caught).not.toHaveProperty('cause');
    expect(caught).not.toHaveProperty('value');
    expect(caught).not.toHaveProperty('schema');
    expect(caught).not.toHaveProperty('errors');
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(caught.stack).not.toContain(secret);
  });

  it('redacts validator exceptions and rejects circular metadata', () => {
    const input = { get value(): string { throw new Error('fixture-sensitive-getter'); } };
    expect(() => decodeSchema(Type.Object({ value: Type.String() }), input))
      .toThrow('Response does not match the expected schema.');
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(() => decodeSchema(JsonObjectSchema, cycle)).toThrow(SchemaDecodeError);
  });
});

describe('schema-first claims compatibility', () => {
  it('keeps optional JWT claims optional and accepts the existing runtime roles', () => {
    for (const roleValue of Claims.SUPABASE_RUNTIME_ROLES) {
      expect(decodeSchema(Claims.SupaOAuthJWTClaimsSchema, { ...claims, role: roleValue }).role).toBe(roleValue);
    }
    expect(decodeSchema(Claims.SupaOAuthJWTClaimsSchema, {
      ...claims, client_id: 'client', scope: 'openid', user_id: 'legacy',
      app_metadata: { provider: 'email' }, user_metadata: { profile: ['text', null] },
    }).user_id).toBe('legacy');
    expect(() => decodeSchema(Claims.SupaOAuthJWTClaimsSchema, { ...claims, role: 'admin' })).toThrow(SchemaDecodeError);
    expect(() => decodeSchema(Claims.SupaOAuthJWTClaimsSchema, { ...claims, exp: '10' })).toThrow(SchemaDecodeError);
    // @ts-expect-error Schema 推导仍保留运行时角色字面量联合。
    const invalidRole: Claims.SupabaseRuntimeRole = 'admin';
    expect(() => decodeSchema(Claims.SupabaseRuntimeRoleSchema, invalidRole)).toThrow(SchemaDecodeError);
  });

  it('validates nested permission projections as domain objects, not arbitrary JSON', () => {
    const metadata = {
      schema_version: Claims.SUPAOAUTH_APP_METADATA_SCHEMA_VERSION,
      projects: {
        project: {
          roles: ['reader'], permissions: ['read'], roles_count: 1, roles_truncated: false,
          applications: { app: { organization_ids: ['org'], organizations: { org: { scopes: ['read'] } } } },
          organization_memberships: [{ organization_id: 'org', slug: 'org', role: 'member' }],
          organization_memberships_total: 1, organization_memberships_truncated: false,
        },
      },
      hook: { version: 1, authentication_method: 'password', processed_at: '' },
    } satisfies Claims.SupaOAuthAppMetadata;
    expect(decodeSchema(Claims.SupaOAuthAppMetadataSchema, metadata)).toBe(metadata);
    expect(() => decodeSchema(Claims.SupaOAuthAppMetadataSchema, { ...metadata, schema_version: 1 })).toThrow(SchemaDecodeError);
    expect(() => decodeSchema(Claims.SupaOAuthAppMetadataSchema, {
      schema_version: 2, projects: { project: { applications: { app: { roles: [1] } } } },
    })).toThrow(SchemaDecodeError);
    expect(() => decodeSchema(Claims.SupaOAuthProjectProjectionSchema, {
      organization_memberships: [{ arbitrary: 'json' }],
    })).toThrow(SchemaDecodeError);
  });

  it('keeps claim lists and strategy location alternatives unchanged', () => {
    for (const [schema, values] of [
      [Claims.SupabaseRequiredClaimSchema, Claims.SUPABASE_REQUIRED_CLAIMS],
      [Claims.SupabaseMetadataClaimSchema, Claims.SUPABASE_METADATA_CLAIMS],
      [Claims.SupabaseOAuthAccessTokenClaimSchema, Claims.SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS],
      [Claims.SupabaseOAuthStandardScopeSchema, Claims.SUPABASE_OAUTH_STANDARD_SCOPES],
    ] as const) {
      for (const value of values) expect(decodeSchema(schema, value)).toBe(value);
      expect(() => decodeSchema(schema, 'not-a-supported-value')).toThrow(SchemaDecodeError);
    }
    expect(decodeSchema(Claims.ClaimsMappingStrategySchema, Claims.GOTRUE_CLAIMS_STRATEGY))
      .toBe(Claims.GOTRUE_CLAIMS_STRATEGY);
    const alternate = {
      ...Claims.GOTRUE_CLAIMS_STRATEGY,
      roles: { location: 'jwt_claim', key: 'roles' },
      organization: { location: 'jwt_claim', key: 'organization' },
      scopes: { location: 'management_api', key: 'scopes' },
      permissions: { location: 'jwt_claim', key: 'permissions' },
      applications: { location: 'management_api', key: 'applications' },
    } satisfies Claims.ClaimsMappingStrategy;
    expect(decodeSchema(Claims.ClaimsMappingStrategySchema, alternate)).toBe(alternate);
    expect(() => decodeSchema(Claims.ClaimsMappingStrategySchema, {
      ...alternate, applications: { location: 'jwt_claim', key: 'applications' },
    })).toThrow(SchemaDecodeError);
  });
});
