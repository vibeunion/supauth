import { requiredElement, requiredInput, htmlElements, errorRecord, textValue } from "./dom.js";
import {
  sdkEndpoints, readContract, decodeSchema, AccountConfigSchema, AccountConfigResponseSchema,
  accountResponses, validateAccountRequest, type AccountConfig, type ProviderLinking,
  type Branding, type AccountUser, type AccountItem, type Enrollment,
} from './contracts.js';
import type { Static, TSchema } from '@supauth/shared';
import type { AuthChangeEvent, Session } from '@supabase/auth-js';

type UrlValidation = { ok: true; url: string | null } | { ok: false };
type AccountModule = {
  name: string; path: string; list: HTMLElement; emptyText: string; action: string;
};

const apiBase = (window.__SUPAOAUTH_PUBLIC_API_BASE__ || '/v1/public').replace(/\/$/, '');
const HOSTED_LOOPBACK_AUTHORITY_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3})(?::\d{1,5})?$/i;
const HOSTED_IPV4_OCTET_PATTERN = /^(?:0|[1-9]\d{0,2})$/;
const hostedAuth = window.SupaOAuthHostedAuth;
const brand = requiredElement('#brand', 'section');
const brandMark = requiredElement("#brand-mark", "div");
const logo = requiredElement("#logo", "img");
const title = requiredElement("#account-title", "h1");
const lead = requiredElement("#account-lead", "p");
const loadAccountButton = requiredElement("#load-account", "button");
const logoutButtons = htmlElements('[data-logout-scope]');
const accountStatusNote = requiredElement("#account-status-note", "span");
const message = requiredElement("#account-message", "div");
const profileDetails = requiredElement("#profile-details", "div");
const profileForm = requiredElement("#profile-form", "form");
const profileEmail = requiredElement("#profile-email", "span");
const profilePhone = requiredElement("#profile-phone", "span");
const profileId = requiredElement("#profile-id", "span");
const profileName = requiredElement("#profile-name", "span");
const profileNameInput = requiredElement("#profile-name-input", "input");
const moduleGrid = requiredElement("#module-grid", "div");
const accountPanel = requiredElement("#account-panel", "section");
const accountSectionGrid = requiredElement('.account-section-grid', 'section');
const grantsList = requiredElement("#grants-list", "ul");
const identitiesList = requiredElement("#identities-list", "ul");
const identityLinkForm = requiredElement("#identity-link-form", "form");
const identityLinkProvider = requiredElement("#identity-link-provider", "select");
const mfaList = requiredElement("#mfa-list", "ul");
const startTotpEnrollButton = requiredElement("#start-totp-enroll", "button");
const totpEnroll = requiredElement("#totp-enroll", "div");
const totpQr = requiredElement("#totp-qr", "img");
const totpUri = requiredElement("#totp-uri", "div");
const totpVerifyForm = requiredElement("#totp-verify-form", "form");
const totpCodeInput = requiredElement("#totp-code", "input");
const emailForm = requiredElement("#email-form", "form");
const phoneForm = requiredElement("#phone-form", "form");
const emailInput = requiredElement("#email-input", "input");
const phoneInput = requiredElement("#phone-input", "input");
const deleteAccountForm = requiredElement("#delete-account-form", "form");
const deleteConfirmationInput = requiredElement("#delete-confirmation", "input");
const deleteAccountLinkWrap = requiredElement("#delete-account-link-wrap", "p");
const deleteAccountLink = requiredElement("#delete-account-link", "a");
let pendingTotpFactorId = '';
let accountConfigLoaded = false;
let accountConfig: AccountConfig = {
  enabled: false,
  profile: { edit_mode: 'read_only', fields: ['name', 'email', 'phone'] },
  security: {
    password_change: true,
    mfa: false,
    email_change: false,
    phone_change: false,
  },
  grants: { enabled: false },
  identities: { enabled: false },
  delete_account: { enabled: false, url: null },
};
let providerLinkingCapability: ProviderLinking = {
  available: false,
  providers: [],
  redirect_to: null,
};

function isCanonicalIpv4Loopback(hostname: string) {
  const octets = hostname.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.slice(1).every((octet) => HOSTED_IPV4_OCTET_PATTERN.test(octet) && Number(octet) <= 255);
}

