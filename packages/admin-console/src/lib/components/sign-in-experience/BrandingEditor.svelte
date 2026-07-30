<script>
  import { onMount } from 'svelte';
  import { getSignInExperience, updateSignInExperience, uploadBranding } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';

  let loading = $state(true);
  let saving = $state(false);
  let uploading = $state(null);
  let error = $state(null);
  let saved = $state(false);
  let branding = $state({
    page_title: '',
    logo_url: '',
    favicon_url: '',
    primary_color: '',
    background_url: '',
  });

  function syncBranding(signInExperience) {
    const currentBranding = signInExperience?.branding || {};
    branding = {
      page_title: currentBranding.page_title || '',
      logo_url: currentBranding.logo_url || '',
      favicon_url: currentBranding.favicon_url || '',
      primary_color: currentBranding.primary_color || '',
      background_url: currentBranding.background_url || '',
    };
  }

  async function loadBranding() {
    loading = true;
    error = null;
    try {
      syncBranding(await getSignInExperience());
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  }

  async function saveBranding() {
    saving = true;
    saved = false;
    error = null;
    try {
      await updateSignInExperience({
        branding: {
          page_title: branding.page_title.trim() || null,
          primary_color: branding.primary_color.trim() || null,
          background_url: branding.background_url.trim() || null,
        },
      });
      await loadBranding();
      saved = true;
    } catch (requestError) {
      error = requestError.message;
    }
    saving = false;
  }

  async function uploadBrandingFile(assetType, uploadEvent) {
    const selectedFile = uploadEvent.currentTarget.files?.[0];
    if (!selectedFile) return;
    uploading = assetType;
    error = null;
    try {
      await uploadBranding(assetType, selectedFile, selectedFile.type);
      await loadBranding();
    } catch (requestError) {
      error = requestError.message;
    }
    uploading = null;
  }

  onMount(loadBranding);
</script>

<div class="mb-6 flex items-start justify-between gap-4">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">{t('signIn.brandingTitle')}</h2>
    <p class="mt-1 text-sm text-surface-500">{t('signIn.brandingDescription')}</p>
  </div>
  <button onclick={saveBranding} disabled={loading || saving} class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
    {saving ? t('Saving...') : t('Save')}
  </button>
</div>

{#if error}
  <div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
{/if}
{#if saved}
  <div class="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">{t('Saved')}</div>
{/if}

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else}
  <div class="space-y-6">
    <section class="console-card p-6">
      <div class="grid gap-5 lg:grid-cols-2">
        <div>
          <label for="page-title" class="mb-1 block text-sm font-medium text-surface-700">{t('signIn.systemName')}</label>
          <input id="page-title" bind:value={branding.page_title} class="w-full" placeholder="SupaOAuth">
        </div>
        <div>
          <label for="primary-color" class="mb-1 block text-sm font-medium text-surface-700">{t('Primary Color')}</label>
          <div class="flex gap-2">
            <input id="primary-color" bind:value={branding.primary_color} class="flex-1" placeholder="#635bff">
            <span class="h-10 w-10 rounded-lg border border-surface-200" style:background-color={branding.primary_color || '#ffffff'}></span>
          </div>
        </div>
        <div class="lg:col-span-2">
          <label for="background-url" class="mb-1 block text-sm font-medium text-surface-700">{t('Background URL')}</label>
          <input id="background-url" bind:value={branding.background_url} class="w-full" placeholder="https://...">
        </div>
      </div>
    </section>

    <section class="console-card p-6">
      <h3 class="mb-4 text-lg font-semibold text-surface-900">{t('Branding Assets')}</h3>
      <div class="grid gap-6 lg:grid-cols-2">
        <div>
          <p class="mb-2 text-sm font-medium text-surface-700">{t('Logo')}</p>
          {#if branding.logo_url}<img src={branding.logo_url} alt={t('Logo')} class="mb-3 h-16 max-w-full rounded border border-surface-200 object-contain">{/if}
          <label class="inline-flex cursor-pointer rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            {uploading === 'logo' ? t('Uploading...') : t('Upload Logo')}
            <input type="file" accept="image/*" class="hidden" disabled={uploading !== null} onchange={(uploadEvent) => uploadBrandingFile('logo', uploadEvent)}>
          </label>
        </div>
        <div>
          <p class="mb-2 text-sm font-medium text-surface-700">{t('Favicon')}</p>
          {#if branding.favicon_url}<img src={branding.favicon_url} alt={t('Favicon')} class="mb-3 h-10 w-10 rounded border border-surface-200 object-contain">{/if}
          <label class="inline-flex cursor-pointer rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            {uploading === 'favicon' ? t('Uploading...') : t('Upload Favicon')}
            <input type="file" accept="image/*" class="hidden" disabled={uploading !== null} onchange={(uploadEvent) => uploadBrandingFile('favicon', uploadEvent)}>
          </label>
        </div>
      </div>
    </section>
  </div>
{/if}
