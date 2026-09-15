import { requiredElement, requiredInput, htmlElements, errorRecord, textValue } from "./dom.js";
import {
  parsePasswordPolicy, type PasswordPolicy, sdkEndpoints, readContract, decodeSchema, phraseStrings,
  AuthorizationSchema, type Authorization, type AuthorizationDetails, ConsentInputSchema,
  SignupInputSchema, SignupResultSchema, RecoverInputSchema, RecoverResultSchema,
} from './contracts.js';
import type { PublicSignInConnector } from '@supauth/shared';

  const hostedAuth = window.SupaOAuthHostedAuth;
  const params = new URLSearchParams(window.location.search);
  const authorizationId = params.get('authorization_id') || '';
  const forceLogin = (params.get('prompt') || '').split(/\s+/).includes('login');
  let authorizationAccessToken = '';
  let hasCustomPageTitle = false;
  let hasCustomButtonLabel = false;
  let signUpEnabled = false;
  let passwordPolicy: PasswordPolicy | null = null;
  let systemName = 'SupaOAuth';
  const PASSWORD_POLICY_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

  // ─── i18n defaults with phrase override support ─────────────────
  const LOCALE_STORAGE_KEY = 'supaoauth.locale';
  const defaultMessages: Record<'en' | 'zh-CN', Record<string, string>> = {
    en: {
      documentTitle: 'SupaOAuth Sign In',
      title: 'SupaOAuth',
      subtitle: 'Sign in to continue',
      email: 'Email',
      password: 'Password',
      submit: 'Sign In',
      signingIn: 'Signing in...',
      footer: 'SupaOAuth User Center',
      loginFailed: 'Login failed',
      loginSuccess: 'Login successful.',
      redirecting: 'Login successful. Redirecting...',
      networkError: 'Network error',
      emailRequired: 'Enter your email address.',
      emailInvalid: 'Enter a valid email address.',
      passwordRequired: 'Enter your password.',
      invalidLoginCredentials: 'Account or password does not match. Please check and try again.',
      authorizationFailed: 'Authorization approval failed',
      authorizationExpired: 'This sign-in request has expired. Please return to the application and sign in again.',
      authorizationUnavailable: 'This sign-in request cannot be verified right now. Please return to the application and start sign-in again.',
      consentTitle: 'Authorize application',
      consentDescription: 'Review the requested access before continuing.',
      consentScopes: 'This application requests:',
      consentUnknownClient: 'OAuth application',
      consentNoScopes: 'Basic account access',
      approve: 'Approve',
      deny: 'Deny',
      signIn: 'Sign In',
      signUp: 'Sign Up',
      forgotPassword: 'Forgot Password',
      signUpSubmit: 'Sign Up',
      signingUp: 'Signing up...',
      signUpSuccess: 'Account created. You can now sign in.',
      signUpFailed: 'Sign up failed',
      passwordPolicyUnavailable: 'Password policy is temporarily unavailable. Sign up is disabled.',
      passwordMinimum: 'At least {min} characters',
      passwordUppercase: 'one uppercase letter',
      passwordLowercase: 'one lowercase letter',
      passwordNumber: 'one number',
      passwordSymbol: 'one symbol',
      forgotEmailLabel: 'Email',
      forgotSubmit: 'Send Reset Link',
      sendingReset: 'Sending...',
      forgotSuccess: 'Password reset email sent. Check your inbox.',
      forgotFailed: 'Failed to send reset email',
      or: 'or',
      forgotLink: 'Forgot password?',
      backToSignIn: 'Back to Sign In',
    },
    'zh-CN': {
      documentTitle: 'SupaOAuth 登录',
      title: 'SupaOAuth',
      subtitle: '登录后继续',
      email: '邮箱',
      password: '密码',
      submit: '登录',
      signingIn: '正在登录...',
      footer: 'SupaOAuth 用户中心',
      loginFailed: '登录失败',
      loginSuccess: '登录成功。',
      redirecting: '登录成功，正在跳转...',
      networkError: '网络错误',
      emailRequired: '请输入邮箱。',
      emailInvalid: '请输入正确的邮箱格式。',
      passwordRequired: '请输入密码。',
      invalidLoginCredentials: '账号或密码不匹配，请检查后重试。',
      authorizationFailed: '授权确认失败',
      authorizationExpired: '本次登录请求已过期，请返回应用重新发起登录。',
      authorizationUnavailable: '暂时无法校验本次登录请求，请返回应用重新发起登录。',
      consentTitle: '授权应用',
      consentDescription: '继续前请确认该应用请求的访问权限。',
      consentScopes: '该应用请求以下权限：',
      consentUnknownClient: 'OAuth 应用',
      consentNoScopes: '基础账号访问',
      approve: '允许',
      deny: '拒绝',
      signIn: '登录',
      signUp: '注册',
      forgotPassword: '忘记密码',
      signUpSubmit: '注册',
      signingUp: '正在注册...',
      signUpSuccess: '账号已创建，请登录。',
      signUpFailed: '注册失败',
      passwordPolicyUnavailable: '密码策略暂时不可用，当前无法注册。',
      passwordMinimum: '至少 {min} 个字符',
      passwordUppercase: '一个大写字母',
      passwordLowercase: '一个小写字母',
      passwordNumber: '一个数字',
      passwordSymbol: '一个符号',
      forgotEmailLabel: '邮箱',
      forgotSubmit: '发送重置链接',
      sendingReset: '正在发送...',
      forgotSuccess: '密码重置邮件已发送，请查看邮箱。',
      forgotFailed: '发送重置邮件失败',
      or: '或',
      forgotLink: '忘记密码？',
      backToSignIn: '返回登录',
    },
  };

  // Phrase overrides from API
  const phraseOverrides: Record<string, Record<string, string>> = {};

  function normalizeLocale(locale: string | null | undefined) {
    if (!locale) return null;
    const normalized = locale.replace('_', '-').toLowerCase();
    if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
    return null;
  }

  function localeCandidates() {
    const uiLocales = (params.get('ui_locales') || '').split(/\s+/).filter(Boolean);
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    const browserLocales = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    return [...uiLocales, stored, ...browserLocales, 'en'];
  }

  function detectLocale(): 'en' | 'zh-CN' {
    for (const candidate of localeCandidates()) {
      const locale = normalizeLocale(candidate);
      if (locale && defaultMessages[locale]) return locale;
    }
    return 'en';
  }

  let currentLocale = detectLocale();

  function t(key: string): string {
    // Phrase overrides take priority, then defaults
    return phraseOverrides[currentLocale]?.[key] || defaultMessages[currentLocale][key] || defaultMessages.en[key] || key;
  }

  function renderFooter() {
    // 系统名由 sign-in-experience.page_title 驱动；默认仍为 SupaOAuth。
    if (systemName === 'SupaOAuth') return t('footer');
    return currentLocale === 'zh-CN' ? systemName + ' 用户中心' : systemName + ' User Center';
  }

  function applyLocale(locale: string, persist = false) {
    currentLocale = normalizeLocale(locale) ?? 'en';
    document.documentElement.lang = currentLocale;
    requiredElement("#language", "select").value = currentLocale;
    requiredElement("#subtitle", "p").textContent = t('subtitle');
    requiredElement("#email-label", "label").textContent = t('email');
    requiredElement("#password-label", "label").textContent = t('password');
    requiredElement("#signup-email-label", "label").textContent = t('email');
    requiredElement("#signup-password-label", "label").textContent = t('password');
    requiredElement("#signup-submit", "button").textContent = t('signUpSubmit');
    requiredElement("#forgot-email-label", "label").textContent = t('forgotEmailLabel');
    requiredElement("#forgot-submit", "button").textContent = t('forgotSubmit');
    requiredElement("#forgot-password-link", "a").textContent = t('forgotLink');
    requiredElement("#tab-signin", "button").textContent = t('signIn');
    requiredElement("#tab-signup", "button").textContent = t('signUp');
    requiredElement("#tab-forgot", "button").textContent = t('forgotPassword');
    requiredElement("#or-text", "span").textContent = t('or');
    requiredElement("#consent-title", "h2").textContent = t('consentTitle');
    requiredElement("#consent-description", "p").textContent = t('consentDescription');
    requiredElement("#consent-scopes-label", "p").textContent = t('consentScopes');
    requiredElement("#consent-approve", "button").textContent = t('approve');
    requiredElement("#consent-deny", "button").textContent = t('deny');
    requiredElement("#footer", "div").textContent = renderFooter();
    if (!hasCustomPageTitle) {
      document.title = t('documentTitle');
      requiredElement("#title", "h1").textContent = t('title');
    }
    if (!hasCustomButtonLabel) {
      requiredElement("#submit", "button").textContent = t('submit');
    }
    renderPasswordPolicyHint();
    if (persist) localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
  }

  // ─── API helpers ─────────────────────────────────────────────────
  function publicApiBase() {
    const metaBase = document.querySelector<HTMLMetaElement>('meta[name="supaoauth-api-base"]');
    if (metaBase && metaBase.content) return metaBase.content;
    const { protocol, hostname, port, origin } = window.location;
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return `${protocol}//${hostname}:4010/v1/public`;
    }
    if (hostname.startsWith('auth.')) {
      return `${origin}/v1/public`;
    }
    if (hostname.startsWith('api.')) {
      return `${protocol}//${hostname.replace(/^api\./, 'auth.')}${port ? `:${port}` : ''}/api/v1/public`;
    }
    return `${origin}/api/v1/public`;
  }

  function setMessage(type: string, text: string) {
    const el = requiredElement("#message", "div");
    el.className = `message ${type}`;
    el.textContent = text;
  }

  function clearMessage() {
    const el = requiredElement("#message", "div");
    el.className = 'message';
    el.textContent = '';
  }

  function passwordPolicyRequirements(policy: PasswordPolicy) {
    const requirements = [t('passwordMinimum').replace('{min}', String(policy.min_length))];
    if (policy.require_uppercase) requirements.push(t('passwordUppercase'));
    if (policy.require_lowercase) requirements.push(t('passwordLowercase'));
    if (policy.require_numbers) requirements.push(t('passwordNumber'));
    if (policy.require_symbols) requirements.push(t('passwordSymbol'));
    return requirements;
  }

  function renderPasswordPolicyHint() {
    const hint = requiredElement("#signup-password-hint", "p");
    hint.textContent = passwordPolicy ? passwordPolicyRequirements(passwordPolicy).join(' · ') : '';
  }

  function applyPasswordPolicy(candidate: unknown) {
    const parsed = parsePasswordPolicy(candidate);
    if (!parsed) return false;
    passwordPolicy = parsed;
    const input = requiredElement("#signup-password", "input");
    input.minLength = parsed.min_length;
    input.setAttribute('minlength', String(parsed.min_length));
    renderPasswordPolicyHint();
    return true;
  }

  function passwordPolicyError(password: string) {
    if (!passwordPolicy) return t('passwordPolicyUnavailable');
    const requirements = passwordPolicyRequirements(passwordPolicy);
    if (password.length < passwordPolicy.min_length) return requirements[0] ?? t('passwordPolicyUnavailable');
    if (passwordPolicy.require_uppercase && !/[A-Z]/.test(password)) return t('passwordUppercase');
    if (passwordPolicy.require_lowercase && !/[a-z]/.test(password)) return t('passwordLowercase');
    if (passwordPolicy.require_numbers && !/[0-9]/.test(password)) return t('passwordNumber');
    if (passwordPolicy.require_symbols && !Array.from(password).some((character) => PASSWORD_POLICY_SYMBOLS.includes(character))) {
      return t('passwordSymbol');
    }
    return '';
  }

  function responseMessage(value: unknown, fallback: string): string {
    const data = errorRecord(value);
    return textValue(data["msg"]) || textValue(data["error_description"]) || textValue(data["message"])
      || textValue(data["error"]) || fallback;
  }

  function apiErrorCode(value: unknown) {
    const data = errorRecord(value);
    const code = data["error"] || data["error_code"] || data["code"];
    return typeof code === 'string' ? code : '';
  }

  function createApiError(data: unknown, fallback: string) {
    return Object.assign(new Error(responseMessage(data, fallback)), { code: apiErrorCode(data) });
  }

  function completeStandaloneLogin() {
    setMessage('ok', t('redirecting'));
    window.location.href = '/account';
  }

  function normalizeEmailInput(value: string) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function isInvalidCredentials(candidate: unknown) {
    const data = errorRecord(candidate);
    const fields = [
      data && data["error"],
      data && data["error_code"],
      data && data["error_description"],
      data && data["msg"],
      data && data["message"],
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return fields.some((value) => (
      value.includes('invalid login credentials') ||
      value.includes('invalid_credentials') ||
      value.includes('invalid credentials')
    ));
  }

  function loginResponseMessage(data: unknown) {
    if (data && typeof data === 'object' && isInvalidCredentials(data)) {
      return t('invalidLoginCredentials');
    }
    return responseMessage(data, t('loginFailed'));
  }

  function safeRedirectUrl(value: unknown, allowExternal = false) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value, window.location.origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (!allowExternal && url.origin !== window.location.origin) return '';
      return allowExternal ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return '';
    }
  }

  async function authorizationRequest(path: '' | '/consent', accessToken: string, options: RequestInit = {}): Promise<Authorization> {
    const res = await fetch(
      `${publicApiBase()}/oauth/authorizations/${encodeURIComponent(authorizationId)}${path}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(options.headers || {}),
        },
      },
    );
    if (!res.ok) {
      const data: unknown = await res.json().catch(() => null);
      throw createApiError(data, t('authorizationFailed'));
    }
    return readContract(res, AuthorizationSchema);
  }

  function redirectToAuthorizationResult(result: Authorization) {
    const redirectUrl = safeRedirectUrl('redirect_url' in result ? result.redirect_url : undefined, true);
    if (!redirectUrl) throw new Error(t('authorizationFailed'));
    setMessage('ok', t('redirecting'));
    window.location.href = redirectUrl;
  }

  function scopeNames(scope: string | undefined) {
    const names = String(scope || '').split(/\s+/).filter(Boolean);
    return names.length > 0 ? names : [t('consentNoScopes')];
  }

  function showConsent(authorization: AuthorizationDetails, accessToken: string) {
    authorizationAccessToken = accessToken;
    requiredElement("#tabs-nav", "div").hidden = true;
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    requiredElement("#social-divider", "div").style.display = 'none';
    requiredElement("#social-section", "div").style.display = 'none';

    const client = authorization.client;
    requiredElement("#consent-client-name", "strong").textContent = client.name || t('consentUnknownClient');
    const clientUri = requiredElement("#consent-client-uri", "a");
    const safeClientUri = safeRedirectUrl(client.uri, true);
    clientUri.hidden = !safeClientUri;
    if (safeClientUri) {
      clientUri.href = safeClientUri;
      clientUri.textContent = safeClientUri;
    }

    const scopeList = requiredElement("#consent-scopes", "ul");
    scopeList.replaceChildren();
    for (const scope of scopeNames(authorization.scope)) {
      const scopeItem = document.createElement('li');
      scopeItem.textContent = scope;
      scopeList.appendChild(scopeItem);
    }
    requiredElement("#consent-panel", "section").hidden = false;
    clearMessage();
  }

  async function continueAuthorization(accessToken: string) {
    if (!authorizationId) {
      completeStandaloneLogin();
      return;
    }
    const authorization = await authorizationRequest('', accessToken);
    if ('redirect_url' in authorization) {
      redirectToAuthorizationResult(authorization);
      return;
    }
    showConsent(authorization, accessToken);
  }

  async function submitConsent(action: 'approve' | 'deny') {
    const approveButton = requiredElement("#consent-approve", "button");
    const denyButton = requiredElement("#consent-deny", "button");
    approveButton.disabled = true;
    denyButton.disabled = true;
    try {
      const decision = await authorizationRequest('/consent', authorizationAccessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decodeSchema(ConsentInputSchema, { action })),
      });
      redirectToAuthorizationResult(decision);
    } catch (error) {
      setMessage('error', responseMessage(error, t('authorizationFailed')));
    } finally {
      approveButton.disabled = false;
      denyButton.disabled = false;
    }
  }

  // ─── Tab switching ────────────────────────────────────────────────
  function switchTab(tabName: string | undefined) {
    htmlElements('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset["tab"] === tabName));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));
    clearMessage();
  }

  htmlElements('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset["tab"]));
  });

  requiredElement("#forgot-password-link", "a").addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('forgot');
  });

  requiredElement("#consent-approve", "button").addEventListener('click', () => {
    void submitConsent('approve');
  });
  requiredElement("#consent-deny", "button").addEventListener('click', () => {
    void submitConsent('deny');
  });

  // ─── Social login ────────────────────────────────────────────────
  function renderSocialButtons(connectors: PublicSignInConnector[]) {
    if (!connectors || !connectors.length) return;
    const section = requiredElement("#social-section", "div");
    const divider = requiredElement("#social-divider", "div");
    const icons: Record<string, string> = {
      google: '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 019.5 24c0-1.59.28-3.14.78-4.59l-7.98-6.19A23.9 23.9 0 000 24c0 3.77.9 7.34 2.56 10.53l7.97-5.94z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.94C6.51 42.62 14.62 48 24 48z"/></svg>',
      github: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>',
    };

    for (const c of connectors) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'social-btn';
      const icon = icons[c.id] || '';
      if (icon) btn.insertAdjacentHTML('afterbegin', icon);
      const connectorLabel = document.createElement('span');
      connectorLabel.textContent = String(c.name || c.id || 'SSO');
      btn.appendChild(connectorLabel);
      btn.addEventListener('click', () => {
        const url = new URL(`${publicApiBase()}/connectors/${encodeURIComponent(c.id)}/authorize`, window.location.origin);
        // Forward current OAuth params so the flow continues after social login
        const forward = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'nonce', 'resource'];
        for (const p of forward) {
          const val = params.get(p);
          if (val) url.searchParams.set(p, val);
        }
        if (authorizationId) url.searchParams.set('authorization_id', authorizationId);
        window.location.href = url.toString();
      });
      section.appendChild(btn);
    }
    section.style.display = 'flex';
    divider.style.display = 'flex';
  }

  const featureIcons: Record<string, string> = {
    shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2.5 L20 6 V11.5 C20 16.4 16.5 20.4 12 21.5 C7.5 20.4 4 16.4 4 11.5 V6 Z" stroke="currentColor" stroke-width="1.5"/><path d="M8.8 12 L11 14.2 L15.2 9.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    users: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.1" stroke="currentColor" stroke-width="1.5"/><circle cx="16.2" cy="10" r="2.3" stroke="currentColor" stroke-width="1.5" opacity="0.72"/><path d="M3.6 19 C3.6 15.6 6 13.7 9 13.7 C12 13.7 14.4 15.6 14.4 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14.6 17.8 C14.6 15.3 16.4 13.9 18.6 13.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.72"/></svg>',
    key: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="12" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 12 H20 M17 12 V15 M14.8 12 V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    audit: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="5" y="3.5" width="14" height="17" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 8 H16 M8 12 H15 M8 16 H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 10.5 V7.5 C8 5.6 9.8 4 12 4 C14.2 4 16 5.6 16 7.5 V10.5" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/></svg>',
    globe: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 12 H20.5 M12 3.5 C14.8 6 14.8 18 12 20.5 C9.2 18 9.2 6 12 3.5 Z" stroke="currentColor" stroke-width="1.5"/></svg>',
    cloud: '<svg viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="cl-body" x1="100" y1="60" x2="320" y2="200" gradientUnits="userSpaceOnUse"><stop stop-color="#312e81" stop-opacity="0.55"/><stop offset="1" stop-color="#0b1220" stop-opacity="0.65"/></linearGradient><linearGradient id="cl-box" x1="138" y1="126" x2="282" y2="172" gradientUnits="userSpaceOnUse"><stop stop-color="#6366f1" stop-opacity="0.4"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0.3"/></linearGradient><radialGradient id="cl-glow1" cx="0.5" cy="0.5" r="0.5"><stop stop-color="#38bdf8" stop-opacity="0.5"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient><radialGradient id="cl-glow2" cx="0.5" cy="0.5" r="0.5"><stop stop-color="#818cf8" stop-opacity="0.5"/><stop offset="1" stop-color="#818cf8" stop-opacity="0"/></radialGradient></defs><path d="M132 162 H298 C331 162 358 137 358 106 C358 78 337 55 309 51 C299 25 274 10 244 16 C218 21 199 40 191 64 C184 61 176 60 168 60 C132 60 103 89 103 125 C79 129 62 148 62 171 C62 197 84 218 112 218 H306" fill="url(#cl-body)" stroke="rgba(199,210,254,0.38)" stroke-width="2.5"/><circle cx="316" cy="124" r="40" fill="url(#cl-glow1)"/><circle cx="110" cy="86" r="28" fill="url(#cl-glow2)"/><rect x="138" y="126" width="144" height="46" rx="14" fill="url(#cl-box)" stroke="rgba(199,210,254,0.4)" stroke-width="1.5"/><path d="M162 142 V156 M178 142 V156 M194 142 V156" stroke="rgba(199,210,254,0.55)" stroke-width="3" stroke-linecap="round"/><rect x="216" y="140" width="52" height="6" rx="3" fill="rgba(199,210,254,0.6)"/><rect x="216" y="152" width="36" height="6" rx="3" fill="rgba(129,140,248,0.5)"/><path d="M142 198 H278" stroke="rgba(56,189,248,0.6)" stroke-width="8" stroke-linecap="round"/><circle cx="288" cy="198" r="5" fill="rgba(56,189,248,0.8)"/><path d="M322 100 L334 110 L322 120" stroke="rgba(165,180,252,0.7)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M312 116 L300 106 L312 96" stroke="rgba(165,180,252,0.5)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M13 2.5 L5 13.5 H11 L10 21.5 L19 9.5 H13 Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    fingerprint: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 4.5 C7.8 4.5 4.5 7.8 4.5 12 V15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 7.8 C9.1 7 10.5 6.5 12 6.5 C15.6 6.5 18.5 9.4 18.5 13 V17 C18.5 18.4 18.2 19.7 17.6 20.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 13 C8 10.8 9.8 9 12 9 C14.2 9 16 10.8 16 13 V16.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 13 V16 C12 17.8 11.6 19.4 11 20.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    mail: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M4 7 L12 12.5 L20 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    device: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="5" y="5.5" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 17.5 H21 L19.5 15 H4.5 Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    database: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="2.8" stroke="currentColor" stroke-width="1.5"/><path d="M5 6 V12 C5 13.5 8.1 14.8 12 14.8 C15.9 14.8 19 13.5 19 12 V6" stroke="currentColor" stroke-width="1.5"/><path d="M5 12 V18 C5 19.5 8.1 20.8 12 20.8 C15.9 20.8 19 19.5 19 18 V12" stroke="currentColor" stroke-width="1.5"/></svg>',
    chart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 20 H20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="6" y="12" width="3" height="6" rx="0.5" stroke="currentColor" stroke-width="1.5"/><rect x="10.5" y="8" width="3" height="10" rx="0.5" stroke="currentColor" stroke-width="1.5"/><rect x="15" y="5" width="3" height="13" rx="0.5" stroke="currentColor" stroke-width="1.5"/></svg>',
  };

  const illustrationThemes: Record<string, string> = {
    identity: '<svg viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="id-card" x1="62" y1="44" x2="358" y2="216" gradientUnits="userSpaceOnUse"><stop stop-color="#1e1b4b" stop-opacity="0.55"/><stop offset="1" stop-color="#0b1220" stop-opacity="0.7"/></linearGradient><linearGradient id="id-ava" x1="106" y1="80" x2="170" y2="144" gradientUnits="userSpaceOnUse"><stop stop-color="#c7d2fe"/><stop offset="1" stop-color="#6366f1"/></linearGradient><radialGradient id="id-glow1" cx="0.5" cy="0.5" r="0.5"><stop stop-color="#38bdf8" stop-opacity="0.55"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient><radialGradient id="id-glow2" cx="0.5" cy="0.5" r="0.5"><stop stop-color="#818cf8" stop-opacity="0.55"/><stop offset="1" stop-color="#818cf8" stop-opacity="0"/></radialGradient></defs><rect x="62" y="44" width="296" height="172" rx="24" fill="url(#id-card)" stroke="rgba(199,210,254,0.22)" stroke-width="1.5"/><circle cx="332" cy="64" r="40" fill="url(#id-glow1)"/><circle cx="78" cy="192" r="32" fill="url(#id-glow2)"/><circle cx="136" cy="110" r="32" fill="url(#id-ava)"/><circle cx="136" cy="110" r="32" fill="none" stroke="rgba(224,231,255,0.6)" stroke-width="2"/><circle cx="136" cy="100" r="9.5" fill="#0b1220" opacity="0.4"/><path d="M118 142 C124 130 130 124 136 124 C142 124 148 130 154 142" fill="#0b1220" opacity="0.4"/><circle cx="160" cy="134" r="11.5" fill="#10b981"/><path d="M155 134 L159 138 L166 130" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="188" y="84" width="116" height="13" rx="6.5" fill="rgba(224,231,255,0.75)"/><rect x="188" y="106" width="142" height="9" rx="4.5" fill="rgba(129,140,248,0.5)"/><rect x="188" y="123" width="98" height="9" rx="4.5" fill="rgba(56,189,248,0.42)"/><rect x="188" y="140" width="70" height="9" rx="4.5" fill="rgba(165,180,252,0.38)"/><circle cx="298" cy="160" r="12" fill="none" stroke="rgba(165,180,252,0.65)" stroke-width="2.5"/><path d="M308 160 H332 M326 154 V168" stroke="rgba(165,180,252,0.65)" stroke-width="2.5" stroke-linecap="round"/><path d="M94 56 L80 70 L94 84" stroke="rgba(56,189,248,0.65)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M326 188 L340 202 L326 216" stroke="rgba(56,189,248,0.5)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cloud: '<svg viewBox="0 0 420 260" fill="none"><path d="M132 164 H298 C331 164 358 139 358 108 C358 80 337 57 309 53 C299 27 274 12 244 18 C218 23 199 42 191 66 C184 63 176 62 168 62 C132 62 103 91 103 127 C79 131 62 150 62 173 C62 199 84 220 112 220 H306" fill="rgba(15,23,42,0.34)" stroke="rgba(199,210,254,0.34)" stroke-width="3"/><rect x="138" y="126" width="144" height="46" rx="14" fill="rgba(199,210,254,0.14)" stroke="rgba(199,210,254,0.34)"/><path d="M164 149 H218 M238 149 H258" stroke="rgba(199,210,254,0.68)" stroke-width="7" stroke-linecap="round"/><path d="M142 198 H278" stroke="rgba(56,189,248,0.58)" stroke-width="8" stroke-linecap="round"/><circle cx="308" cy="128" r="10" fill="rgba(56,189,248,0.68)"/><circle cx="120" cy="91" r="7" fill="rgba(129,140,248,0.78)"/></svg>',
    security: '<svg viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sec-shield" x1="94" y1="26" x2="326" y2="246" gradientUnits="userSpaceOnUse"><stop stop-color="#312e81" stop-opacity="0.55"/><stop offset="1" stop-color="#0b1220" stop-opacity="0.7"/></linearGradient><linearGradient id="sec-inner" x1="132" y1="58" x2="288" y2="217" gradientUnits="userSpaceOnUse"><stop stop-color="#6366f1" stop-opacity="0.25"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0.18"/></linearGradient><radialGradient id="sec-glow" cx="0.5" cy="0.55" r="0.5"><stop stop-color="#818cf8" stop-opacity="0.4"/><stop offset="1" stop-color="#818cf8" stop-opacity="0"/></radialGradient></defs><circle cx="210" cy="136" r="92" fill="url(#sec-glow)"/><path d="M210 26 L326 72 V142 C326 194 278 232 210 246 C142 232 94 194 94 142 V72 Z" fill="url(#sec-shield)" stroke="rgba(199,210,254,0.45)" stroke-width="2.5"/><path d="M210 58 L288 90 V140 C288 176 257 205 210 217 C163 205 132 176 132 140 V90 Z" fill="url(#sec-inner)" stroke="rgba(129,140,248,0.4)" stroke-width="1.5"/><rect x="172" y="128" width="76" height="56" rx="14" fill="rgba(199,210,254,0.16)" stroke="rgba(199,210,254,0.6)" stroke-width="2.5"/><path d="M186 128 V110 C186 95 197 84 210 84 C223 84 234 95 234 110 V128" fill="none" stroke="rgba(199,210,254,0.75)" stroke-width="7" stroke-linecap="round"/><circle cx="210" cy="152" r="7.5" fill="#38bdf8"/><path d="M210 156 V170" stroke="rgba(56,189,248,0.85)" stroke-width="4" stroke-linecap="round"/><path d="M62 96 H104 M314 196 H356 M72 178 H110" stroke="rgba(56,189,248,0.5)" stroke-width="7" stroke-linecap="round"/><circle cx="344" cy="84" r="7" fill="rgba(129,140,248,0.85)"/><circle cx="68" cy="146" r="5" fill="rgba(56,189,248,0.7)"/></svg>',
  };

  function normalizeIllustration(value: unknown) {
    const content = errorRecord(value);
    const illustration = String(content["illustration"] || '').trim();
    return illustrationThemes[illustration] ? illustrationThemes[illustration] : '';
  }

  function normalizeContentItems(value: unknown): unknown[] {
    const content = errorRecord(value);
    if (Array.isArray(value)) return value;
    if (content && typeof content === 'object' && Array.isArray(content["items"])) return content["items"];
    if (content && typeof content === 'object' && Array.isArray(content["features"])) return content["features"];
    return [];
  }

  function renderFeatureCards(container: HTMLElement, items: unknown[]) {
    const grid = document.createElement('div');
    grid.className = 'feature-grid';
    items.slice(0, 8).forEach((value) => {
      const item = errorRecord(value);
      const title = String(item["title"] || item["name"] || '').trim();
      const desc = String(item["desc"] || item["description"] || '').trim();
      if (!title && !desc) return;

      const card = document.createElement('div');
      card.className = 'feature-card';

      const icon = document.createElement('span');
      icon.className = 'feature-icon';
      const iconName = String(item["icon"] || 'shield').trim();
      icon.innerHTML = featureIcons[iconName] || featureIcons["shield"] || '';

      const text = document.createElement('span');
      text.className = 'feature-text';
      const titleEl = document.createElement('strong');
      titleEl.className = 'feature-title';
      titleEl.textContent = title;
      const descEl = document.createElement('span');
      descEl.className = 'feature-desc';
      descEl.textContent = desc;

      text.appendChild(titleEl);
      if (desc) text.appendChild(descEl);
      card.appendChild(icon);
      card.appendChild(text);
      grid.appendChild(card);
    });
    if (grid.childElementCount) container.appendChild(grid);
  }

  function renderBrandingContent(content: unknown) {
    renderBrandIllustration(content);
    const container = requiredElement("#custom-content", "div");
    container.replaceChildren();
    renderFeatureCards(container, normalizeContentItems(content));
  }

  function renderBrandIllustration(content: unknown) {
    const container = requiredElement("#brand-illustration", "div");
    const illustration = normalizeIllustration(content);
    container.replaceChildren();
    if (!illustration) {
      container.style.display = 'none';
      return;
    }
    container.innerHTML = illustration;
    container.style.display = 'block';
  }

  // ─── Load phrases from API ────────────────────────────────────────
  async function loadPhrases(locale: string) {
    try {
      const res = await fetch(`${publicApiBase()}/phrases/${encodeURIComponent(locale)}`);
      if (!res.ok) return;
      const data = await readContract(res, sdkEndpoints.getPublicPhrases.result);
      if (data && data.phrases && typeof data.phrases === 'object' && Object.keys(data.phrases).length > 0) {
        phraseOverrides[locale] = phraseStrings(data.phrases);
      }
    } catch (error) {
      console.warn('Failed to load localized sign-in phrases', error);
    }
  }

  // ─── Load experience (branding + connectors + custom content) ───────────
  async function loadExperience() {
    const url = authorizationId
      ? `${publicApiBase()}/sign-in-experience/resolve?authorization_id=${encodeURIComponent(authorizationId)}`
      : `${publicApiBase()}/sign-in-experience/resolve`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        setMessage('error', authorizationId ? t('authorizationUnavailable') : t('passwordPolicyUnavailable'));
        return;
      }
      const experience = await readContract(res, sdkEndpoints.resolvePublicSignInExperience.result);
      if (!applyPasswordPolicy(experience.password_policy)) {
        setMessage('error', t('passwordPolicyUnavailable'));
        return;
      }
      const branding = experience.branding || {};

      // Branding
      if (branding.page_title) {
        hasCustomPageTitle = true;
        systemName = branding.page_title;
        document.title = branding.page_title;
        requiredElement("#title", "h1").textContent = branding.page_title;
        requiredElement("#footer", "div").textContent = renderFooter();
      }
      if (branding.description && branding.description.trim()) {
        const intro = requiredElement("#intro", "p");
        intro.textContent = branding.description.trim();
        intro.style.display = 'block';
      }
      if (branding.primary_color) {
        document.documentElement.style.setProperty('--primary', branding.primary_color);
      }
      if (branding.logo_url) {
        const logo = requiredElement("#logo", "img");
        logo.src = branding.logo_url;
        logo.style.display = 'block';
        requiredElement("#brand-mark", "div").style.display = 'none';
      }
      if (branding.favicon_url) {
        const icon = document.createElement('link');
        icon.rel = 'icon';
        icon.href = branding.favicon_url;
        document.head.appendChild(icon);
      }
      if (branding.background_url) {
        document.body.classList.add('has-bg');
        document.body.style.backgroundImage = `url("${branding.background_url}")`;
      }
      if (branding.button_label) {
        hasCustomButtonLabel = true;
        requiredElement("#submit", "button").textContent = branding.button_label;
      }
      if (branding.custom_css) {
        requiredElement("#custom-style", "style").textContent = branding.custom_css;
      }

      renderBrandingContent(branding.content);

      // Social connectors
      if (experience.connectors && experience.connectors.length > 0) {
        renderSocialButtons(experience.connectors);
      }

      // Sign-up enabled
      if (experience.sign_up_enabled === true || experience.sign_up_enabled === undefined) {
        signUpEnabled = true;
        requiredElement("#tab-signup", "button").style.display = '';
        requiredElement("#signup-submit", "button").disabled = false;
      }

      // Forgot password link always visible (GoTrue supports it)
      requiredElement("#forgot-password-link", "a").style.display = '';
      requiredElement("#tab-forgot", "button").style.display = '';
    } catch {
      setMessage('error', authorizationId ? t('authorizationUnavailable') : t('passwordPolicyUnavailable'));
    }
  }

  // ─── Sign In ──────────────────────────────────────────────────────
  requiredElement("#login-form", "form").addEventListener('submit', async (event) => {
    event.preventDefault();
    const emailInput = requiredElement("#email", "input");
    const passwordInput = requiredElement("#password", "input");
    const email = normalizeEmailInput(emailInput.value);
    const password = passwordInput.value;
    emailInput.value = email;
    if (!email) {
      setMessage('error', t('emailRequired'));
      emailInput.focus();
      return;
    }
    if (!isValidEmail(email)) {
      setMessage('error', t('emailInvalid'));
      emailInput.focus();
      return;
    }
    if (!password) {
      setMessage('error', t('passwordRequired'));
      passwordInput.focus();
      return;
    }
    const button = requiredElement("#submit", "button");
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = t('signingIn');
    try {
      if (!hostedAuth) {
        throw new Error('登录组件加载失败，请刷新页面后重试。');
      }
      const { data, error } = await hostedAuth.signInWithPassword({ email, password });
      if (error) {
        setMessage('error', loginResponseMessage(error));
        return;
      }
      const session = data && data.session;
      if (!session || !session.access_token) {
        setMessage('error', t('loginFailed'));
        return;
      }
      await continueAuthorization(session.access_token);
    } catch (error) {
      setMessage('error', responseMessage(error, t('networkError')));
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  // ─── Sign Up ──────────────────────────────────────────────────────
  requiredElement("#signup-form", "form").addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = requiredElement("#signup-submit", "button");
    const password = requiredElement("#signup-password", "input").value;
    if (!signUpEnabled || !passwordPolicy) {
      setMessage('error', t('passwordPolicyUnavailable'));
      return;
    }
    const policyError = passwordPolicyError(password);
    if (policyError) {
      setMessage('error', policyError);
      return;
    }
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = t('signingUp');
    try {
      const res = await fetch('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(decodeSchema(SignupInputSchema, {
          email: requiredElement("#signup-email", "input").value,
          password,
        })),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setMessage('error', responseMessage(data, t('signUpFailed')));
        return;
      }
      await readContract(res, SignupResultSchema);
      setMessage('ok', t('signUpSuccess'));
      // Switch to sign-in tab after successful sign-up
      setTimeout(() => {
        switchTab('signin');
        requiredElement("#email", "input").value = requiredElement("#signup-email", "input").value;
      }, 1500);
    } catch {
      setMessage('error', t('networkError'));
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  // ─── Forgot Password ──────────────────────────────────────────────
  requiredElement("#forgot-form", "form").addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = requiredElement("#forgot-submit", "button");
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = t('sendingReset');
    try {
      const res = await fetch('/auth/v1/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(decodeSchema(RecoverInputSchema, {
          email: requiredElement("#forgot-email", "input").value,
        })),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setMessage('error', responseMessage(data, t('forgotFailed')));
        return;
      }
      await readContract(res, RecoverResultSchema);
      setMessage('ok', t('forgotSuccess'));
    } catch {
      setMessage('error', t('networkError'));
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  // ─── Language switch ──────────────────────────────────────────────
  requiredElement("#language", "select").addEventListener('change', async (event) => {
    const locale = requiredElement("#language", "select").value;
    await loadPhrases(locale);
    applyLocale(locale, true);
  });

  // ─── Init ─────────────────────────────────────────────────────────
  async function init() {
    await loadPhrases(currentLocale);
    applyLocale(currentLocale);
    await loadExperience();
    if (forceLogin && hostedAuth) {
      const { error } = await hostedAuth.signOut({ scope: 'local' });
      const sessionAlreadyMissing = error && (error.status === 401 || error.name === 'AuthSessionMissingError');
      if (error && !sessionAlreadyMissing) {
        setMessage('error', responseMessage(error, t('networkError')));
      }
      return;
    }
    if (authorizationId && hostedAuth) {
      try {
        const magicLinkSession = await hostedAuth.consumeMagicLinkSessionFromUrl();
        if (magicLinkSession && magicLinkSession.access_token) {
          await continueAuthorization(magicLinkSession.access_token);
          return;
        }
      } catch (error) {
        setMessage('error', responseMessage(error, t('loginFailed')));
        return;
      }
      const { data, error } = await hostedAuth.getSession();
      if (!error && data && data.session && data.session.access_token) {
        await continueAuthorization(data.session.access_token);
      }
    }
  }
  init();