function isLiteralLoopbackAuthority(authority: string) {
  if (/^\[::1\](?::\d{1,5})?$/i.test(authority)) return true;
  if (!HOSTED_LOOPBACK_AUTHORITY_PATTERN.test(authority)) return false;
  const hostname = authority.replace(/:\d{1,5}$/, '');
  return hostname.toLowerCase() === 'localhost' || isCanonicalIpv4Loopback(hostname);
}

function authorityFromExternalUrl(urlInput: string) {
  const schemeSeparator = urlInput.indexOf('://');
  if (schemeSeparator < 0) return '';
  return urlInput.slice(schemeSeparator + 3).split(/[/?#]/, 1)[0] ?? '';
}

function isExplicitExternalUrl(urlCandidate: string) {
  return /^https?:\/\//i.test(urlCandidate)
    && !/[\u0000-\u001f\u007f]/.test(urlCandidate)
    && !urlCandidate.includes('#')
    && !urlCandidate.includes('\\');
}

function hostedPageUsesLocalEnvironment() {
  return typeof window.location?.host === 'string'
    && isLiteralLoopbackAuthority(window.location.host);
}

function parseExternalDeleteAccountUrl(urlCandidate: string): UrlValidation {
  try {
    const externalUrl = new URL(urlCandidate);
    const authority = authorityFromExternalUrl(urlCandidate);
    if (authority.includes('@') || externalUrl.username || externalUrl.password || externalUrl.hash) {
      return { ok: false };
    }
    if (externalUrl.protocol === 'https:') return { ok: true, url: externalUrl.toString() };
    return hostedPageUsesLocalEnvironment() && isLiteralLoopbackAuthority(authority)
      ? { ok: true, url: externalUrl.toString() }
      : { ok: false };
  } catch (error) {
    if (error instanceof TypeError) return { ok: false };
    throw error;
  }
}

function validateExternalDeleteAccountUrl(urlInput: unknown): UrlValidation {
  if (urlInput === null || urlInput === undefined || (typeof urlInput === 'string' && !urlInput.trim())) {
    return { ok: true, url: null };
  }
  if (typeof urlInput !== 'string') return { ok: false };
  const urlCandidate = urlInput.trim();
  return isExplicitExternalUrl(urlCandidate)
    ? parseExternalDeleteAccountUrl(urlCandidate)
    : { ok: false };
}

function sanitizedDeleteAccountConfig(deleteAccount: AccountConfig['delete_account']) {
  const urlValidation = validateExternalDeleteAccountUrl(deleteAccount.url);
  return urlValidation.ok
    ? { ...deleteAccount, url: urlValidation.url }
    : { ...deleteAccount, enabled: false, url: null };
}

function applyBranding(branding: Branding | null) {
  if (!branding) return;

  if (branding.page_title) {
    document.title = `${branding.page_title} 账户中心`;
    brand.setAttribute('aria-label', branding.page_title);
    if (lead) lead.textContent = `管理你的 ${branding.page_title} 账号资料、安全设置、应用授权和登录身份。`;
  }

  if (branding.primary_color) {
    document.documentElement.style.setProperty('--brand', branding.primary_color);
    document.documentElement.style.setProperty('--brand-dark', branding.primary_color);
  }

  if (branding.logo_url) {
    logo.src = branding.logo_url;
    logo.style.display = 'block';
    brandMark.style.display = 'none';
  }

  if (branding.background_url) {
    document.body.classList.add('has-bg');
    document.body.style.backgroundImage = `url("${branding.background_url}")`;
  }

  if (branding.custom_css) {
    requiredElement("#custom-style", "style").textContent = branding.custom_css;
  }
}

function moduleEnabled(name: string | null) {
  if (name === 'profile') return accountConfig.profile && accountConfig.profile.edit_mode !== 'disabled';
  if (name === 'security') return accountConfig.security && accountConfig.security.password_change;
  if (name === 'grants') return accountConfig.grants && accountConfig.grants.enabled;
  if (name === 'identities') return accountConfig.identities && accountConfig.identities.enabled;
  if (name === 'mfa') return accountConfig.security && accountConfig.security.mfa;
  if (name === 'contact') return accountConfig.security && (accountConfig.security.email_change || accountConfig.security.phone_change);
  if (name === 'delete-account') return accountConfig.delete_account && accountConfig.delete_account.enabled;
  return true;
}

function applyProviderLinkingCapability(capability: ProviderLinking | undefined) {
  const capabilityPayload: Partial<ProviderLinking> = capability?.available === true ? capability : {};
  providerLinkingCapability = {
    available: capabilityPayload.available === true,
    providers: Array.isArray(capabilityPayload.providers)
      ? capabilityPayload.providers.filter((provider) => typeof provider === 'string')
      : [],
    redirect_to: typeof capabilityPayload.redirect_to === 'string' ? capabilityPayload.redirect_to : null,
  };
  identityLinkProvider.replaceChildren();
  for (const provider of providerLinkingCapability.providers) {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = provider;
    identityLinkProvider.appendChild(option);
  }
  identityLinkForm.hidden = !moduleEnabled('identities')
    || !providerLinkingCapability.available
    || providerLinkingCapability.providers.length === 0
    || !providerLinkingCapability.redirect_to;
}

function applyAccountConfig(config: unknown, capabilities: { provider_linking: ProviderLinking } | undefined) {
  const next = decodeSchema(AccountConfigSchema, config);
  const deleteAccount = sanitizedDeleteAccountConfig({
    ...accountConfig.delete_account,
    ...(next.delete_account || {}),
  });
  accountConfig = {
    ...accountConfig,
    ...next,
    profile: { ...accountConfig.profile, ...(next.profile || {}) },
    security: { ...accountConfig.security, ...(next.security || {}) },
    grants: { ...accountConfig.grants, ...(next.grants || {}) },
    identities: { ...accountConfig.identities, ...(next.identities || {}) },
    delete_account: deleteAccount,
  };
  if (!accountConfig.enabled) {
    accountPanel.hidden = true;
    accountSectionGrid.hidden = true;
    setMessage('error', '账号中心当前未启用。');
    return;
  }

  accountPanel.hidden = false;
  accountSectionGrid.hidden = false;
  applyProviderLinkingCapability(capabilities && capabilities.provider_linking);

  htmlElements('[data-section]').forEach((element) => {
    const section = element.getAttribute('data-section');
    element.hidden = !moduleEnabled(section);
  });
  htmlElements('[data-module]').forEach((element) => {
    const moduleName = element.getAttribute('data-module');
    element.hidden = !moduleEnabled(moduleName);
  });

  profileForm.hidden = !(accountConfig.profile && accountConfig.profile.edit_mode === 'editable');
  emailForm.hidden = !(accountConfig.security && accountConfig.security.email_change);
  phoneForm.hidden = !(accountConfig.security && accountConfig.security.phone_change);
  deleteAccountForm.hidden = !accountConfig.delete_account?.enabled || !!accountConfig.delete_account.url;
  if (accountConfig.delete_account && accountConfig.delete_account.url) {
    deleteAccountLink.href = accountConfig.delete_account.url;
    deleteAccountLinkWrap.hidden = false;
  } else {
    deleteAccountLink.removeAttribute('href');
    deleteAccountLinkWrap.hidden = true;
  }
  applyProfileFields();
}

function applyProfileFields() {
  const fields = new Set((accountConfig.profile && accountConfig.profile.fields) || ['name', 'email', 'phone']);
  fields.add('id');
  htmlElements('[data-profile-field]').forEach((element) => {
    element.hidden = !fields.has(element.getAttribute('data-profile-field') ?? '');
  });
}

async function loadAccountConfig() {
  accountConfigLoaded = false;
  try {
    const response = await fetch(`${apiBase}/account/config`, { credentials: 'include' });
    if (!response.ok) {
      setMessage('error', '无法加载账户中心功能配置。');
      return false;
    }
    const configResponse = await readContract(response, AccountConfigResponseSchema);
    if (!response.ok
      || !configResponse
      || !configResponse.config
      || typeof configResponse.config !== 'object'
      || Array.isArray(configResponse.config)) {
      setMessage('error', '无法加载账户中心功能配置。');
      return false;
    }
    applyAccountConfig(configResponse.config, configResponse.capabilities);
    accountConfigLoaded = true;
    return accountConfig.enabled;
  } catch {
    accountConfigLoaded = false;
    setMessage('error', '无法连接账户中心配置服务。');
    return false;
  }
}

function setMessage(type: string, text: string) {
  message.className = `message active ${type}`;
  message.textContent = text;
}

function clearMessage() {
  message.className = 'message';
  message.textContent = '';
}

function resetAccountView() {
  profileDetails.classList.remove('active');
  profileForm.classList.remove('active');
  moduleGrid.classList.remove('active');
  resetTotpEnrollment();
}

function showSignedOutState() {
  accountStatusNote.textContent = '未检测到登录状态。请先登录，登录完成后会自动回到账户中心。';
  setMessage('info', '请先登录后再管理账号。');
}

function showLoadingState() {
  accountStatusNote.textContent = '正在加载账号资料。';
}

function showLoadedState() {
  accountStatusNote.textContent = '已加载当前账号，可在下方查看和管理资料。';
}

function showPartiallyLoadedState() {
  accountStatusNote.textContent = '账号资料已加载，但部分账号项目暂时不可用。';
}

function readableError(error: unknown, fallback: string) {
  const code = textValue(errorRecord(error)["code"]);
  if (['session_missing', 'refresh_failed', 'invalid_token'].includes(code)) {
    return '登录状态已失效，请重新登录。';
  }
  return fallback;
}

function authErrorEndsSession(error: unknown) {
  return ['session_missing', 'refresh_failed'].includes(textValue(errorRecord(error)["code"]));
}

function displayUser(user: AccountUser) {
  const metadata = user && user.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : {};
  const name = textValue(metadata["name"]) || textValue(metadata["full_name"]) || textValue(metadata["display_name"]);
  profileEmail.textContent = user.email || '-';
  profilePhone.textContent = user.phone || '-';
  profileId.textContent = user.id || '-';
  profileName.textContent = name || '-';
  profileNameInput.value = name || '';
  emailInput.value = user.email || '';
  phoneInput.value = user.phone || '';
  profileDetails.classList.add('active');
  if (accountConfig.profile && accountConfig.profile.edit_mode === 'editable') {
    profileForm.classList.add('active');
  }
  moduleGrid.classList.add('active');
}

function itemLabel(item: AccountItem, fallback: string) {
  if (!item || typeof item !== 'object') return fallback;
  const client = item.client && typeof item.client === 'object' ? item.client : {};
  return client.name || client.id || item.name || item.display_name || item.email || item.provider || item.id || fallback;
}

  function itemId(item: AccountItem) {
    if (!item || typeof item !== 'object') return '';
    const client = item.client && typeof item.client === 'object' ? item.client : {};
    return client.id || item.id || item.identity_id || '';
  }

  function renderModuleList(list: HTMLElement, items: AccountItem[], emptyText: string, action: string) {
    list.innerHTML = '';
    if (!items || items.length === 0) {
      const li = document.createElement('li');
      li.textContent = emptyText;
      list.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const id = itemId(item);
      label.textContent = itemLabel(item, id || '记录');
      li.appendChild(label);
      if (action && id) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset["action"] = action;
        button.dataset["id"] = id;
        button.textContent = action === 'revoke-grant'
            ? '撤销授权'
            : action === 'unlink-identity'
              ? '解绑身份'
              : '解绑 MFA';
        li.appendChild(button);
      }
      list.appendChild(li);
    }
  }

  function resetTotpEnrollment() {
    pendingTotpFactorId = '';
    totpEnroll.classList.remove('active');
    totpQr.hidden = true;
    totpQr.removeAttribute('src');
    totpUri.hidden = true;
    totpUri.textContent = '';
    totpCodeInput.value = '';
  }

  function showTotpEnrollment(enrollment: Enrollment) {
    pendingTotpFactorId = enrollment.factor_id || enrollment.id || '';
    const totp = enrollment.totp;
    const qrCode = typeof totp.qr_code === 'string' ? totp.qr_code : '';
    const uri = typeof totp.uri === 'string' ? totp.uri : '';
    if (qrCode && qrCode.startsWith('data:image/')) {
      totpQr.src = qrCode;
      totpQr.hidden = false;
    } else {
      totpQr.hidden = true;
    }
    if (uri) {
      totpUri.textContent = uri;
      totpUri.hidden = false;
    } else {
      totpUri.hidden = true;
    }
    totpEnroll.classList.add('active');
    totpCodeInput.focus();
  }

class AccountRequestError extends Error {
  readonly sessionEnded: boolean;
  readonly status: number;
  constructor(readonly code: string, message: string, options: { sessionEnded?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'AccountRequestError';
    this.code = code;
    this.sessionEnded = options.sessionEnded === true;
    this.status = options.status || 0;
  }
}

function endAccountSession() {
  resetAccountView();
  showSignedOutState();
}

function accountBffErrorCode(value: unknown) {
  const payload = errorRecord(value);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload["success"] !== false) return '';
  const error = errorRecord(payload["error"]);
  return error && typeof error === 'object' && !Array.isArray(error) && typeof error["code"] === 'string'
    ? error["code"]
    : '';
}

async function bannedAccountResponseError(status: number) {
  let localCleanupFailed = false;
  try {
    const { error: signOutError } = await hostedAuth.signOut({ scope: 'local' });
    localCleanupFailed = !!signOutError;
  } catch {
    localCleanupFailed = true;
  } finally {
    endAccountSession();
  }
  const message = localCleanupFailed
    ? '账号已停用；本地登录状态清理失败，请清除站点数据后重新打开。'
    : '账号已停用，当前设备已退出登录。';
  return new AccountRequestError('user_banned', message, { sessionEnded: true, status });
}

async function accountResponseError(status: number, payload: unknown) {
  if (status === 401) {
    endAccountSession();
    return new AccountRequestError('session_expired', '登录状态已失效，请重新登录。', {
      sessionEnded: true,
      status,
    });
  }
  if (status === 403 && accountBffErrorCode(payload) === 'user_banned') {
    return bannedAccountResponseError(status);
  }
  const message = status >= 500 ? '账号服务暂时不可用，请稍后重试。' : '账号请求失败，请检查后重试。';
  return new AccountRequestError('request_failed', message, { status });
}

function accountNetworkError(error: unknown) {
  if (authErrorEndsSession(error)) {
    endAccountSession();
    return new AccountRequestError('session_expired', '登录状态已失效，请重新登录。', {
      sessionEnded: true,
    });
  }
  const code = textValue(errorRecord(error)["code"]);
  if (error instanceof TypeError || ['session_read_failed', 'refresh_retryable'].includes(code)) {
    return new AccountRequestError('network_error', '账号认证请求失败，请稍后重试。');
  }
  if (code === 'request_not_replayable') {
    return new AccountRequestError('request_invalid', '账号请求无法安全发送，请刷新页面后重试。');
  }
  throw error;
}

function reportAccountFailure(error: unknown, fallback: string) {
  const text = error instanceof AccountRequestError ? error.message : fallback;
  setMessage('error', text);
}

function accountRequestHeaders(options: RequestInit) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return headers;
}

