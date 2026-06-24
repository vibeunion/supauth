import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  EXTERNAL_OIDC_CLAIMS_STRATEGY,
  GOTRUE_CLAIMS_STRATEGY,
  LEGACY_EXTERNAL_OIDC_TOP_LEVEL_CLAIMS_STRATEGY,
  SUPABASE_METADATA_CLAIMS,
  SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS,
  SUPABASE_OAUTH_STANDARD_SCOPES,
  SUPABASE_REQUIRED_CLAIMS,
  SUPABASE_RUNTIME_ROLES,
  SUPAOAUTH_CLAIM_KEYS,
} from '../packages/shared/src/index.js';

describe('Supabase claims compatibility contract', () => {
  it('keeps GoTrue mode on app_metadata.supaoauth instead of top-level business claims', () => {
    expect(GOTRUE_CLAIMS_STRATEGY.roles).toEqual({
      location: 'app_metadata',
      key: 'app_metadata.supaoauth.roles',
    });
    expect(GOTRUE_CLAIMS_STRATEGY.organization).toEqual({
      location: 'app_metadata',
      key: 'app_metadata.supaoauth.current_org_id',
    });
    expect(GOTRUE_CLAIMS_STRATEGY.permissions.location).toBe('management_api');
    expect(GOTRUE_CLAIMS_STRATEGY.scopes.location).toBe('management_api');
  });

  it('keeps external OIDC default claims compatible with Supabase app_metadata shape', () => {
    expect(EXTERNAL_OIDC_CLAIMS_STRATEGY.roles).toEqual({
      location: 'app_metadata',
      key: 'app_metadata.supaoauth.roles',
    });
    expect(EXTERNAL_OIDC_CLAIMS_STRATEGY.permissions).toEqual({
      location: 'management_api',
      key: '',
    });
  });

  it('keeps top-level supaoauth claims behind an explicit legacy external OIDC strategy', () => {
    expect(LEGACY_EXTERNAL_OIDC_TOP_LEVEL_CLAIMS_STRATEGY.roles).toEqual({
      location: 'jwt_claim',
      key: 'supaoauth:roles',
    });
  });

  it('keeps live Supabase token fixtures guarded against legacy top-level claims', () => {
    const oauth21Fixture = readFileSync('tests/integration/supabase-compat/oauth21.test.ts', 'utf8');
    const supabaseJsFixture = readFileSync('tests/integration/supabase-compat/supabase-js.test.ts', 'utf8');
    const authHookBridge = readFileSync('packages/auth-server/src/auth/hooks-bridge.ts', 'utf8');

    expect(SUPAOAUTH_CLAIM_KEYS).toContain('supaoauth:roles');
    for (const fixture of [oauth21Fixture, supabaseJsFixture]) {
      expect(fixture).toContain('SUPAOAUTH_CLAIM_KEYS');
      expect(fixture).toContain('not.toHaveProperty(claim)');
    }
    expect(authHookBridge).toContain('AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS');
    expect(authHookBridge).toContain("'supaoauth'");
    for (const claim of SUPAOAUTH_CLAIM_KEYS) {
      expect(authHookBridge).toContain(`'${claim}'`);
    }
    expect(authHookBridge).toContain('delete next[claim]');
  });

  it('tracks Supabase access-token claims required by auth hooks and RLS', () => {
    const expectedClaims = ['iss', 'aud', 'exp', 'iat', 'sub', 'role', 'aal', 'session_id', 'email', 'phone', 'is_anonymous'] as const;
    expect(SUPABASE_REQUIRED_CLAIMS).toEqual([...expectedClaims]);
    for (const claim of expectedClaims) {
      expect(SUPABASE_REQUIRED_CLAIMS).toContain(claim);
    }
    for (const claim of SUPABASE_METADATA_CLAIMS) {
      expect(SUPABASE_REQUIRED_CLAIMS).not.toContain(claim);
    }
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('user_id');
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('client_id');
  });

  it('tracks Supabase metadata claims separately for SupaOAuth extension preservation', () => {
    const authHookTest = readFileSync('packages/auth-server/src/__tests__/auth-hooks.test.ts', 'utf8');

    expect(SUPABASE_METADATA_CLAIMS).toEqual(['app_metadata', 'user_metadata']);
    expect(authHookTest).toContain('app_metadata');
    expect(authHookTest).toContain('user_metadata');
  });

  it('tracks OAuth server access-token claims separately', () => {
    const oauthFixture = readFileSync('tests/integration/supabase-compat/oauth21.test.ts', 'utf8');

    expect(SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS).toEqual(['user_id', 'client_id']);
    expect(oauthFixture).toContain('SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS');
    expect(oauthFixture).toContain('expectSupabaseOAuthAccessTokenPayload(payload, metadata.issuer)');
    expect(oauthFixture).toContain('expect(payload.user_id).toBe(payload.sub)');
  });

  it('tracks OAuth response scopes separately from JWT claims and enterprise permissions', () => {
    const oauthFixture = readFileSync('tests/integration/supabase-compat/oauth21.test.ts', 'utf8');

    expect(SUPABASE_OAUTH_STANDARD_SCOPES).toEqual(['openid', 'email', 'profile', 'phone']);
    for (const scope of SUPABASE_OAUTH_STANDARD_SCOPES) {
      expect(SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS).not.toContain(scope);
    }
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('openid');
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('profile');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('email');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('phone');
    expect(oauthFixture).toContain('expectGrantedOAuthScope(body)');
    expect(oauthFixture).toContain('SUPABASE_OAUTH_STANDARD_SCOPES');
  });

  it('preserves the Supabase runtime role domain', () => {
    expect(SUPABASE_RUNTIME_ROLES).toEqual(['anon', 'authenticated', 'service_role']);
  });

  it('documents gotrue mode as app_metadata-based and additive', () => {
    const docs = readFileSync('docs/claims-mapping.md', 'utf8');
    const compatibilityDocs = readFileSync('docs/supabase-compatibility.md', 'utf8');
    const architectureDocs = readFileSync('docs/architecture.md', 'utf8');
    const enterpriseBoundaryDocs = readFileSync('docs/enterprise-iam-supabase-boundary.md', 'utf8');

    expect(docs).toContain('SupaOAuth does not add top-level JWT claims');
    expect(docs).toContain('OAuth 2.1 access tokens additionally carry `user_id` and `client_id`');
    expect(docs).toContain('OAuth response `scope` is response metadata, not an enterprise permission claim');
    expect(docs).toContain('OAuth scopes, organizations, and permissions map to JWT metadata, Management API lookups, and Supabase RLS policies');
    expect(docs).toContain('app_metadata.supaoauth');
    expect(docs).toContain('permissions_truncated');
    expect(docs).toContain('supaoauth.has_permission');
    expect(docs).toContain('anon`, `authenticated`, or `service_role`');
    expect(docs).toContain('additional claims such as `amr`, `app_metadata`, and `user_metadata`');
    expect(docs).toContain('The default external OIDC recommendation is still `app_metadata.supaoauth`');
    expect(compatibilityDocs).toContain('`anon` / `authenticated` / `service_role` runtime role switch');
    expect(compatibilityDocs).toContain('OAuth 2.1 access tokens must also preserve `user_id` and `client_id`');
    expect(compatibilityDocs).toContain('OAuth response `scope` must remain the granted standard scope string');
    expect(compatibilityDocs).toContain('do not confuse this with the OAuth token response `scope`');
    expect(architectureDocs).toContain('JWT claims required by Supabase Auth Hooks, RLS, and Supabase clients');
    expect(architectureDocs).toContain('Supabase metadata claims preserved when present');
    expect(architectureDocs).toContain('`session_id`');
    expect(architectureDocs).toContain('`is_anonymous`');
    expect(architectureDocs).toContain('OAuth response `scope` is consent/UserInfo metadata, not a database permission source');
    expect(enterpriseBoundaryDocs).toContain('standard OAuth scopes for UserInfo/ID-token metadata');
    expect(enterpriseBoundaryDocs).toContain('scope-as-database-permission model');
    expect(docs).not.toContain('SupaOAuth adds claims under the `supaoauth` namespace');
  });

  it('documents the default product boundary as GoTrue-backed, not a replacement issuer', () => {
    const readme = readFileSync('README.md', 'utf8');
    const consentFlow = readFileSync('docs/consent-flow.md', 'utf8');
    const authServer = readFileSync('packages/auth-server/src/index.ts', 'utf8');
    const compatibilityDocs = readFileSync('docs/supabase-compatibility.md', 'utf8');
    const enterpriseBoundaryDocs = readFileSync('docs/enterprise-iam-supabase-boundary.md', 'utf8');
    const xiguConfigDocs = readFileSync('docs/xigu-shujian-config.md', 'utf8');
    const adminI18n = readFileSync('packages/admin-console/src/lib/i18n.js', 'utf8');
    const hostedAuthorizeHtml = readFileSync('packages/admin-console/static/authorize.html', 'utf8');
    const generatedHostedPages = readFileSync('packages/auth-server/src/generated/hosted-pages.ts', 'utf8');

    expect(readme).toContain('it enhances Supabase Auth instead of replacing it');
    expect(readme).toContain('它增强 Supabase Auth，而不是替换 Supabase Auth');
    expect(readme).toContain('stock upstream GoTrue/Supabase Auth runtime');
    expect(readme).toContain('不能要求 SupaOAuth patched GoTrue');
    expect(readme).toContain('GoTrue keeps the OAuth/OIDC protocol runtime');
    expect(readme).toContain('RLS and Supabase Auth hooks');
    expect(readme).not.toContain('SupaOAuth is a SupaCloud-hosted Identity Provider (IdP) surface');
    expect(readme).not.toContain('SupaOAuth 是一个独立身份提供方');
    expect(adminI18n).toContain("'layout.subtitle': 'User Center'");
    expect(adminI18n).toContain("'layout.subtitle': '用户中心'");
    expect(hostedAuthorizeHtml).toContain('SupaOAuth User Center');
    expect(hostedAuthorizeHtml).toContain('SupaOAuth 用户中心');
    expect(hostedAuthorizeHtml).not.toContain('Identity Provider');
    expect(hostedAuthorizeHtml).not.toContain('身份提供方');
    expect(generatedHostedPages).not.toContain('Identity Provider');
    expect(generatedHostedPages).not.toContain('身份提供方');
    expect(compatibilityDocs).toContain('SupaOAuth must work with the stock upstream GoTrue/Supabase Auth runtime and official Supabase SDKs');
    expect(compatibilityDocs).toContain('must not require a SupaOAuth-patched GoTrue binary');
    expect(compatibilityDocs).toContain('must not shadow it with a private protocol implementation');
    expect(compatibilityDocs).toContain('forked `supabase-js`');
    expect(enterpriseBoundaryDocs).toContain('stock upstream GoTrue/Supabase Auth versions provided by SupaCloud');
    expect(enterpriseBoundaryDocs).toContain('not a product-local fork of GoTrue');
    expect(xiguConfigDocs).toContain('“西谷智灯枢鉴系统”应作为西谷生产租户的部署配置和品牌呈现');
    expect(xiguConfigDocs).toContain('不把“西谷智灯枢鉴系统”写入默认源码');
    expect(consentFlow).toContain('SupaOAuth 不作为独立 token issuer');
    expect(consentFlow).toContain('GoTrue /token 交换 code');
    expect(consentFlow).toContain('token 仍应是可用于 RLS 的 Supabase JWT');
    expect(consentFlow).not.toContain('SupaOAuth 作为 IdP');
    expect(authServer).toContain('GoTrue remains the OAuth/OIDC runtime and token issuer');
    expect(authServer).not.toContain('Identity Provider (IdP) surface');
    const externalOidcDocs = readFileSync('docs/external-oidc-mode.md', 'utf8');
    expect(externalOidcDocs).toContain('prefer `app_metadata.supaoauth`');
    expect(externalOidcDocs).not.toContain('RLS policies access supaoauth: claims');
  });

  it('runs live Supabase Auth release gates in strict mode', () => {
    const releaseGate = readFileSync('scripts/release-gate.ts', 'utf8');
    const strictEnvCount = (releaseGate.match(/REQUIRE_SUPABASE_AUTH_COMPAT:\s*'1'/g) || []).length;

    expect(releaseGate).toContain("RUN_SUPABASE_RUNTIME_COMPAT: '1'");
    expect(releaseGate).toContain("RUN_SUPABASE_OAUTH21_COMPAT: '1'");
    expect(strictEnvCount).toBeGreaterThanOrEqual(2);
  });
});
