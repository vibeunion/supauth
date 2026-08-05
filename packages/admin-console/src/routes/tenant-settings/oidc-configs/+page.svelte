<script>
  import { onMount } from 'svelte';
  import { getDiscovery, getJWKS, getOAuthServerStatus } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';

  let loading = $state(true);
  let error = $state(null);
  let oauthStatus = $state(null);
  let discovery = $state(null);
  let jwks = $state(null);

  onMount(async () => {
    try {
      [oauthStatus, discovery, jwks] = await Promise.all([getOAuthServerStatus(), getDiscovery(), getJWKS()]);
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  });
</script>

<div class="mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t('tenant.oidcTitle')}</h2>
  <p class="mt-1 text-sm text-surface-500">{t('tenant.oidcDescription')}</p>
</div>

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else if error}
  <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
{:else}
  <div class="space-y-6">
    <section class="grid gap-4 lg:grid-cols-3">
      <div class="console-card p-5"><p class="text-sm text-surface-500">{t('Status')}</p><p class="mt-2 text-lg font-semibold text-surface-900">{oauthStatus?.enabled ? t('Enabled') : t('Disabled')}</p></div>
      <div class="console-card p-5"><p class="text-sm text-surface-500">{t('Signing Algorithm')}</p><p class="mt-2 text-lg font-semibold text-surface-900">{oauthStatus?.signing_alg || t('common.notAvailable')}</p></div>
      <div class="console-card p-5"><p class="text-sm text-surface-500">{t('tenant.signingKeys')}</p><p class="mt-2 text-lg font-semibold text-surface-900">{t('tenant.signingKeyCount', { count: jwks?.keys?.length ?? 0 })}</p></div>
    </section>

    <section class="console-card p-6">
      <h3 class="mb-4 text-lg font-semibold text-surface-900">{t('dashboard.oidcEndpoints')}</h3>
      <div class="space-y-3">
        {#each [
          [t('dashboard.issuer'), discovery?.issuer],
          [t('dashboard.authorization'), discovery?.authorization_endpoint],
          [t('dashboard.token'), discovery?.token_endpoint],
          [t('dashboard.userInfo'), discovery?.userinfo_endpoint],
          ['JWKS', discovery?.jwks_uri],
        ] as [endpointLabel, endpointUrl] (endpointLabel)}
          <div class="grid gap-2 border-b border-surface-100 py-2 last:border-0 lg:grid-cols-[9rem_1fr]">
            <span class="text-sm font-medium text-surface-600">{endpointLabel}</span>
            <code class="break-all text-sm text-brand-700">{endpointUrl || t('common.notAvailable')}</code>
          </div>
        {/each}
      </div>
    </section>

    <div class="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-800">{t('tenant.oidcSupabaseBoundary')}</div>
  </div>
{/if}
