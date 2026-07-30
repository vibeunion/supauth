<script>
  import { onMount } from 'svelte';
  import { deleteTenantConfig, listTenantConfigs, upsertTenantConfig } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';

  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let profileFields = $state([]);
  let fieldKey = $state('default');
  let fieldDefinition = $state('{\n  "fields": ["name", "email", "phone"]\n}');

  async function loadProfileFields() {
    loading = true;
    error = null;
    try {
      const response = await listTenantConfigs('profile_field');
      profileFields = response.items || [];
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  }

  async function saveProfileField() {
    saving = true;
    error = null;
    try {
      await upsertTenantConfig('profile_field', fieldKey.trim(), {
        enabled: true,
        value: JSON.parse(fieldDefinition),
      });
      await loadProfileFields();
    } catch (requestError) {
      error = requestError instanceof SyntaxError ? t('profileFields.invalidJson') : requestError.message;
    }
    saving = false;
  }

  async function removeProfileField(profileField) {
    if (!confirm(t('profileFields.deleteConfirm'))) return;
    try {
      await deleteTenantConfig('profile_field', profileField.key);
      await loadProfileFields();
    } catch (requestError) {
      error = requestError.message;
    }
  }

  onMount(loadProfileFields);
</script>

<div class="mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t('profileFields.title')}</h2>
  <p class="mt-1 text-sm text-surface-500">{t('profileFields.description')}</p>
</div>

{#if error}<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>{/if}

<section class="console-card mb-6 space-y-4 p-6">
  <div>
    <label for="profile-field-key" class="mb-1 block text-sm font-medium text-surface-700">{t('profileFields.key')}</label>
    <input id="profile-field-key" bind:value={fieldKey} class="w-full" placeholder="default">
  </div>
  <div>
    <label for="profile-field-definition" class="mb-1 block text-sm font-medium text-surface-700">{t('profileFields.definition')}</label>
    <textarea id="profile-field-definition" bind:value={fieldDefinition} rows="8" class="w-full font-mono"></textarea>
  </div>
  <button onclick={saveProfileField} disabled={saving || !fieldKey.trim()} class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
    {saving ? t('Saving...') : t('Save')}
  </button>
</section>

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else}
  <div class="space-y-3">
    {#each profileFields as profileField (profileField.id)}
      <article class="console-card flex items-start justify-between gap-4 p-5">
        <div class="min-w-0">
          <h3 class="font-semibold text-surface-900">{profileField.key}</h3>
          <pre class="mt-2 overflow-auto rounded-lg bg-surface-50 p-3 text-xs">{JSON.stringify(profileField.value, null, 2)}</pre>
        </div>
        <button onclick={() => removeProfileField(profileField)} class="text-sm text-red-600 hover:text-red-800">{t('Delete')}</button>
      </article>
    {:else}
      <div class="rounded-xl border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">{t('profileFields.empty')}</div>
    {/each}
  </div>
{/if}
