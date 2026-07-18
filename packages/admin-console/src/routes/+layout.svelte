<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    setDataProvider,
    setAuthProvider,
    setResources,
  } from '@svadmin/core';
  import { supaoauthDataProvider } from '$lib/providers/data.js';
  import { adminSsoEnabled, initializeAdminAuthProvider } from '$lib/providers/auth.js';
  import { supaoauthResources } from '$lib/providers/resources.js';
  import { t } from '$lib/i18n.js';
  import AdminLayout from '../layouts/AdminLayout.svelte';
  import '../app.css';

  let { children } = $props();
  let initialized = $state(false);
  let checkingAuth = $state(true);
  let authError = $state(null);

  onMount(() => {
    setDataProvider(supaoauthDataProvider);
    setResources(supaoauthResources);

    (async () => {
      const authProvider = await initializeAdminAuthProvider();
      setAuthProvider(authProvider);

      const result = await authProvider.check();
      if (result.authenticated) {
        initialized = true;
        checkingAuth = false;
        return;
      }

      if (result.error) {
        authError = result.error.message;
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
{:else if initialized}
  <AdminLayout>
    {@render children()}
  </AdminLayout>
{/if}