async function accountResponsePayload<S extends TSchema>(response: Response, schema: S): Promise<Static<S>> {
  const payload: unknown = await response.text().then((text): unknown => JSON.parse(text)).catch(() => null);
  if (!response.ok) throw await accountResponseError(response.status, payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || errorRecord(payload)["success"] === false) {
    throw await accountResponseError(response.status, payload);
  }
  try {
    return decodeSchema(schema, payload);
  } catch {
    throw new AccountRequestError('invalid_response', '账号项目响应无效，请稍后重试。');
  }
}

async function accountFetch<S extends TSchema>(path: string, schema: S, options: RequestInit = {}): Promise<Static<S>> {
  if (!hostedAuth) {
    throw new AccountRequestError('hosted_auth_unavailable', '登录组件加载失败，请刷新页面后重试。');
  }
  let response: Response;
  try {
    validateAccountRequest(path, options);
    response = await hostedAuth.authenticatedFetch(`${apiBase}${path}`, {
      ...options,
      headers: accountRequestHeaders(options),
    });
  } catch (error) {
    throw accountNetworkError(error);
  }
  return accountResponsePayload(response, schema);
}

async function loadAccountContent() {
  const accountPayload = await accountFetch('/account/me', accountResponses.user);
  displayUser(accountPayload.user);
  const moduleState = await loadAccountModules();
  if (!moduleState.ok) {
    showPartiallyLoadedState();
    setMessage('error', '账号资料已加载，但部分账号项目加载失败，请重试。');
    return;
  }
  showLoadedState();
  setMessage('ok', '账号资料已加载。');
}

