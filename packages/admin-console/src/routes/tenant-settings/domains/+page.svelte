<script>
  import { onMount } from 'svelte';
  import { checkTenantDomain, deleteTenantConfig, listTenantConfigs, upsertTenantConfig } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';

  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let domainName = $state('');
  let domains = $state([]);
  let domainChecks = $state({});

  async function loadDomains() {
    loading = true;
    error = null;
    try {
      const response = await listTenantConfigs('domain');
      domains = response.items || [];
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  }

  async function addDomain() {
    const normalizedDomain = domainName.trim().toLowerCase();
    if (!normalizedDomain) return;
    saving = true;
    error = null;
    try {
      await upsertTenantConfig('domain', normalizedDomain, { enabled: true, value: { domain: normalizedDomain } });
      domainName = '';
      await loadDomains();
    } catch (requestError) {
      error = requestError.message;
    }
    saving = false;
  }

  async function verifyDomain(domainConfig) {
    try {
      domainChecks = { ...domainChecks, [domainConfig.key]: await checkTenantDomain(domainConfig.key) };
    } catch (requestError) {
      domainChecks = { ...domainChecks, [domainConfig.key]: { status: 'error', error: requestError.message } };
    }
  }

  async function removeDomain(domainConfig) {
    if (!confirm(t('tenant.domainDeleteConfirm'))) return;
    try {
      await deleteTenantConfig('domain', domainConfig.key);
      await loadDomains();
    } catch (requestError) {
      error = requestError.message;
    }
  }

  onMount(loadDomains);
</script>

<div class="mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t('tenant.domainsTitle')}</h2>
  <p class="mt-1 text-sm text-surface-500">{t('tenant.domainsDescription')}</p>
</div>

{#if error}<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>{/if}

<section class="console-card mb-6 p-6">
  <label for="tenant-domain" class="mb-1 block text-sm font-medium text-surface-700">{t('tenant.domainName')}</label>
  <div class="flex gap-3">
    <input id="tenant-domain" bind:value={domainName} class="flex-1" placeholder="auth.example.com">
    <button onclick={addDomain} disabled={saving || !domainName.trim()} class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{t('Add')}</button>
  </div>
</section>

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else}
  <div class="space-y-3">
    {#each domains as domainConfig (domainConfig.id)}
      <article class="console-card flex items-start justify-between gap-4 p-5">
        <div>
          <h3 class="font-semibold text-surface-900">{domainConfig.key}</h3>
          {#if domainChecks[domainConfig.key]}
            <pre class="mt-2 max-w-2xl overflow-auto rounded-lg bg-surface-50 p-3 text-xs">{JSON.stringify(domainChecks[domainConfig.key], null, 2)}</pre>
          {/if}
        </div>
        <div class="flex gap-3">
          <button onclick={() => verifyDomain(domainConfig)} class="text-sm font-semibold text-brand-700">{t('Check')}</button>
          <button onclick={() => removeDomain(domainConfig)} class="text-sm font-semibold text-red-600">{t('Delete')}</button>
        </div>
      </article>
    {:else}
      <div class="rounded-xl border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">{t('tenant.noDomains')}</div>
    {/each}
  </div>
{/if}
