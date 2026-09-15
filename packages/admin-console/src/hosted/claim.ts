import { requiredElement, requiredInput, htmlElements, errorRecord, textValue } from "./dom.js";
import {
  sdkEndpoints, readContract, decodeSchema, ClaimConfigSchema, ClaimConfigResponseSchema, phraseStrings,
  ClaimInputSchema, ClaimResultSchema, type ClaimConfig, type ClaimResult,
} from './contracts.js';

const apiBase = (window.__SUPAOAUTH_PUBLIC_API_BASE__ || '/v1/public').replace(/\/$/, '');
const params = new URLSearchParams(window.location.search);
const LOCALE_STORAGE_KEY = 'supaoauth.locale';
const defaultMessages: Record<'en' | 'zh-CN', Record<string, string>> = {
  en: {
    documentTitle: 'SupaOAuth Account Claim',
    title: 'Claim SupAuth account',
    leadInitial: 'Enter your numeric ID to claim your account.',
    leadSetPassword: 'Enter your numeric ID to set your login password.',
    externalId: 'Numeric ID',
    newPassword: 'Set login password',
    confirmPassword: 'Confirm login password',
    submitInitial: 'Find account',
    submitSetPassword: 'Claim account and set password',
    loading: 'Searching...',
    email: 'Login email',
    initialPassword: 'Initial password',
    copyEmail: 'Copy email',
    copyPassword: 'Copy password',
    footerInitial: 'The initial password is shown only once. Future lookups only show the email.',
    footerSetPassword: 'After the password is set, sign in with your login email and new password.',
    required: 'Enter your numeric ID.',
    passwordTooShort: 'Password must be at least {min} characters.',
    passwordRequiresUppercase: 'Password must include an uppercase letter.',
    passwordRequiresLowercase: 'Password must include a lowercase letter.',
    passwordRequiresNumber: 'Password must include a number.',
    passwordRequiresSymbol: 'Password must include a symbol.',
    passwordPolicyLength: 'Password requirements: at least {min} characters.',
    passwordPolicyCharacters: 'Password requirements: at least {min} characters and {requirements}.',
    passwordRequirementUppercase: 'an uppercase letter',
    passwordRequirementLowercase: 'a lowercase letter',
    passwordRequirementNumber: 'a number',
    passwordRequirementSymbol: 'a symbol',
    weakPassword: 'Password does not meet the current password policy.',
    passwordMismatch: 'The two passwords do not match.',
    claimSuccessSetPassword: 'Account claimed. Your password has been set. Sign in with the new password.',
    claimSuccessInitial: 'Account claimed. Please sign in and change your password soon.',
    claimRejected: 'The account cannot be claimed with the supplied credentials.',
    copiedEmail: 'Email copied.',
    copiedPassword: 'Password copied.',
    tooManyAttempts: 'Too many attempts. Please try again later.',
    claimUnavailable: 'Account claiming configuration is temporarily unavailable. Please try again later.',
    claimDisabled: 'Account claiming is currently disabled.',
    serverError: 'The system cannot complete the lookup right now. Please try again later or contact an administrator.',
    invalidRequest: 'Enter your numeric ID.',
    networkError: 'Lookup failed. Please try again later.',
  },
  'zh-CN': {
    documentTitle: 'SupaOAuth 账号领取',
    title: '领取 SupAuth 账号',
    leadInitial: '输入数字 ID，领取你的账号。',
    leadSetPassword: '输入数字 ID，设置登录密码。',
    externalId: '数字 ID',
    newPassword: '设置登录密码',
    confirmPassword: '确认登录密码',
    submitInitial: '查询账号',
    submitSetPassword: '领取账号并设置密码',
    loading: '查询中...',
    email: '登录邮箱',
    initialPassword: '初始密码',
    copyEmail: '复制邮箱',
    copyPassword: '复制密码',
    footerInitial: '初始密码只展示一次。再次查询时只会显示邮箱。',
    footerSetPassword: '密码设置成功后，请使用登录邮箱和新密码登录。',
    required: '请填写数字 ID。',
    passwordTooShort: '密码至少需要 {min} 个字符。',
    passwordRequiresUppercase: '密码必须包含大写字母。',
    passwordRequiresLowercase: '密码必须包含小写字母。',
    passwordRequiresNumber: '密码必须包含数字。',
    passwordRequiresSymbol: '密码必须包含特殊符号。',
    passwordPolicyLength: '密码要求：至少 {min} 个字符。',
    passwordPolicyCharacters: '密码要求：至少 {min} 个字符，并包含{requirements}。',
    passwordRequirementUppercase: '大写字母',
    passwordRequirementLowercase: '小写字母',
    passwordRequirementNumber: '数字',
    passwordRequirementSymbol: '特殊符号',
    weakPassword: '密码不符合当前密码策略要求。',
    passwordMismatch: '两次输入的密码不一致。',
    claimSuccessSetPassword: '账号领取成功，密码已设置。请使用新密码登录。',
    claimSuccessInitial: '账号领取成功，请尽快登录并修改密码。',
    claimRejected: '无法使用当前凭据领取账号。',
    copiedEmail: '邮箱已复制。',
    copiedPassword: '密码已复制。',
    tooManyAttempts: '查询次数过多，请稍后再试。',
    claimUnavailable: '账号领取配置暂时不可用，请稍后重试。',
    claimDisabled: '账号领取功能当前未启用。',
    serverError: '系统暂时无法完成查询，请稍后重试或联系管理员。',
    invalidRequest: '请填写数字 ID。',
    networkError: '查询失败，请稍后重试。',
  },
};
const phraseOverrides: Record<string, Record<string, string>> = {};
let currentLocale = detectLocale();
let hasCustomPageTitle = false;
const brand = requiredElement("#brand", "section");
const brandMark = requiredElement("#brand-mark", "div");
const logo = requiredElement("#logo", "img");
const title = requiredElement("#claim-title", "h1");
const form = requiredElement("#claim-form", "form");
const submit = requiredElement("#submit", "button");
const lead = requiredElement("#claim-lead", "p");
const footer = requiredElement("#claim-footer", "p");
const message = requiredElement("#message", "div");
const result = requiredElement("#result", "div");
const emailEl = requiredElement("#email", "div");
const passwordRow = requiredElement("#password-row", "div");
const passwordEl = requiredElement("#password", "div");
const passwordFields = requiredElement("#password-fields", "div");
const passwordPolicyHint = requiredElement("#password-policy-hint", "p");
const newPasswordInput = requiredElement("#new-password", "input");
const confirmPasswordInput = requiredElement("#confirm-password", "input");
let claimConfig: ClaimConfig = {
  enabled: false,
  external_type: 'employee',
  password: {
    mode: 'show_initial_password',
    min_length: 8,
    require_uppercase: false,
    require_lowercase: false,
    require_numbers: false,
    require_symbols: false,
  },
  phrases: {},
};

