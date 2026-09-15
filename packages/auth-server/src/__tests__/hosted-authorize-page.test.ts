import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfig } from '../config/index.js';
import { renderHostedPage } from '../../../admin-console/src/hosted/build.js';
import {
  adminConsoleRedirectLocation,
  adminConsoleSpaCandidates,
  createHostedPageRoutes,
  readFirstAvailableText,
  resolveHostedPagePaths,
  serveAdminConsolePage,
} from '../routes/hosted-pages.js';

const hostedPageRoutes = createHostedPageRoutes({
  authorize: await renderHostedPage('authorize'),
  claim: await renderHostedPage('claim'),
  account: await renderHostedPage('account'),
  changePassword: await renderHostedPage('change-password'),
  logout: await renderHostedPage('logout'),
});

function expectHosted(body: string) {
  // 断言浏览器实际产物，忽略打包器的引号、空白和声明关键字格式。
  const normalize = (value: string) => value.replaceAll('"', "'")
    .replace(/\b(?:const|let)\s/g, 'var ').replace(/\s+/g, ' ').trim();
  return {
    toContain: (expected: string) => expect(normalize(body).includes(normalize(expected)), expected).toBe(true),
    not: { toContain: (expected: string) => expect(normalize(body).includes(normalize(expected)), expected).toBe(false) },
  };
}

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
    expect(fromSrc.logoutHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/logout.html');

    const fromDist = resolveHostedPagePaths('/opt/supauth/packages/auth-server/dist', '/opt/supauth');
    expect(fromDist.authorizeHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/authorize.html');
    expect(fromDist.changePasswordHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/change-password.html');
    expect(fromDist.accountHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/account.html');
    expect(fromDist.logoutHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/logout.html');

    const fromActiveVersion = resolveHostedPagePaths(
      '/opt/supacloud/functions/supauth/.versions/version-123',
      '/opt/supacloud/functions/supauth',
    );
    expect(fromActiveVersion.adminConsoleBuildDirs).toContain(
      '/opt/supacloud/functions/supauth/.versions/version-123/src/admin-console/build',
    );

    const fromProjectBundle = resolveHostedPagePaths(
      '/opt/supacloud/functions/project-ref',
      '/',
    );
    expect(fromProjectBundle.adminConsoleBuildDirs).toContain(
      '/opt/supacloud/functions/project-ref/.src-supauth/admin-console/build',
    );

    const fromVersionSource = resolveHostedPagePaths(
      '/opt/supacloud/functions/project-ref/.versions/supauth/6/src',
      '/',
    );
    expect(fromVersionSource.adminConsoleBuildDirs).toContain(
      '/opt/supacloud/functions/project-ref/.versions/supauth/6/src/admin-console/build',
    );
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

  test('Admin Console rejects traversal and absolute paths without breaking SPA fallbacks', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'supauth-admin-confinement-'));
    const buildDir = join(workspaceDir, 'build');
    const escapedFile = join(workspaceDir, 'package.json');
    let repeatedlyEncodedTraversal = '../package.json';
    for (let pass = 0; pass < 5; pass += 1) {
      repeatedlyEncodedTraversal = encodeURIComponent(repeatedlyEncodedTraversal);
    }
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, 'index.html'), '<main>Confined Admin</main>');
    writeFileSync(escapedFile, '{"secret":"outside-build"}');

    try {
      for (const sub of [
        '../package.json',
        escapedFile,
        '%2e%2e%2fpackage.json',
        '%252e%252e%252fpackage.json',
        repeatedlyEncodedTraversal,
        '%zz',
      ]) {
        const candidates = adminConsoleSpaCandidates([buildDir], sub);
        expect(candidates).toEqual([]);
        const response = serveAdminConsolePage([buildDir], sub);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('outside-build');
      }
      expect(serveAdminConsolePage([buildDir], 'settings').status).toBe(200);
      expect(serveAdminConsolePage([buildDir], '_app/%2e%2e/%2e%2e/package.json').status).toBe(404);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  test('hosted page probes only continue after a confined optional path', async () => {
    const buildDir = mkdtempSync(join(tmpdir(), 'supauth-hosted-probe-'));
    const availablePath = join(buildDir, 'authorize.html');
    const deniedPath = '/opt/supacloud/admin-console/static/authorize.html';
    const failedPath = '/opt/supacloud/admin-console/static/failed.html';
    const originalBunFile = Bun.file;
    writeFileSync(availablePath, '<main>Embedded fallback</main>');
    Bun.file = strictBunFile(originalBunFile, (path) => {
      if (path === deniedPath) {
        throw new Error(`Access denied: path "${deniedPath}" is outside the project directory`);
      }
      if (path === failedPath) throw new Error('hosted page read failed');
    });

    try {
      await expect(readFirstAvailableText([deniedPath, availablePath])).resolves
        .toBe('<main>Embedded fallback</main>');
      await expect(readFirstAvailableText([deniedPath])).resolves.toBeNull();
      await expect(readFirstAvailableText([failedPath])).rejects.toThrow('hosted page read failed');
    } finally {
      Bun.file = originalBunFile;
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  test('static probes skip only confined candidates before serving an available asset', async () => {
    const buildDir = mkdtempSync(join(tmpdir(), 'supauth-static-probe-'));
    const deniedDir = '/opt/supacloud/admin-console/restricted';
    const failedDir = '/opt/supacloud/admin-console/failed';
    const assetPath = join(buildDir, '_app', 'app.js');
    const originalBunFile = Bun.file;
    mkdirSync(join(buildDir, '_app'), { recursive: true });
    writeFileSync(assetPath, 'export const ready = true;');
    Bun.file = strictBunFile(originalBunFile, (path) => {
      const candidate = String(path);
      if (candidate.startsWith(deniedDir)) {
        throw new Error(`Access denied: path "${candidate}" is outside the project directory`);
      }
      if (candidate.startsWith(failedDir)) throw new Error('static asset read failed');
    });

    try {
      const response = serveAdminConsolePage([deniedDir, buildDir], '_app/app.js');
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('ready = true');
      expect(() => serveAdminConsolePage([failedDir, buildDir], '_app/app.js'))
        .toThrow('static asset read failed');
    } finally {
      Bun.file = originalBunFile;
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  test('versioned Function Admin assets preserve deep-link fallback and exact static paths', () => {
    const versionedBuild = '/opt/supacloud/functions/supauth/.versions/version-123/src/admin-console/build';

    expect(adminConsoleSpaCandidates([versionedBuild], 'security/password')).toEqual([
      `${versionedBuild}/security/password`,
      `${versionedBuild}/security/password.html`,
      `${versionedBuild}/security/password/index.html`,
      `${versionedBuild}/index.html`,
    ]);
    expect(adminConsoleSpaCandidates([versionedBuild], '_app/immutable/admin.js')).toEqual([
      `${versionedBuild}/_app/immutable/admin.js`,
      `${versionedBuild}/_app/immutable/admin.js.html`,
      `${versionedBuild}/_app/immutable/admin.js/index.html`,
    ]);
  });

  test('Admin Console serves SPA fallbacks and exact static assets from a Function source tree', async () => {
    const buildDir = mkdtempSync(join(tmpdir(), 'supauth-admin-build-'));
    mkdirSync(join(buildDir, '_app'), { recursive: true });
    writeFileSync(join(buildDir, 'index.html'), '<main>Admin Console</main>');
    writeFileSync(join(buildDir, '_app', 'app.js'), 'export const ready = true;');
    writeFileSync(join(buildDir, '_app', 'version.json'), '{"version":"test"}');

    try {
      const page = serveAdminConsolePage([buildDir], 'security/password');
      const script = serveAdminConsolePage([buildDir], '_app/app.js');
      const asset = serveAdminConsolePage([buildDir], '_app/version.json');

      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('Admin Console');
      expect(script.status).toBe(200);
      expect(script.headers.get('content-type')).toContain('text/javascript');
      expect(script.headers.get('x-content-type-options')).toBe('nosniff');
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('application/json');
      expect(await asset.json()).toEqual({ version: 'test' });
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  test('Admin Console legacy and detail entry paths resolve to canonical 307 locations', async () => {
    expect(adminConsoleRedirectLocation(new URL('https://auth.example.com/admin/resources?tab=scopes')))
      .toBe('/admin/api-resources?tab=scopes');
    expect(adminConsoleRedirectLocation(new URL('https://auth.example.com/admin/users/user-1?from=audit')))
      .toBe('/admin/users/user-1/settings?from=audit');
    expect(adminConsoleRedirectLocation(new URL('https://auth.example.com/admin/users/user-1/settings')))
      .toBeNull();

    const legacyResponse = await request('https://auth.example.com/admin/sign-in-experience?locale=zh-CN');
    expect(legacyResponse.status).toBe(307);
    expect(legacyResponse.headers.get('location'))
      .toBe('/admin/sign-in-experience/branding?locale=zh-CN');

    const detailResponse = await request('https://auth.example.com/admin/roles/role-1');
    expect(detailResponse.status).toBe(307);
    expect(detailResponse.headers.get('location')).toBe('/admin/roles/role-1/general');
  });

  test('GET /oauth/authorize serves hosted authorize html', async () => {
    const response = await request('http://localhost/oauth/authorize?authorization_id=test-authz');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectHosted(body).toContain('<title>SupaOAuth Sign In</title>');
    expectHosted(body).toContain('[hidden] { display: none !important; }');
  });

  test('GET /login.html serves the same authorize page', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectHosted(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /login serves the same authorize page', async () => {
    const response = await request('http://localhost/login');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectHosted(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /authorize.html serves the same authorize page', async () => {
    const response = await request('http://localhost/authorize.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectHosted(body).toContain('<title>SupaOAuth Sign In</title>');
    expectHosted(body).toContain("params.get('prompt')");
    expectHosted(body).toContain("hostedAuth.signOut({ scope: 'local' })");
  });

  test('GET /hosted-auth.js serves the embedded session client without stale caching', async () => {
    const response = await request('https://auth.example.com/hosted-auth.js');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/javascript');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expectHosted(body).toContain('supaoauth.hosted.auth.session');
    expectHosted(body).toContain('/auth/v1');
  });

  test('GET /logout serves a no-store same-origin hosted logout page', async () => {
    const requestUrl = 'https://auth.example.com/logout';
    const response = await request(requestUrl);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expectHosted(body).toContain("hostedAuth.signOut({ scope: 'local' })");
    expectHosted(body).toContain(new URL(
      '/login?logged_out=1',
      getConfig().publicBaseUrl || requestUrl,
    ).toString());
  });

  test('hosted login page supports config-driven intro text', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expectHosted(body).toContain('<p id="intro" class="intro" style="display:none"></p>');
    expectHosted(body).toContain('class="split-layout"');
    expectHosted(body).toContain('class="brand-panel"');
    expectHosted(body).toContain('class="auth-panel"');
    expectHosted(body).toContain("grid.className = 'feature-grid';");
    expectHosted(body).toContain("card.className = 'feature-card';");
    expectHosted(body).toContain('#custom-content > .feature-grid {');
    expectHosted(body).toContain('grid-column: 1 / -1;');
    expectHosted(body).toContain('branding.description && branding.description.trim()');
    expectHosted(body).toContain('intro.textContent = branding.description.trim();');
    expectHosted(body).toContain("intro.style.display = 'block';");
    expectHosted(body).toContain('branding.background_url');
    expectHosted(body).toContain('document.body.style.backgroundImage');
    expectHosted(body).toContain('branding.button_label');
    expectHosted(body).toContain('branding.custom_css');
    expectHosted(body).toContain('id="custom-style"');
    expectHosted(body).toContain('id="brand-illustration"');
    expectHosted(body).toContain('id="custom-content"');
    expectHosted(body).toContain('branding.content');
    expectHosted(body).toContain('const illustrationThemes = {');
    expectHosted(body).toContain('function renderBrandIllustration(content)');
    expectHosted(body).toContain('function renderBrandingContent(content)');
    expectHosted(body).toContain('function renderFeatureCards(container, items)');
    expectHosted(body).toContain('renderBrandingContent(branding.content);');
    expectHosted(body).not.toContain('function sanitizeLegacyHtml');
    expectHosted(body).not.toContain('JSON.parse(raw)');
    expectHosted(body).not.toContain("document.getElementById('custom-content').innerHTML = branding.content");

    expectHosted(body).not.toContain('experience.authorization_error');
    expectHosted(body).not.toContain('experience.authorization');
  });

  test('GET /claim serves the account claim page with same-origin public API base', async () => {
    const response = await request('https://auth.example.com/claim');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectHosted(body).toContain('<title>SupaOAuth Account Claim</title>');
    expectHosted(body).toContain('<h1 id="claim-title">领取 SupAuth 账号</h1>');
    expectHosted(body).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = "/v1/public";');
    expectHosted(body).toContain('fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: \'include\' })');
    expectHosted(body).toContain('fetch(`${apiBase}/account-claims/config`, { credentials: \'include\' })');
    expectHosted(body).toContain('fetch(`${apiBase}/phrases/${encodeURIComponent(locale)}`)');
    expectHosted(body).toContain('const LOCALE_STORAGE_KEY = \'supaoauth.locale\';');
    expectHosted(body).toContain('mergePhraseOverrides(claimConfig.phrases);');
    expectHosted(body).toContain("require_uppercase: false");
    expectHosted(body).toContain("password.mode === 'set_on_claim'");
    expectHosted(body).toContain("password.require_uppercase === true");
    expectHosted(body).toContain("password.require_lowercase === true");
    expectHosted(body).toContain("password.require_numbers === true");
    expectHosted(body).toContain("password.require_symbols === true");
    expectHosted(body).toContain('passwordPolicyHint.textContent');
    expectHosted(body).toContain('#password-fields {\n      margin-top: 16px;\n    }');
    expectHosted(body).toContain('.password-hint {\n      margin: 8px 0 0;');
    expectHosted(body).not.toContain('.password-hint {\n      margin: -8px 0 16px;');
    expectHosted(body).toContain('type="submit" disabled');
    expectHosted(body).not.toContain('id="claim-proof" name="claim_proof"');
    expectHosted(body).toContain('enabled: next.enabled === true');
    expectHosted(body).toContain("setMessage('error', t('claimUnavailable'))");
    expectHosted(body).toContain("return 'passwordRequiresUppercase'");
    expectHosted(body).toContain("return 'passwordRequiresSymbol'");
    expectHosted(body).toContain("code === 'password_requires_uppercase'");
    expectHosted(body).toContain("'weak_password'].includes(code)");
    expectHosted(body).toContain('领取账号并设置密码');
    expectHosted(body).not.toContain('claim_proof: claimProof');
    expectHosted(body).not.toContain('name-label');
    expectHosted(body).not.toContain('claim-proof-label');
    expectHosted(body).toContain('...mustSetPassword ? { new_password: newPassword } : {}');
    expectHosted(body).toContain('title.textContent = branding.page_title;');
    expectHosted(body).toContain('/account-claims/claim');
    expectHosted(body).toContain('data.password_set');
    expectHosted(body).toContain('function claimErrorMessage(response, data = {})');
    expectHosted(body).toContain("return t('claimRejected')");
    expectHosted(body).not.toContain("code === 'account_already_claimed'");
    expectHosted(body).toContain("if (response.status >= 500) return t('serverError');");
    expectHosted(body).not.toContain('http://auth.example.com/v1/public');
    expectHosted(body).not.toContain('Example User Center');
  });

  test('GET /account/password serves hosted password change page with same-origin public API base', async () => {
    const response = await request('https://auth.example.com/account/password');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectHosted(body).toContain('<title>SupaOAuth Change Password</title>');
    expectHosted(body).toContain('<h1 id="page-title">修改密码</h1>');
    expectHosted(body).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = "/v1/public";');
    expectHosted(body).toContain('/account-password/change');
    expectHosted(body).toContain('fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: \'include\' })');
    expectHosted(body).not.toContain('http://auth.example.com/v1/public');
    expectHosted(body).not.toContain('Example User Center');
  });

  test('GET /account serves hosted account center page with same-origin public API base', async () => {
    for (const path of ['/account', '/account.html']) {
      const response = await request(`https://auth.example.com${path}`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expectHosted(body).toContain('<title>SupaOAuth 账户中心</title>');
      expectHosted(body).toContain('<h1 id="account-title">账户中心</h1>');
      expectHosted(body).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = "/v1/public";');
      expectHosted(body).toContain('<script src="/hosted-auth.js"></script>');
      expectHosted(body).toContain('fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: \'include\' })');
      expectHosted(body).toContain('fetch(`${apiBase}/account/config`, { credentials: \'include\' })');
      expectHosted(body).toContain(`hostedAuth.authenticatedFetch(\`\${apiBase}\${path}\`, {`);
      expectHosted(body).toContain("accountFetch('/account/me', accountResponses.user)");
      expectHosted(body).toContain("accountFetch('/account/profile'");
      expectHosted(body).not.toContain("load('sessions', '/account/sessions')");
      expectHosted(body).toContain("path: '/account/grants'");
      expectHosted(body).toContain("path: '/account/identities'");
      expectHosted(body).toContain("path: '/account/mfa'");
      expectHosted(body).toContain('id="start-totp-enroll"');
      expectHosted(body).toContain('id="totp-qr"');
      expectHosted(body).toContain('id="totp-verify-form"');
      expectHosted(body).toContain("accountFetch('/account/mfa/totp/enroll'");
      expectHosted(body).toContain("`/account/mfa/${encodeURIComponent(pendingTotpFactorId)}/verify`");
      expectHosted(body).toContain('await hostedAuth.setSession({');
      expectHosted(body).toContain("action: 'unenroll-mfa'");
      expectHosted(body).toContain('removeAccountModuleItem(moduleDefinition, id)');
      expectHosted(body).not.toContain('/account/passkeys');
      expectHosted(body).toContain("accountFetch('/account/email'");
      expectHosted(body).toContain("accountFetch('/account/phone'");
      expectHosted(body).toContain("accountFetch('/account',");
      expectHosted(body).not.toContain("button.dataset.action === 'revoke-session'");
      expectHosted(body).toContain("action: 'revoke-grant'");
      expectHosted(body).toContain("action: 'unlink-identity'");
      expectHosted(body).not.toContain("button.dataset.action === 'revoke-passkey'");
      expectHosted(body).toContain('class="account-actions"');
      expectHosted(body).toContain('登录 / 重新登录');
      expectHosted(body).toContain('id="sign-out"');
      expectHosted(body).toContain('退出当前设备');
      expectHosted(body).toContain('data-logout-scope="others"');
      expectHosted(body).toContain('data-logout-scope="global"');
      expectHosted(body).not.toContain('/account/logout?scope=');
      expectHosted(body).toContain('hostedAuth.getSession()');
      expectHosted(body).toContain("event === 'TOKEN_REFRESHED'");
      expectHosted(body).toContain("event === 'SIGNED_OUT'");
      expectHosted(body).toContain('hostedAuth.signOut({ scope })');
      expectHosted(body).toContain('未检测到登录状态。请先登录，登录完成后会自动回到账户中心。');
      expectHosted(body).toContain('function showSignedOutState()');
      expectHosted(body).toContain('function resetAccountView()');
      expectHosted(body).toContain('class="account-section-card active"');
      expectHosted(body).toContain('<section class="account-section-grid" aria-label="账户中心功能区" hidden>');
      expectHosted(body).toContain('<img id="totp-qr" class="mfa-qr" alt="Authenticator 二维码" hidden>');
      expectHosted(body).not.toContain('Account center sections');
      expectHosted(body).not.toContain('Authenticator QR code');
      expectHosted(body).toContain('<form id="profile-form" class="profile-form" hidden>');
      expectHosted(body).toContain('<form id="email-form" class="inline-form" hidden>');
      expectHosted(body).toContain('<form id="phone-form" class="inline-form" hidden>');
      expectHosted(body).toContain('<form id="delete-account-form" class="inline-form" hidden>');
      expectHosted(body).toContain('let accountConfigLoaded = false;');
      expectHosted(body).toContain("let accountConfig = {\n      enabled: false,");
      expectHosted(body).toContain('accountSectionGrid.hidden = true;');
      expectHosted(body).toContain('accountSectionGrid.hidden = false;');
      expectHosted(body).toContain('if (!accountConfigLoaded || !accountConfig.enabled)');
      expectHosted(body).toContain('const accountCenterAvailable = await loadAccountConfig();');
      expectHosted(body).toContain('if (!accountCenterAvailable) return;');
      expectHosted(body).toContain('href="/account/password" data-section="security"');
      expectHosted(body).toContain('href="#account-panel" data-section="profile"');
      expectHosted(body).toContain('data-section="profile"');
      expectHosted(body).not.toContain('data-section="sessions"');
      expectHosted(body).toContain('data-section="grants"');
      expectHosted(body).toContain('data-section="identities"');
      expectHosted(body).toContain('data-section="mfa"');
      expectHosted(body).toContain('data-section="contact"');
      expectHosted(body).toContain('data-section="delete-account"');
      expectHosted(body).not.toContain('class="card active"');
      expectHosted(body).not.toContain('/v1/my-account');
      expectHosted(body).not.toContain('id="manual-token-panel"');
      expectHosted(body).not.toContain('supaoauth.account.access_token');
      expectHosted(body).not.toContain('#access_token');
      expectHosted(body).not.toContain('http://auth.example.com/v1/public');
      expectHosted(body).not.toContain('Example User Center');
    }
  });

  test('hosted login page normalizes credentials and maps GoTrue login errors', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expectHosted(body).toContain('<form id="login-form" novalidate>');
    expectHosted(body).toContain('<script src="/hosted-auth.js"></script>');
    expectHosted(body).toContain('function normalizeEmailInput(value)');
    expectHosted(body).toContain("invalidLoginCredentials: 'Account or password does not match. Please check and try again.'");
    expectHosted(body).toContain("invalidLoginCredentials: '账号或密码不匹配，请检查后重试。'");
    expectHosted(body).toContain("value.includes('invalid login credentials')");
    expectHosted(body).toContain("value.includes('invalid_credentials')");
    expectHosted(body).toContain("setMessage('error', loginResponseMessage(error))");
    expectHosted(body).toContain('const email = normalizeEmailInput(emailInput.value);');
    expectHosted(body).toContain("setMessage('error', t('emailInvalid'))");
    expectHosted(body).toContain("setMessage('error', t('passwordRequired'))");
    expectHosted(body).toContain("setMessage('error', responseMessage(error, t('networkError')))");
    expectHosted(body).toContain('hostedAuth.signInWithPassword({ email, password })');
    expectHosted(body).toContain('function completeStandaloneLogin()');
    expectHosted(body).toContain("window.location.href = '/account';");
    expectHosted(body).toContain('completeStandaloneLogin();');
    expectHosted(body).toContain('function safeRedirectUrl(value, allowExternal = false)');
    expectHosted(body).toContain("url.protocol !== 'http:' && url.protocol !== 'https:'");
    expectHosted(body).toContain("if (!allowExternal && url.origin !== window.location.origin) return '';");
    expectHosted(body).toContain('return allowExternal ? url.toString() : `${url.pathname}${url.search}${url.hash}`;');
    expectHosted(body).toContain('await continueAuthorization(session.access_token);');
    expectHosted(body).toContain('const magicLinkSession = await hostedAuth.consumeMagicLinkSessionFromUrl();');
    expectHosted(body).toContain('await continueAuthorization(magicLinkSession.access_token);');
    expectHosted(body).not.toContain('continueAuthorizationWithMfaStepUp');
    expectHosted(body).not.toContain('supaoauth.admin.mfa-step-up');
    expectHosted(body).not.toContain('isAdminMfaStepUpFlow');
    expectHosted(body).not.toContain('challengeAndVerifyTotp');
    expectHosted(body).toContain('function showConsent(authorization, accessToken)');
    expectHosted(body).toContain("submitConsent('approve')");
    expectHosted(body).toContain("submitConsent('deny')");
    expectHosted(body).toContain("authorizationRequest('/consent', authorizationAccessToken");
    expectHosted(body).not.toContain('/approve');
    expectHosted(body).toContain('? `${publicApiBase()}/sign-in-experience/resolve?authorization_id=${encodeURIComponent(authorizationId)}`');
    expectHosted(body).toContain(': `${publicApiBase()}/sign-in-experience/resolve`;');
    expectHosted(body).not.toContain('if (!authorizationId) return;');
    expectHosted(body).not.toContain('grant_type=password');
    expectHosted(body).not.toContain('supaoauth.account.access_token');
    expectHosted(body).not.toContain('#access_token');
  });

  test('hosted login page renders connector names as text instead of executable HTML', async () => {
    const response = await request('http://localhost/login.html');
    const html = await response.text();

    expectHosted(html).toContain("connectorLabel.textContent = String(c.name || c.id || 'SSO')");
    expect(html).not.toContain('`${icon}<span>${c.name}</span>`');
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

  test('hosted login page defers OAuth authorization authority to GoTrue', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expectHosted(body).toContain("authorizationExpired: 'This sign-in request has expired. Please return to the application and sign in again.'");
    expectHosted(body).toContain("authorizationExpired: '本次登录请求已过期，请返回应用重新发起登录。'");
    expectHosted(body).toContain("authorizationUnavailable: '暂时无法校验本次登录请求，请返回应用重新发起登录。'");
    expectHosted(body).toContain("const authorization = await authorizationRequest('', accessToken);");
    expectHosted(body).toContain("if ('redirect_url' in authorization) {");
    expectHosted(body).toContain('showConsent(authorization, accessToken);');
    expectHosted(body).toContain('id="consent-client-name"');
    expectHosted(body).toContain('id="consent-scopes"');
    expectHosted(body).toContain('id="consent-approve"');
    expectHosted(body).toContain('id="consent-deny"');
    expectHosted(body).not.toContain('authorizationAvailable');
    expectHosted(body).not.toContain('experience.authorization');
  });

  test('GET / serves the same authorize page', async () => {
    const response = await request('http://localhost/');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectHosted(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /favicon.ico and /favicon.svg serve the hosted favicon', async () => {
    for (const path of ['/favicon.ico', '/favicon.svg']) {
      const response = await request(`http://localhost${path}`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/svg+xml');
      expectHosted(body).toContain('<svg');
    }
  });
});
import { strictBunFile } from './helpers/strict-bun-file.js';
