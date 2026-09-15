import { requiredElement, requiredInput, htmlElements, errorRecord, textValue } from "./dom.js";
import {
  parsePasswordPolicy, type PasswordPolicy, sdkEndpoints, readContract,
  decodeSchema, ChangePasswordInputSchema, ChangePasswordResultSchema,
} from './contracts.js';

const apiBase = (window.__SUPAOAUTH_PUBLIC_API_BASE__ || '/v1/public').replace(/\/$/, '');
const brand = requiredElement("#brand", "section");
const brandMark = requiredElement("#brand-mark", "div");
const logo = requiredElement("#logo", "img");
const title = requiredElement("#page-title", "h1");
const form = requiredElement("#password-form", "form");
const submit = requiredElement("#submit", "button");
const message = requiredElement("#message", "div");
const passwordPolicyHint = requiredElement("#password-policy-hint", "p");
const newPasswordInput = requiredElement("#new-password", "input");
const confirmPasswordInput = requiredElement("#confirm-password", "input");
const PASSWORD_POLICY_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
let passwordPolicy: PasswordPolicy | null = null;

function setMessage(kind: string, text: string) {
  message.className = `message active ${kind}`;
  message.textContent = text;
}

function brandInitials(text: string) {
  const value = String(text || '').trim();
  if (!value) return 'SA';
  const letters = value.match(/[A-Za-z0-9]/g);
  if (letters && letters.length) return letters.slice(0, 2).join('').toUpperCase();
  return Array.from(value).slice(0, 2).join('');
}

function normalizeEmail(value: string) {
  return String(value || '').trim().toLowerCase();
}

function passwordPolicyRequirements(policy: PasswordPolicy) {
  const requirements = [`至少 ${policy.min_length} 个字符`];
  if (policy.require_uppercase) requirements.push('一个大写字母');
  if (policy.require_lowercase) requirements.push('一个小写字母');
  if (policy.require_numbers) requirements.push('一个数字');
  if (policy.require_symbols) requirements.push('一个符号');
  return requirements;
}

function applyPasswordPolicy(candidate: unknown) {
  const parsed = parsePasswordPolicy(candidate);
  if (!parsed) return false;
  passwordPolicy = parsed;
  for (const input of [newPasswordInput, confirmPasswordInput]) {
    input.minLength = parsed.min_length;
    input.setAttribute('minlength', String(parsed.min_length));
  }
  passwordPolicyHint.textContent = passwordPolicyRequirements(parsed).join(' · ');
  submit.disabled = false;
  return true;
}

function passwordPolicyError(password: string) {
  if (!passwordPolicy) return '密码策略暂时不可用，当前无法修改密码。';
  if (password.length < passwordPolicy.min_length) return `新密码至少需要 ${passwordPolicy.min_length} 个字符。`;
  if (passwordPolicy.require_uppercase && !/[A-Z]/.test(password)) return '新密码必须包含一个大写字母。';
  if (passwordPolicy.require_lowercase && !/[a-z]/.test(password)) return '新密码必须包含一个小写字母。';
  if (passwordPolicy.require_numbers && !/[0-9]/.test(password)) return '新密码必须包含一个数字。';
  if (passwordPolicy.require_symbols && !Array.from(password).some((character) => PASSWORD_POLICY_SYMBOLS.includes(character))) {
    return '新密码必须包含一个符号。';
  }
  return '';
}

async function loadExperience() {
  try {
    const response = await fetch(`${apiBase}/sign-in-experience/resolve`, { credentials: 'include' });
    if (!response.ok) {
      setMessage('error', '密码策略暂时不可用，当前无法修改密码。');
      return;
    }
    const experience = await readContract(response, sdkEndpoints.resolvePublicSignInExperience.result);
    if (!experience || typeof experience !== 'object' || !applyPasswordPolicy(experience.password_policy)) {
      setMessage('error', '密码策略暂时不可用，当前无法修改密码。');
      return;
    }
    const branding = experience && typeof experience === 'object' ? experience.branding || {} : {};
    if (branding.page_title) {
      document.title = `${branding.page_title} - 修改密码`;
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
  } catch {
    setMessage('error', '密码策略暂时不可用，当前无法修改密码。');
  }
}

function errorMessage(response: Response, data: unknown) {
  const code = textValue(errorRecord(errorRecord(data)["error"])["code"]);
  if (response.status === 429) return '尝试次数过多，请稍后再试。';
  if (code === 'invalid_current_password') return '当前密码不正确，请检查后重试。';
  if (code === 'password_mismatch') return '两次输入的新密码不一致。';
  if (['password_too_short', 'password_requires_uppercase', 'password_requires_lowercase',
    'password_requires_number', 'password_requires_symbol', 'weak_password'].includes(code)) {
    return '新密码不符合密码策略要求。';
  }
  if (code === 'password_unchanged') return '新密码不能与当前密码相同。';
  if (response.status >= 500) return '系统暂时无法修改密码，请稍后重试或联系管理员。';
  return '无法修改密码，请检查输入后重试。';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = normalizeEmail(requiredInput(form, "email").value);
  const currentPassword = requiredInput(form, "current_password").value;
  const newPassword = requiredInput(form, "new_password").value;
  const confirmPassword = requiredInput(form, "confirm_password").value;
  requiredInput(form, "email").value = email;

  if (!passwordPolicy) {
    setMessage('error', '密码策略暂时不可用，当前无法修改密码。');
    return;
  }

  if (!email || !currentPassword || !newPassword || !confirmPassword) {
    setMessage('error', '请填写所有字段。');
    return;
  }
  if (newPassword !== confirmPassword) {
    setMessage('error', '两次输入的新密码不一致。');
    return;
  }
  const policyError = passwordPolicyError(newPassword);
  if (policyError) {
    setMessage('error', policyError);
    return;
  }

  submit.disabled = true;
  submit.textContent = '更新中...';
  try {
    const response = await fetch(`${apiBase}/account-password/change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decodeSchema(ChangePasswordInputSchema, {
        email,
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })),
    });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setMessage('error', errorMessage(response, data));
      return;
    }
    await readContract(response, ChangePasswordResultSchema);
    requiredInput(form, "current_password").value = '';
    requiredInput(form, "new_password").value = '';
    requiredInput(form, "confirm_password").value = '';
    setMessage('success', '密码已更新。下次登录请使用新密码。');
  } catch {
    setMessage('error', '修改密码失败，请稍后重试。');
  } finally {
    submit.disabled = false;
    submit.textContent = '更新密码';
  }
});

loadExperience();
