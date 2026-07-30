<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    setDataProvider,
    setAuthProvider,
    setResources,
  } from '@svadmin/core';
  import { supaoauthDataProvider } from '$lib/providers/data.js';
  import {
    adminSsoEnabled,
    enrollAdminTotp,
    getAdminMfaStepUpState,
    initializeAdminAuthProvider,
    verifyAdminMfaStepUp,
  } from '$lib/providers/auth.js';
  import { supaoauthResources } from '$lib/providers/resources.js';
  import { t } from '$lib/i18n.js';
  import AdminLayout from '../layouts/AdminLayout.svelte';
  import '../app.css';

  let { children } = $props();
  let initialized = $state(false);
  let checkingAuth = $state(true);
  let authError = $state(null);
  let mfaFactors = $state([]);
  let mfaFactorId = $state('');
  let mfaCode = $state('');
  let mfaSubmitting = $state(false);
  let mfaError = $state('');
  let mfaEnrollment = $state(null);
  let mfaEnrollmentRoute = $state(false);
  let activeAuthProvider = null;

  function isMfaRequired(authCheck) {
    return authCheck?.error?.name === 'admin_mfa_required';
  }

  async function showMfaStepUp() {
    const state = await getAdminMfaStepUpState();
    mfaFactors = state.factors;
    mfaFactorId = state.factors[0]?.id || '';
    checkingAuth = false;
  }

  async function finishAuthenticated() {
    initialized = true;
    checkingAuth = false;
    if (window.location.pathname === resolve('/login')) {
      await goto(resolve('/get-started'), { replaceState: true });
      return;
    }
    if (window.location.pathname === resolve('/mfa-enroll')) {
      await goto(resolve('/dashboard'), { replaceState: true });
      return;
    }
  }

  async function continueAfterMfaVerification() {
    const authCheck = await activeAuthProvider.check();
    if (authCheck.authenticated) {
      await finishAuthenticated();
      return true;
    }
    if (isMfaRequired(authCheck)) {
      mfaError = '动态码已验证，但管理员会话尚未提升。请重新登录后重试。';
      return false;
    }
    mfaError = authCheck.error?.message || '无法验证管理员权限，请重新登录后重试。';
    return false;
  }

  async function verifyMfa(event) {
    event.preventDefault();
    if (!activeAuthProvider || !mfaFactorId) return;
    mfaError = '';
    mfaSubmitting = true;
    try {
      await verifyAdminMfaStepUp({ factorId: mfaFactorId, code: mfaCode.replace(/\s+/g, '') });
      await continueAfterMfaVerification();
    } catch (error) {
      mfaError = error instanceof Error ? error.message : '动态码验证失败，请重试。';
    } finally {
      mfaSubmitting = false;
    }
  }

  async function startMfaEnrollment() {
    if (!activeAuthProvider) return;
    mfaError = '';
    mfaSubmitting = true;
    try {
      mfaEnrollment = await enrollAdminTotp({
        friendlyName: 'Admin Console',
        issuer: 'SupaAuth Admin',
      });
    } catch (error) {
      mfaError = error instanceof Error ? error.message : '无法创建 MFA 绑定，请重试。';
    } finally {
      mfaSubmitting = false;
    }
  }

  async function verifyMfaEnrollment(event) {
    event.preventDefault();
    if (!activeAuthProvider || !mfaEnrollment) return;
    mfaError = '';
    mfaSubmitting = true;
    try {
      await verifyAdminMfaStepUp({
        factorId: mfaEnrollment.factorId,
        code: mfaCode.replace(/\s+/g, ''),
      });
      await continueAfterMfaVerification();
    } catch (error) {
      mfaError = error instanceof Error ? error.message : '动态码验证失败，请重试。';
    } finally {
      mfaSubmitting = false;
    }
  }

  onMount(() => {
    setDataProvider(supaoauthDataProvider);
    setResources(supaoauthResources);

    (async () => {
      mfaEnrollmentRoute = window.location.pathname === resolve('/mfa-enroll');
      const authProvider = await initializeAdminAuthProvider();
      activeAuthProvider = authProvider;
      setAuthProvider(authProvider);

      const authCheck = await authProvider.check();
      if (authCheck.authenticated) {
        await finishAuthenticated();
        return;
      }

      if (isMfaRequired(authCheck)) {
        await showMfaStepUp();
        return;
      }

      if (authCheck.error) {
        authError = authCheck.error.message;
        checkingAuth = false;
        return;
      }

      if (!adminSsoEnabled) {
        authError = t('auth.ssoNotConfigured');
        checkingAuth = false;
        return;
      }

      const loginResult = await authProvider.login({});
      if (loginResult.redirectTo) {
        await goto(loginResult.redirectTo);
        return;
      }

      authError = loginResult.error?.message || t('auth.unauthorized');
      checkingAuth = false;
    })().catch((error) => {
      authError = error instanceof Error ? error.message : t('auth.unauthorized');
      checkingAuth = false;
    });
  });