async function loadAccount() {
  if (!accountConfigLoaded || !accountConfig.enabled) {
    setMessage('error', '无法加载账户中心功能配置。');
    return;
  }
  clearMessage();
  loadAccountButton.disabled = true;
  showLoadingState();
  try {
    await loadAccountContent();
  } catch (error) {
    reportAccountFailure(error, '无法连接账号中心，请稍后重试。');
  } finally {
    loadAccountButton.disabled = false;
  }
}

async function saveProfile(event: Event) {
  event.preventDefault();
  clearMessage();
  const name = profileNameInput.value.trim();
  if (!name) {
    setMessage('error', '请输入显示名称。');
    return;
  }
  const saveButton = requiredElement("#save-profile", "button");
  saveButton.disabled = true;
  try {
    const data = await accountFetch('/account/profile', accountResponses.user, {
      method: 'PATCH',
      body: JSON.stringify({ data: { name } }),
    });
    displayUser(data.user);
    setMessage('ok', '资料已更新。');
  } catch (error) {
    reportAccountFailure(error, '无法保存资料，请稍后重试。');
  } finally {
    saveButton.disabled = false;
  }
}

  function enabledAccountModules(): AccountModule[] {
    const modules: AccountModule[] = [];
    if (moduleEnabled('grants')) {
      modules.push({ name: '应用授权', path: '/account/grants', list: grantsList, emptyText: '没有应用授权记录。', action: 'revoke-grant' });
    }
    if (moduleEnabled('identities')) {
      modules.push({ name: '登录身份', path: '/account/identities', list: identitiesList, emptyText: '没有可管理身份。', action: 'unlink-identity' });
    }
    if (accountConfig.security && accountConfig.security.mfa) {
      modules.push({ name: 'MFA 因子', path: '/account/mfa', list: mfaList, emptyText: '没有 MFA 因子。', action: 'unenroll-mfa' });
    }
    return modules;
  }

  async function loadAccountModule(moduleDefinition: AccountModule) {
    const modulePayload = await accountFetch(moduleDefinition.path, accountResponses.items);
    if (!Array.isArray(modulePayload.items)) {
      throw new AccountRequestError('invalid_response', '账号项目响应无效，请稍后重试。');
    }
    return modulePayload.items;
  }

  function renderModuleFailure(moduleDefinition: AccountModule) {
    moduleDefinition.list.innerHTML = '';
    const failure = document.createElement('li');
    failure.textContent = `${moduleDefinition.name}加载失败，请重试。`;
    moduleDefinition.list.appendChild(failure);
  }

  async function loadAccountModules() {
    const accountModules = enabledAccountModules();
    const moduleOutcomes = await Promise.allSettled(accountModules.map(loadAccountModule));
    const blockingFailure = moduleOutcomes.find((outcome) => outcome.status === 'rejected'
      && (!(outcome.reason instanceof AccountRequestError) || outcome.reason.sessionEnded));
    if (blockingFailure && blockingFailure.status === 'rejected') throw blockingFailure.reason;

    const failedModules: string[] = [];
    moduleOutcomes.forEach((outcome, index) => {
      const moduleDefinition = accountModules[index];
      if (!moduleDefinition) throw new Error('Account module outcome has no definition');
      if (outcome.status === 'fulfilled') {
        renderModuleList(moduleDefinition.list, outcome.value, moduleDefinition.emptyText, moduleDefinition.action);
      } else {
        failedModules.push(moduleDefinition.name);
        renderModuleFailure(moduleDefinition);
      }
    });
    return { ok: failedModules.length === 0, failedModules };
  }

  function accountModuleForAction(action: string | undefined) {
    return enabledAccountModules().find((moduleDefinition) => moduleDefinition.action === action) || null;
  }

  async function removeAccountModuleItem(moduleDefinition: AccountModule, id: string) {
    await accountFetch(`${moduleDefinition.path}/${encodeURIComponent(id)}`, accountResponses.mutation, { method: 'DELETE' });
    const items = await loadAccountModule(moduleDefinition);
    renderModuleList(moduleDefinition.list, items, moduleDefinition.emptyText, moduleDefinition.action);
    if (items.some((item) => itemId(item) === id)) {
      throw new AccountRequestError('mutation_not_confirmed', '服务器尚未确认账号项目已移除，请重试。');
    }
  }

  function providerAuthorizationRedirect(candidateUrl: unknown) {
    if (typeof candidateUrl !== 'string') return null;
    try {
      const authorizationUrl = new URL(candidateUrl);
      if (!['http:', 'https:'].includes(authorizationUrl.protocol)
        || authorizationUrl.username
        || authorizationUrl.password) return null;
      return authorizationUrl.toString();
    } catch {
      return null;
    }
  }

  async function startIdentityLink(event: Event) {
    event.preventDefault();
    if (identityLinkForm.hidden || !providerLinkingCapability.redirect_to) {
      setMessage('error', '身份绑定功能当前不可用。');
      return;
    }
    const submitButton = requiredElement('button', 'button', identityLinkForm);
    submitButton.disabled = true;
    try {
      const linkResponse = await accountFetch('/account/identities/authorize', accountResponses.identity, {
        method: 'POST',
        body: JSON.stringify({
          provider: identityLinkProvider.value,
          redirect_to: providerLinkingCapability.redirect_to,
        }),
      });
      const redirectUrl = providerAuthorizationRedirect(linkResponse.authorization && linkResponse.authorization.url);
      if (!redirectUrl) {
        setMessage('error', '认证运行时返回了无效的身份绑定地址。');
        return;
      }
      window.location.assign(redirectUrl);
    } catch (error) {
      reportAccountFailure(error, '无法启动身份绑定，请稍后重试。');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function startTotpEnrollment() {
    clearMessage();
    startTotpEnrollButton.disabled = true;
    try {
      const data = await accountFetch('/account/mfa/totp/enroll', accountResponses.enrollment, {
        method: 'POST',
        body: JSON.stringify({ friendly_name: 'Authenticator app', issuer: document.title || 'SupaOAuth' }),
      });
      if (!data.enrollment) {
        throw new AccountRequestError('invalid_response', '认证服务未返回 MFA 绑定信息，请稍后重试。');
      }
      showTotpEnrollment(data.enrollment);
      setMessage('ok', '请使用 Authenticator 扫描二维码，然后输入动态码完成绑定。');
    } catch (error) {
      reportAccountFailure(error, '无法创建 MFA 绑定，请稍后重试。');
    } finally {
      startTotpEnrollButton.disabled = false;
    }
  }

  async function verifyTotpEnrollment(event: Event) {
    event.preventDefault();
    const code = totpCodeInput.value.trim();
    if (!pendingTotpFactorId || !code) {
      setMessage('error', '请先扫码并输入动态码。');
      return;
    }
    const verifyButton = requiredElement('button', 'button', totpVerifyForm);
    verifyButton.disabled = true;
    try {
      const verificationResponse = await accountFetch(`/account/mfa/${encodeURIComponent(pendingTotpFactorId)}/verify`, accountResponses.verification, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      const mfaSession = verificationResponse.session;
      if (!mfaSession
        || typeof mfaSession !== 'object'
        || typeof mfaSession.access_token !== 'string'
        || typeof mfaSession.refresh_token !== 'string') {
        setMessage('error', '认证服务未返回已升级的 MFA 会话，请重新登录后再试。');
        return;
      }
      const { data: savedSessionData, error: saveSessionError } = await hostedAuth.setSession({
        access_token: mfaSession.access_token,
        refresh_token: mfaSession.refresh_token,
      });
      if (saveSessionError || !savedSessionData?.session?.access_token) {
        setMessage('error', `无法保存 MFA 登录状态：${readableError(saveSessionError, '请重新登录后再试。')}`);
        return;
      }
      resetTotpEnrollment();
      const moduleState = await loadAccountModules();
      if (!moduleState.ok) {
        setMessage('error', 'Authenticator 已绑定，但部分账号项目刷新失败，请重新加载。');
        return;
      }
      setMessage('ok', 'Authenticator 已绑定，当前登录状态已升级。');
    } catch (error) {
      reportAccountFailure(error, '动态码验证失败，请重试。');
    } finally {
      verifyButton.disabled = false;
    }
  }

async function handleModuleAction(event: Event) {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button[data-action]');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return;
  const id = button.dataset["id"];
  const moduleDefinition = accountModuleForAction(button.dataset["action"]);
  if (!id || !moduleDefinition) return;
  button.disabled = true;
  try {
    await removeAccountModuleItem(moduleDefinition, id);
    setMessage('ok', '账号项目已更新。');
  } catch (error) {
    reportAccountFailure(error, '无法更新账号项目，请稍后重试。');
  } finally {
    button.disabled = false;
  }
}

async function updateEmail(event: Event) {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) {
    setMessage('error', '请输入新邮箱。');
    return;
  }
  try {
    const data = await accountFetch('/account/email', accountResponses.user, {
      method: 'PATCH',
      body: JSON.stringify({ email }),
    });
    displayUser(data.user);
    setMessage('ok', '邮箱变更请求已提交，请完成验证。');
  } catch (error) {
    reportAccountFailure(error, '无法提交邮箱变更，请稍后重试。');
  }
}

async function updatePhone(event: Event) {
  event.preventDefault();
  const phone = phoneInput.value.trim();
  if (!phone) {
    setMessage('error', '请输入新手机号。');
    return;
  }
  try {
    const data = await accountFetch('/account/phone', accountResponses.user, {
      method: 'PATCH',
      body: JSON.stringify({ phone }),
    });
    displayUser(data.user);
    setMessage('ok', '手机号变更请求已提交，请完成验证。');
  } catch (error) {
    reportAccountFailure(error, '无法提交手机号变更，请稍后重试。');
  }
}

async function deleteAccount(event: Event) {
  event.preventDefault();
  if (deleteConfirmationInput.value.trim() !== 'DELETE') {
    setMessage('error', '请输入 DELETE 确认注销账号。');
    return;
  }
  try {
    await accountFetch('/account', accountResponses.mutation, {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: 'DELETE' }),
    });
    const { error } = await hostedAuth.signOut();
    resetAccountView();
    showSignedOutState();
    setMessage(error ? 'error' : 'ok', error
      ? `账号已注销；${readableError(error, '本地已退出，但服务端撤销失败。')}`
      : '账号已注销并退出登录。');
  } catch (error) {
    reportAccountFailure(error, '无法注销账号，请稍后重试。');
  }
}