function setMessage(kind: string, text: string) {
  message.className = `message active ${kind}`;
  message.textContent = text;
}

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
  return [...uiLocales, stored, ...browserLocales, 'zh-CN', 'en'];
}

function detectLocale(): 'en' | 'zh-CN' {
  for (const candidate of localeCandidates()) {
    const locale = normalizeLocale(candidate);
    if (locale && defaultMessages[locale]) return locale;
  }
  return 'zh-CN';
}

function formatMessage(message: string, values: Record<string, string | number> = {}) {
  return String(message).replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

function t(key: string, values?: Record<string, string | number>): string {
  const message = phraseOverrides[currentLocale]?.[key]
    || defaultMessages[currentLocale][key]
    || defaultMessages.en[key]
    || key;
  return formatMessage(message, values);
}

function mergePhraseOverrides(phrases: ClaimConfig['phrases']) {
  if (!phrases || typeof phrases !== 'object') return;
  for (const [locale, messages] of Object.entries(phrases)) {
    const normalized = normalizeLocale(locale);
    if (!normalized || !messages || typeof messages !== 'object') continue;
    phraseOverrides[normalized] = {
      ...(phraseOverrides[normalized] || {}),
      ...messages,
    };
  }
}

function applyClaimCopy() {
  const mustSetPassword = claimConfig.password.mode === 'set_on_claim';
  passwordFields.hidden = !mustSetPassword;
  newPasswordInput.required = mustSetPassword;
  confirmPasswordInput.required = mustSetPassword;
  newPasswordInput.minLength = mustSetPassword ? claimConfig.password.min_length : 0;
  confirmPasswordInput.minLength = mustSetPassword ? claimConfig.password.min_length : 0;
  passwordPolicyHint.hidden = !mustSetPassword;
  passwordPolicyHint.textContent = mustSetPassword ? passwordPolicyHintText() : '';
  submit.disabled = !claimConfig.enabled;
  submit.textContent = mustSetPassword ? t('submitSetPassword') : t('submitInitial');
  lead.textContent = mustSetPassword ? t('leadSetPassword') : t('leadInitial');
  footer.textContent = mustSetPassword ? t('footerSetPassword') : t('footerInitial');
}

function passwordPolicyRequirementLabels() {
  const labels: string[] = [];
  const password = claimConfig.password;
  if (password.require_uppercase) labels.push(t('passwordRequirementUppercase'));
  if (password.require_lowercase) labels.push(t('passwordRequirementLowercase'));
  if (password.require_numbers) labels.push(t('passwordRequirementNumber'));
  if (password.require_symbols) labels.push(t('passwordRequirementSymbol'));
  return labels;
}

function passwordPolicyHintText() {
  const requirements = passwordPolicyRequirementLabels();
  if (!requirements.length) return t('passwordPolicyLength', { min: claimConfig.password.min_length });
  const separator = currentLocale === 'zh-CN' ? '、' : ', ';
  return t('passwordPolicyCharacters', {
    min: claimConfig.password.min_length,
    requirements: requirements.join(separator),
  });
}

function applyLocale(locale: string, persist = false) {
  currentLocale = normalizeLocale(locale) ?? 'zh-CN';
  document.documentElement.lang = currentLocale;
  requiredElement("#language", "select").value = currentLocale;
  if (!hasCustomPageTitle) {
    document.title = t('documentTitle');
    title.textContent = t('title');
    brand.setAttribute('aria-label', t('title'));
    brandMark.textContent = brandInitials(t('title'));
  }
  requiredElement("#external-id-label", "label").textContent = t('externalId');
  requiredElement("#new-password-label", "label").textContent = t('newPassword');
  requiredElement("#confirm-password-label", "label").textContent = t('confirmPassword');
  requiredElement('#result .row:first-child .key', 'div').textContent = t('email');
  requiredElement('#password-row .key', 'div').textContent = t('initialPassword');
  requiredElement("#copy-email", "button").textContent = t('copyEmail');
  requiredElement("#copy-password", "button").textContent = t('copyPassword');
  applyClaimCopy();
  if (persist) localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
}

async function loadPhrases(locale: string) {
  try {
    const response = await fetch(`${apiBase}/phrases/${encodeURIComponent(locale)}`);
    if (!response.ok) return;
    const data = await readContract(response, sdkEndpoints.getPublicPhrases.result);
    if (data && data.phrases && typeof data.phrases === 'object') {
      phraseOverrides[locale] = {
        ...(phraseOverrides[locale] || {}),
        ...phraseStrings(data.phrases),
      };
    }
  } catch {}
}

function brandInitials(text: string) {
  const value = String(text || '').trim();
  if (!value) return 'SA';
  const letters = value.match(/[A-Za-z0-9]/g);
  if (letters && letters.length) return letters.slice(0, 2).join('').toUpperCase();
  return Array.from(value).slice(0, 2).join('');
}

async function loadExperience() {
  try {
    const response = await fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: 'include' });
    if (!response.ok) return;
    const experience = await readContract(response, sdkEndpoints.resolvePublicSignInExperience.result);
    const branding = experience && typeof experience === 'object' ? experience.branding || {} : {};
    if (branding.page_title) {
      hasCustomPageTitle = true;
      document.title = branding.page_title;
      title.textContent = branding.page_title;
      brand.setAttribute('aria-label', branding.page_title);
      brandMark.textContent = brandInitials(branding.page_title);
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
    if (branding.custom_css) {
      requiredElement("#custom-style", "style").textContent = branding.custom_css;
    }
  } catch {}
}

