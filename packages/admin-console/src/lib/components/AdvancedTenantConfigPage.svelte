<script>
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  import { parseTenantConfigValue } from '$lib/tenant-settings.js';
  import { listTenantConfigs, upsertTenantConfig, deleteTenantConfig, checkTenantDomain } from '$lib/api/client.js';

  const configTypes = ['captcha', 'email_template', 'sms_template', 'domain', 'phrase', 'profile_field', 'branding_asset', 'account_center', 'account_claim'];

  let configs = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let form = $state({ type: 'captcha', key: 'default', value: '{\n  "provider": "none"\n}', enabled: true });
  let domainCheck = $state(null);
  let formValue = $derived(parseTenantConfigValue(form.value));

  async function load() {
    loading = true;
    try {
      const res = await listTenantConfigs();
      configs = res.items || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleSave() {
    if (!formValue.valid) {
      error = t('tenant.advanced.invalidJson');
      return;
    }
    error = null;
    try {
      await upsertTenantConfig(form.type, form.key, {
        value: formValue.config,
        enabled: form.enabled,
      });
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete(config) {
    if (!confirm(t('Delete this tenant configuration?'))) return;
    try {
      await deleteTenantConfig(config.configType || config.config_type, config.key);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDomainCheck(config) {
    try {
      domainCheck = await checkTenantDomain(config.key);
    } catch (e) {
      domainCheck = { domain: config.key, status: 'error', error: e.message };
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">{t('Tenant Config')}</h2>
    <p class="text-sm text-surface-500 mt-1">{t('Captcha, templates, domains, phrases, branding, and custom profile fields.')}</p>
  </div>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

<div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
  <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Create / Update')}</h3>
  <div class="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-3">
    <select bind:value={form.type} aria-label={t('tenant.advanced.type')} class="px-3 py-2 border border-surface-300 rounded-lg text-sm">
      {#each configTypes as type (type)}
        <option value={type}>{t(`tenant.configType.${type}`)}</option>
      {/each}
    </select>
    <input bind:value={form.key} aria-label={t('tenant.advanced.key')} class="px-3 py-2 border border-surface-300 rounded-lg text-sm lg:col-span-2" placeholder={t('tenant.advanced.key')}>
    <label class="flex items-center gap-2 text-sm text-surface-700">
      <input type="checkbox" bind:checked={form.enabled}>
      {t('Enabled')}
    </label>
  </div>
  <textarea bind:value={form.value} class="w-full h-40 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono" aria-label={t('JSON value')}></textarea>
  {#if !formValue.valid}
    <p class="mt-2 text-sm text-red-700" role="alert">{t('tenant.advanced.invalidJson')}</p>
  {/if}
  <button disabled={!formValue.valid} onclick={handleSave} class="mt-3 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">{t('Save')}</button>
</div>

{#if loading}
  <p class="text-surface-400">{t('Loading...')}</p>
{:else}
  <div class="space-y-3">
    {#each configs as config (config.id)}
      <div class="bg-white rounded-xl border border-surface-200 p-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-surface-900">{t(`tenant.configType.${config.configType || config.config_type}`)} / {config.key}</p>
            <pre class="mt-2 max-w-full overflow-auto rounded-lg bg-surface-50 p-3 text-xs">{JSON.stringify(config.value, null, 2)}</pre>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs px-2 py-0.5 rounded-full {config.enabled ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'}">{config.enabled ? t('Enabled') : t('Disabled')}</span>
            {#if (config.configType || config.config_type) === 'domain'}
              <button onclick={() => handleDomainCheck(config)} class="text-xs text-brand-600 hover:text-brand-800">{t('Check')}</button>
            {/if}
            <button onclick={() => handleDelete(config)} class="text-xs text-red-600 hover:text-red-800">{t('Delete')}</button>
          </div>
        </div>
      </div>
    {/each}
    {#if configs.length === 0}
      <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center text-surface-500">{t('No tenant config records.')}</div>
    {/if}
  </div>
{/if}

{#if domainCheck}
  <div class="bg-surface-900 text-white rounded-xl p-4 mt-6">
    <p class="text-sm font-semibold">{t('Domain Check')}</p>
    <pre class="text-xs mt-2 overflow-auto">{JSON.stringify(domainCheck, null, 2)}</pre>
  </div>
{/if}