async function signOutAccount(event: Event) {
  if (!hostedAuth) {
    setMessage('error', '登录组件加载失败，请刷新页面后重试。');
    return;
  }
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;
  const scope = button.dataset["logoutScope"];
  if (scope !== 'global' && scope !== 'local' && scope !== 'others') return;
  button.disabled = true;
  try {
    const { error } = await hostedAuth.signOut({ scope });
    if (error) {
      setMessage('error', readableError(error, '认证服务未能完成退出。'));
      return;
    }
    if (scope === 'others') {
      setMessage('ok', '已退出其他设备，当前设备保持登录。');
      return;
    }
    resetAccountView();
    showSignedOutState();
    setMessage('ok', '已安全退出登录。');
  } catch (error) {
    setMessage('error', `退出登录失败：${readableError(error, '未知错误')}`);
  } finally {
    button.disabled = false;
  }
}

function handleAuthStateChange(event: AuthChangeEvent, session: Session | null) {
  if (event === 'TOKEN_REFRESHED' && session) {
    accountStatusNote.textContent = '登录状态已自动续期，可继续管理账号。';
  }
  if (event === 'SIGNED_OUT') {
    resetAccountView();
    showSignedOutState();
  }
}

fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: 'include' })
  .then((response) => response.ok ? readContract(response, sdkEndpoints.resolvePublicSignInExperience.result) : null)
  .then((experience) => {
    const branding = experience && experience.branding ? experience.branding : null;
    applyBranding(branding);
    if (branding && branding.page_title) title.textContent = `${branding.page_title} 账户中心`;
  })
  .catch(() => {});