function applyClaimConfig(config: unknown) {
  const next = decodeSchema(ClaimConfigSchema, config);
  const password = next.password;
  claimConfig = {
    enabled: next.enabled === true,
    external_type: typeof next.external_type === 'string' && next.external_type ? next.external_type : 'employee',
    password: {
      mode: password.mode === 'set_on_claim' ? 'set_on_claim' : 'show_initial_password',
      min_length: Number.isFinite(Number(password.min_length)) ? Math.max(6, Number(password.min_length)) : 8,
      require_uppercase: password.require_uppercase === true,
      require_lowercase: password.require_lowercase === true,
      require_numbers: password.require_numbers === true,
      require_symbols: password.require_symbols === true,
    },
    phrases: next.phrases && typeof next.phrases === 'object' ? next.phrases : {},
  };
  mergePhraseOverrides(claimConfig.phrases);
  applyLocale(currentLocale);
}

async function loadClaimConfig() {
  try {
    const response = await fetch(`${apiBase}/account-claims/config`, { credentials: 'include' });
    if (!response.ok) throw new Error('Account claim configuration unavailable');
    const data = await readContract(response, ClaimConfigResponseSchema);
    if (!response.ok || !data || !data.config) throw new Error('Account claim configuration unavailable');
    applyClaimConfig(data.config);
    if (!claimConfig.enabled) setMessage('error', t('claimDisabled'));
  } catch {
    claimConfig.enabled = false;
    submit.disabled = true;
    setMessage('error', t('claimUnavailable'));
  }
}

