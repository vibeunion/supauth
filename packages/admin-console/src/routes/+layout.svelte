<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    setDataProvider,
    setAuthProvider,
    setResources,
  } from '@svadmin/core';
  import { supaoauthDataProvider } from '$lib/providers/data.js';
  import { adminSsoEnabled, supaoauthAuthProvider } from '$lib/providers/auth.js';
  import { supaoauthResources } from '$lib/providers/resources.js';
  import AdminLayout from '../layouts/AdminLayout.svelte';
  import '../app.css';

  let { children } = $props();
  let initialized = $state(false);
  let checkingAuth = $state(true);
  let authError = $state(null);

  onMount(() => {
    setDataProvider(supaoauthDataProvider);
    setAuthProvider(supaoauthAuthProvider);
    setResources(supaoauthResources);

    (async () => {
      const result = await supaoauthAuthProvider.check();
      if (result.authenticated) {
        initialized = true;
        checkingAuth = false;
        return;
      }

      if (!adminSsoEnabled) {
        authError = 'Admin SSO is not configured for this console session.';
        checkingAuth = false;
        return;
      }

      const loginResult = await supaoauthAuthProvider.login({});
      if (loginResult.redirectTo) {
        await goto(loginResult.redirectTo);
        return;
      }

      authError = loginResult.error?.message || 'Unauthorized';
      checkingAuth = false;
    })().catch((error) => {
      authError = error instanceof Error ? error.message : 'Unauthorized';
      checkingAuth = false;
    });
  });
</script>

{#if checkingAuth}
  <div class="min-h-screen grid place-items-center bg-surface-50 text-sm text-surface-500">
    Checking admin session...
  </div>
{:else if authError}
  <div class="min-h-screen grid place-items-center bg-surface-50 px-6">
    <div class="w-full max-w-sm rounded-lg border border-surface-200 bg-white p-6 text-center shadow-sm">
      <h1 class="text-lg font-semibold text-surface-900">Admin login required</h1>
      <p class="mt-2 text-sm text-surface-500">{authError}</p>
    </div>
  </div>
{:else if initialized}
  <AdminLayout>
    {@render children()}
  </AdminLayout>
{/if}
