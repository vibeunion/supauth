import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { adminConsoleSpaCandidates, hostedPageRoutes, resolveHostedPagePaths } from '../routes/hosted-pages.js';

function request(url: string, init?: RequestInit) {
  const app = new Elysia().use(hostedPageRoutes);
  return app.handle(new Request(url, { ...init }));
}

describe('hostedPageRoutes', () => {
  test('resolveHostedPagePaths covers src and dist execution layouts', () => {
    const fromSrc = resolveHostedPagePaths('/opt/supauth/packages/auth-server/src/routes', '/opt/supauth/packages/auth-server');
    expect(fromSrc.authorizeHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/authorize.html');
    expect(fromSrc.changePasswordHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/change-password.html');
    expect(fromSrc.accountHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/account.html');
    expect(fromSrc.customUiDirs).toContain('/opt/supauth/packages/auth-server/custom-ui');

    const fromDist = resolveHostedPagePaths('/opt/supauth/packages/auth-server/dist', '/opt/supauth');
    expect(fromDist.authorizeHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/authorize.html');
    expect(fromDist.changePasswordHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/change-password.html');
    expect(fromDist.accountHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/account.html');
    expect(fromDist.customUiDirs).toContain('/opt/supauth/packages/auth-server/custom-ui');
  });

  test('Admin Console SPA routes fall back to index.html for client routes', () => {
    expect(adminConsoleSpaCandidates(['/opt/supauth/packages/admin-console/build'], 'security')).toEqual([
      '/opt/supauth/packages/admin-console/build/security',
      '/opt/supauth/packages/admin-console/build/security.html',
      '/opt/supauth/packages/admin-console/build/security/index.html',
      '/opt/supauth/packages/admin-console/build/index.html',
    ]);
  });

  test('Admin Console SPA asset routes do not fall back to index.html', () => {
    expect(adminConsoleSpaCandidates(['/opt/supauth/packages/admin-console/build'], '_app/immutable/missing.js')).toEqual([
      '/opt/supauth/packages/admin-console/build/_app/immutable/missing.js',
      '/opt/supauth/packages/admin-console/build/_app/immutable/missing.js.html',
      '/opt/supauth/packages/admin-console/build/_app/immutable/missing.js/index.html',
    ]);
  });

  test('GET /oauth/authorize serves hosted authorize html', async () => {
    const response = await request('http://localhost/oauth/authorize?authorization_id=test-authz');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /login.html serves the same authorize page', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /login serves the same authorize page', async () => {
    const response = await request('http://localhost/login');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /authorize.html serves the same authorize page', async () => {
    const response = await request('http://localhost/authorize.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('hosted login page supports config-driven intro text', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('<p id="intro" class="intro" style="display:none"></p>');
    expect(body).toContain('class="split-layout"');
    expect(body).toContain('class="brand-panel"');
    expect(body).toContain('class="auth-panel"');
    expect(body).toContain("grid.className = 'feature-grid';");
    expect(body).toContain("card.className = 'feature-card';");
    expect(body).toContain('branding.description && branding.description.trim()');
    expect(body).toContain('intro.textContent = branding.description.trim();');
    expect(body).toContain("intro.style.display = 'block';");
    expect(body).toContain('branding.background_url');
    expect(body).toContain('document.body.style.backgroundImage');
    expect(body).toContain('branding.button_label');
    expect(body).toContain('branding.custom_css');
    expect(body).toContain('id="custom-style"');
    expect(body).toContain('id="brand-illustration"');
    expect(body).toContain('id="custom-content"');
    expect(body).toContain('branding.content');
    expect(body).toContain('const illustrationThemes = {');
    expect(body).toContain('function renderBrandIllustration(content)');
    expect(body).toContain('function renderBrandingContent(content)');
    expect(body).toContain('function renderFeatureCards(container, items)');
    expect(body).toContain('renderBrandingContent(branding.content);');
    expect(body).not.toContain('function sanitizeLegacyHtml');
    expect(body).not.toContain('JSON.parse(raw)');
    expect(body).not.toContain("document.getElementById('custom-content').innerHTML = branding.content");

    const brandingRenderIndex = body.indexOf('renderBrandingContent(branding.content);');
    const authorizationErrorIndex = body.indexOf('if (experience.authorization_error) {');
    expect(brandingRenderIndex).toBeGreaterThan(-1);
    expect(authorizationErrorIndex).toBeGreaterThan(brandingRenderIndex);
  });

  test('GET /claim serves the account claim page with same-origin public API base', async () => {
    const response = await request('https://auth.example.com/claim');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Account Claim</title>');
    expect(body).toContain('<h1 id="claim-title">领取 SupAuth 账号</h1>');
    expect(body).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = "/v1/public";');
    expect(body).toContain('fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: \'include\' })');
    expect(body).toContain('fetch(`${apiBase}/account-claims/config`, { credentials: \'include\' })');
    expect(body).toContain('fetch(`${apiBase}/phrases/${encodeURIComponent(locale)}`)');
    expect(body).toContain('const LOCALE_STORAGE_KEY = \'supaoauth.locale\';');
    expect(body).toContain('mergePhraseOverrides(claimConfig.phrases);');
    expect(body).toContain("password: { mode: 'show_initial_password', min_length: 8 }");
    expect(body).toContain("password.mode === 'set_on_claim'");
    expect(body).toContain('领取账号并设置密码');
    expect(body).toContain('payload.new_password = newPassword;');
    expect(body).toContain('title.textContent = branding.page_title;');
    expect(body).toContain('/account-claims/claim');
    expect(body).toContain('data.password_set');
    expect(body).toContain('function claimErrorMessage(response)');
    expect(body).toContain("if (response.status >= 500) return t('serverError');");
    expect(body).not.toContain('http://auth.example.com/v1/public');
    expect(body).not.toContain('Example User Center');
  });

  test('GET /account/password serves hosted password change page with same-origin public API base', async () => {
    const response = await request('https://auth.example.com/account/password');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Change Password</title>');
    expect(body).toContain('<h1 id="page-title">修改密码</h1>');
    expect(body).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = "/v1/public";');
    expect(body).toContain('/account-password/change');
    expect(body).toContain('fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: \'include\' })');
    expect(body).not.toContain('http://auth.example.com/v1/public');
    expect(body).not.toContain('Example User Center');
  });

  test('GET /account serves hosted account center page with same-origin public API base', async () => {
    for (const path of ['/account', '/account.html']) {
      const response = await request(`https://auth.example.com${path}`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('<title>SupaOAuth Account Center</title>');
      expect(body).toContain('<h1 id="account-title">账户中心</h1>');
      expect(body).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = "/v1/public";');
      expect(body).toContain('fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: \'include\' })');
      expect(body).toContain('fetch(`${apiBase}/account/config`, { credentials: \'include\' })');
      expect(body).toContain('fetch(`${apiBase}${path}`, {');
      expect(body).toContain("accountFetch('/account/me')");
      expect(body).toContain("accountFetch('/account/profile'");
      expect(body).toContain("load('sessions', '/account/sessions')");
      expect(body).toContain("load('grants', '/account/grants')");
      expect(body).toContain("load('identities', '/account/identities')");
      expect(body).toContain("load('mfa', '/account/mfa')");
      expect(body).toContain('id="start-totp-enroll"');
      expect(body).toContain('id="totp-qr"');
      expect(body).toContain('id="totp-verify-form"');
      expect(body).toContain("accountFetch('/account/mfa/totp/enroll'");
      expect(body).toContain("`/account/mfa/${encodeURIComponent(pendingTotpFactorId)}/verify`");
      expect(body).toContain("button.dataset.action === 'unenroll-mfa'");
      expect(body).toContain("accountFetch(`/account/mfa/${encodeURIComponent(id)}`, { method: 'DELETE' })");
      expect(body).toContain("load('passkeys', '/account/passkeys')");
      expect(body).toContain("accountFetch('/account/email'");
      expect(body).toContain("accountFetch('/account/phone'");
      expect(body).toContain("accountFetch('/account',");
      expect(body).toContain("button.dataset.action === 'revoke-session'");
      expect(body).toContain("button.dataset.action === 'revoke-grant'");
      expect(body).toContain("button.dataset.action === 'unlink-identity'");
      expect(body).toContain("button.dataset.action === 'revoke-passkey'");
      expect(body).toContain('class="account-actions"');
      expect(body).toContain('id="manual-token-panel"');
      expect(body).toContain('登录 / 重新登录');
      expect(body).toContain('未检测到登录状态。请先登录，登录完成后会自动回到账户中心。');
      expect(body).toContain('function showSignedOutState()');
      expect(body).toContain('function resetAccountView()');
      expect(body).toContain('class="account-section-card active"');
      expect(body).toContain('document.querySelector(\'.account-section-grid\').hidden = true;');
      expect(body).toContain('href="/account/password" data-section="security"');
      expect(body).toContain('href="#account-panel" data-section="profile"');
      expect(body).toContain('data-section="profile"');
      expect(body).toContain('data-section="sessions"');
      expect(body).toContain('data-section="grants"');
      expect(body).toContain('data-section="identities"');
      expect(body).toContain('data-section="mfa"');
      expect(body).toContain('data-section="contact"');
      expect(body).toContain('data-section="delete-account"');
      expect(body).not.toContain('class="card active"');
      expect(body).not.toContain('/v1/my-account');
      expect(body).not.toContain('http://auth.example.com/v1/public');
      expect(body).not.toContain('Example User Center');
    }
  });

  test('hosted login page normalizes credentials and maps GoTrue login errors', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('<form id="login-form" novalidate>');
    expect(body).toContain('function normalizeEmailInput(value)');
    expect(body).toContain("invalidLoginCredentials: 'Account or password does not match. Please check and try again.'");
    expect(body).toContain("invalidLoginCredentials: '账号或密码不匹配，请检查后重试。'");
    expect(body).toContain("value.includes('invalid login credentials')");
    expect(body).toContain("value.includes('invalid_credentials')");
    expect(body).toContain("setMessage('error', loginResponseMessage(data))");
    expect(body).toContain('const email = normalizeEmailInput(emailInput.value);');
    expect(body).toContain("setMessage('error', t('emailInvalid'))");
    expect(body).toContain("setMessage('error', t('passwordRequired'))");
    expect(body).toContain("setMessage('error', error && error.message ? error.message : t('networkError'))");
    expect(body).toContain('function completeStandaloneLogin(accessToken)');
    expect(body).toContain("sessionStorage.setItem('supaoauth.account.access_token', accessToken)");
    expect(body).toContain('window.location.href = `/account#access_token=${encodeURIComponent(accessToken)}`;');
    expect(body).toContain('function isAuthorizationNotFoundError(error)');
    expect(body).toContain("error.code === 'authorization_not_found'");
    expect(body).toContain('await completeStandaloneLogin(data.access_token);');
    expect(body).toContain('function safeRedirectUrl(value, allowExternal = false)');
    expect(body).toContain("url.protocol !== 'http:' && url.protocol !== 'https:'");
    expect(body).toContain("if (!allowExternal && url.origin !== window.location.origin) return '';");
    expect(body).toContain('return allowExternal ? url.toString() : `${url.pathname}${url.search}${url.hash}`;');
    expect(body).toContain('const redirectUrl = approvedRedirectUrl');
    expect(body).toContain('? safeRedirectUrl(approvedRedirectUrl, true)');
    expect(body).toContain(': safeRedirectUrl(authorizationRedirectUrl);');
    expect(body).toContain('? `${publicApiBase()}/sign-in-experience/resolve?authorization_id=${encodeURIComponent(authorizationId)}`');
    expect(body).toContain(': `${publicApiBase()}/sign-in-experience/resolve`;');
    expect(body).not.toContain('if (!authorizationId) return;');
  });

  test('hosted login page places social sign-in below the credential panels', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    const credentialPanelIndex = body.indexOf('<div id="panel-signin" class="tab-panel active">');
    const forgotPanelIndex = body.indexOf('<div id="panel-forgot" class="tab-panel">');
    const socialDividerIndex = body.indexOf('<div id="social-divider" class="divider" style="display:none">');
    const socialSectionIndex = body.indexOf('<div id="social-section" class="social-buttons" style="display:none">');
    const footerIndex = body.indexOf('<div id="footer" class="footer">');

    expect(credentialPanelIndex).toBeGreaterThan(-1);
    expect(forgotPanelIndex).toBeGreaterThan(credentialPanelIndex);
    expect(socialDividerIndex).toBeGreaterThan(forgotPanelIndex);
    expect(socialSectionIndex).toBeGreaterThan(socialDividerIndex);
    expect(footerIndex).toBeGreaterThan(socialSectionIndex);
  });

  test('hosted login page blocks expired OAuth authorization requests', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('let authorizationAvailable = !authorizationId;');
    expect(body).toContain("authorizationExpired: 'This sign-in request has expired. Please return to the application and sign in again.'");
    expect(body).toContain("authorizationExpired: '本次登录请求已过期，请返回应用重新发起登录。'");
    expect(body).toContain("authorizationUnavailable: '暂时无法校验本次登录请求，请返回应用重新发起登录。'");
    expect(body).toContain('function disableExpiredAuthorization()');
    expect(body).toContain('function disableUnavailableAuthorization()');
    expect(body).toContain('if (!authorizationAvailable) throw new Error(t(\'authorizationExpired\'));');
    expect(body).toContain('authorizationAvailable = !!experience.authorization;');
    expect(body).toContain('if (experience.authorization_error) {');
    expect(body).toContain("setMessage('error', t('authorizationExpired'))");
  });

  test('GET / serves the same authorize page', async () => {
    const response = await request('http://localhost/');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /favicon.ico and /favicon.svg serve the hosted favicon', async () => {
    for (const path of ['/favicon.ico', '/favicon.svg']) {
      const response = await request(`http://localhost${path}`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/svg+xml');
      expect(body).toContain('<svg');
    }
  });
});