loadAccountButton.addEventListener('click', loadAccount);
logoutButtons.forEach((button) => button.addEventListener('click', signOutAccount));
profileForm.addEventListener('submit', saveProfile);
  identityLinkForm.addEventListener('submit', startIdentityLink);
  moduleGrid.addEventListener('click', handleModuleAction);
  startTotpEnrollButton.addEventListener('click', startTotpEnrollment);
  totpVerifyForm.addEventListener('submit', verifyTotpEnrollment);
emailForm.addEventListener('submit', updateEmail);
phoneForm.addEventListener('submit', updatePhone);
deleteAccountForm.addEventListener('submit', deleteAccount);

if (hostedAuth) {
  hostedAuth.onAuthStateChange(handleAuthStateChange);
}

(async () => {
  const accountCenterAvailable = await loadAccountConfig();
  if (!accountCenterAvailable) return;
  if (!hostedAuth) {
    setMessage('error', '登录组件加载失败，请刷新页面后重试。');
    return;
  }
  try {
    const { data, error } = await hostedAuth.getSession();
    if (error) {
      resetAccountView();
      setMessage('error', `无法恢复登录状态：${readableError(error, '未知错误')}`);
      return;
    }
    if (data.session) {
      await loadAccount();
    } else {
      showSignedOutState();
    }
  } catch (error) {
    resetAccountView();
    setMessage('error', `无法恢复登录状态：${readableError(error, '未知错误')}`);
  }
})();