function clearResult() {
  result.classList.remove('active');
  emailEl.textContent = '';
  passwordEl.textContent = '';
  passwordRow.style.display = '';
}

function showResult(data: ClaimResult) {
  emailEl.textContent = data.email || '';
  if (data.password_set) {
    passwordRow.style.display = 'none';
    setMessage('success', t('claimSuccessSetPassword'));
  } else if (data.initial_password) {
    passwordRow.style.display = '';
    passwordEl.textContent = data.initial_password;
    setMessage('success', t('claimSuccessInitial'));
  } else {
    passwordRow.style.display = 'none';
    setMessage('muted', t('claimRejected'));
  }
  result.classList.add('active');
}

async function copyText(targetId: string | null) {
  const target = targetId === 'password' ? passwordEl : emailEl;
  const text = (target.textContent ?? '').trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setMessage('success', targetId === 'password' ? t('copiedPassword') : t('copiedEmail'));
}

function passwordPolicyViolation(password: string) {
  const policy = claimConfig.password;
  if (password.length < policy.min_length) return 'passwordTooShort';
  if (policy.require_uppercase && !/[A-Z]/.test(password)) return 'passwordRequiresUppercase';
  if (policy.require_lowercase && !/[a-z]/.test(password)) return 'passwordRequiresLowercase';
  if (policy.require_numbers && !/[0-9]/.test(password)) return 'passwordRequiresNumber';
  if (policy.require_symbols && !/[!@#$%^&*()_+\-=\[\]{};'\\:"|<>?,./`~]/.test(password)) {
    return 'passwordRequiresSymbol';
  }
  return null;
}

function passwordPolicyErrorMessage(code: string) {
  if (code === 'password_too_short') return t('passwordTooShort', { min: claimConfig.password.min_length });
  if (code === 'password_requires_uppercase') return t('passwordRequiresUppercase');
  if (code === 'password_requires_lowercase') return t('passwordRequiresLowercase');
  if (code === 'password_requires_number') return t('passwordRequiresNumber');
  if (code === 'password_requires_symbol') return t('passwordRequiresSymbol');
  return t('weakPassword');
}

function claimErrorMessage(response: Response, data: unknown = {}) {
  const code = textValue(errorRecord(errorRecord(data)["error"])["code"]);
  if (['password_too_short', 'password_requires_uppercase', 'password_requires_lowercase', 'password_requires_number', 'password_requires_symbol', 'weak_password'].includes(code)) {
    return passwordPolicyErrorMessage(code);
  }
  if (response.status === 429) return t('tooManyAttempts');
  if (response.status >= 500) return t('serverError');
  if (response.status === 400) return t('invalidRequest');
  return t('claimRejected');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearResult();
  const externalId = requiredInput(form, "external_id").value.trim();
  if (!externalId) {
    setMessage('error', t('required'));
    return;
  }
  const mustSetPassword = claimConfig.password.mode === 'set_on_claim';
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  const passwordViolation = mustSetPassword ? passwordPolicyViolation(newPassword) : null;
  if (passwordViolation) {
    setMessage('error', t(passwordViolation, { min: claimConfig.password.min_length }));
    return;
  }
  if (mustSetPassword && newPassword !== confirmPassword) {
    setMessage('error', t('passwordMismatch'));
    return;
  }

  submit.disabled = true;
  submit.textContent = t('loading');
  try {
    const payload = {
      external_id: externalId,
      ...(mustSetPassword ? { new_password: newPassword } : {}),
    };
    const response = await fetch(`${apiBase}/account-claims/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decodeSchema(ClaimInputSchema, payload)),
    });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setMessage('error', claimErrorMessage(response, data));
      return;
    }
    const data = await readContract(response, ClaimResultSchema);
    showResult(data);
  } catch {
    setMessage('error', t('networkError'));
  } finally {
    submit.disabled = false;
    applyClaimCopy();
  }
});

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', () => copyText(button.getAttribute('data-copy')));
});

requiredElement("#language", "select").addEventListener('change', async (event) => {
  const locale = requiredElement("#language", "select").value;
  await loadPhrases(locale);
  applyLocale(locale, true);
});

(async () => {
  await loadPhrases(currentLocale);
  applyLocale(currentLocale);
  await loadExperience();
  await loadClaimConfig();
})();