</script>

{#if checkingAuth}
  <div class="min-h-screen grid place-items-center bg-surface-50 text-sm text-surface-500">
    {t('auth.checking')}
  </div>
{:else if authError}
  <div class="min-h-screen grid place-items-center bg-surface-50 px-6">
    <div class="w-full max-w-sm rounded-lg border border-surface-200 bg-white p-6 text-center shadow-sm">
      <h1 class="text-lg font-semibold text-surface-900">{t('auth.requiredTitle')}</h1>
      <p class="mt-2 text-sm text-surface-500">{authError}</p>
    </div>
  </div>
{:else if !initialized && mfaFactors.length === 0 && !mfaEnrollmentRoute}
  <div class="min-h-screen grid place-items-center bg-surface-50 px-6">
    <div class="w-full max-w-sm rounded-lg border border-surface-200 bg-white p-6 text-center shadow-sm">
      <h1 class="text-lg font-semibold text-surface-900">需要双因素认证</h1>
      <p class="mt-2 text-sm text-surface-500">此管理员账号尚未绑定已验证的 Authenticator。</p>
      <a class="mt-4 inline-flex rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white" href={resolve('/mfa-enroll')} data-sveltekit-reload>绑定 MFA</a>
    </div>
  </div>
{:else if !initialized && mfaFactors.length === 0 && mfaEnrollmentRoute}
  <div class="min-h-screen grid place-items-center bg-surface-50 px-6">
    <div class="w-full max-w-sm rounded-lg border border-surface-200 bg-white p-6 text-center shadow-sm">
      <h1 class="text-lg font-semibold text-surface-900">绑定管理员 MFA</h1>
      <p class="mt-2 text-sm text-surface-500">扫描二维码后输入 Authenticator 动态码。验证成功后才会进入管理后台。</p>
      {#if mfaEnrollment}
        <img class="mx-auto mt-5 h-48 w-48 rounded-md border border-surface-200 bg-white p-2" src={mfaEnrollment.qrCode} alt="管理员 TOTP 二维码" />
        <form class="mt-5" onsubmit={verifyMfaEnrollment}>
          <label class="block text-left text-sm font-medium text-surface-700" for="admin-mfa-enrollment-code">动态码</label>
          <input id="admin-mfa-enrollment-code" class="mt-1 w-full rounded-md border border-surface-300 px-3 py-2" bind:value={mfaCode} inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" required disabled={mfaSubmitting} />
          {#if mfaError}<p class="mt-3 text-sm text-red-600">{mfaError}</p>{/if}
          <button class="mt-5 w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" type="submit" disabled={mfaSubmitting}>{mfaSubmitting ? '验证中…' : '验证并进入后台'}</button>
        </form>
      {:else}
        {#if mfaError}<p class="mt-3 text-sm text-red-600">{mfaError}</p>{/if}
        <button class="mt-5 w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" type="button" onclick={startMfaEnrollment} disabled={mfaSubmitting}>{mfaSubmitting ? '创建中…' : '显示二维码'}</button>
      {/if}
    </div>
  </div>
{:else if !initialized}
  <div class="min-h-screen grid place-items-center bg-surface-50 px-6">
    <form class="w-full max-w-sm rounded-lg border border-surface-200 bg-white p-6 shadow-sm" onsubmit={verifyMfa}>
      <h1 class="text-lg font-semibold text-surface-900">验证管理员身份</h1>
      <p class="mt-2 text-sm text-surface-500">请输入 Authenticator 动态码后继续。</p>
      <label class="mt-5 block text-sm font-medium text-surface-700" for="admin-mfa-factor">验证器</label>
      <select id="admin-mfa-factor" class="mt-1 w-full rounded-md border border-surface-300 px-3 py-2" bind:value={mfaFactorId} disabled={mfaSubmitting}>
        {#each mfaFactors as factor (factor.id)}
          <option value={factor.id}>{factor.label}</option>
        {/each}
      </select>
      <label class="mt-4 block text-sm font-medium text-surface-700" for="admin-mfa-code">动态码</label>
      <input id="admin-mfa-code" class="mt-1 w-full rounded-md border border-surface-300 px-3 py-2" bind:value={mfaCode} inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" required disabled={mfaSubmitting} />
      {#if mfaError}<p class="mt-3 text-sm text-red-600">{mfaError}</p>{/if}
      <button class="mt-5 w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" type="submit" disabled={mfaSubmitting}>{mfaSubmitting ? '验证中…' : '验证并继续'}</button>
    </form>
  </div>
{:else if initialized}
  <AdminLayout>
    {@render children()}
  </AdminLayout>
{/if}
