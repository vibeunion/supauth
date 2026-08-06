<script>
  import { onMount } from 'svelte';
  import { getSignInExperience, updateSignInExperience, uploadBranding } from '$lib/api/client.js';
  import {
    brandingSettingsAuthority,
    settleAuthoritativeSettingsMutation,
  } from '$lib/authoritative-settings-readback.js';
  import { t } from '$lib/i18n.js';

  const MAX_BRANDING_FILE_SIZE = 5 * 1024 * 1024;
  const BRANDING_FILE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ]);
  const BRANDING_FILE_ACCEPT = [...BRANDING_FILE_TYPES].join(',');

  let loading = $state(true);
  let saving = $state(false);
  let uploading = $state(null);
  let error = $state(null);
  let saved = $state(false);
  let reconciliationStatus = $state(null);
  let previewViewport = $state('desktop');
  let previewTheme = $state('light');
  let branding = $state({
    page_title: '',
    logo_url: '',
    favicon_url: '',
    primary_color: '',
    background_url: '',
  });

  function syncBranding(signInExperience) {
    const currentBranding = signInExperience?.branding || {};
    const managedBranding = brandingSettingsAuthority(signInExperience).branding;
    branding = {
      page_title: managedBranding.page_title || '',
      logo_url: currentBranding.logo_url || '',
      favicon_url: currentBranding.favicon_url || '',
      primary_color: managedBranding.primary_color || '',
      background_url: managedBranding.background_url || '',
    };
  }

  async function loadBranding() {
    loading = true;
    error = null;
    saved = false;
    reconciliationStatus = null;
    try {
      syncBranding(await getSignInExperience());
    } catch (requestError) {
      error = displayError(requestError);
    }
    loading = false;
  }

  // Storage failures (e.g. "Storage create bucket: 404") are infrastructure
  // issues; show a localized friendly message and keep details in the console.
  function displayError(requestError) {
    const message = requestError?.message || '';
    if (message.startsWith('Storage ')) {
      console.error('[branding] storage request failed:', message);
      return t('signIn.brandingStorageUnavailable');
    }
    return message;
  }

  function brandingMutationDraft() {
    const command = {
      branding: {
        page_title: branding.page_title.trim() || null,
        primary_color: branding.primary_color.trim() || null,
        background_url: branding.background_url.trim() || null,
      },
    };
    return { command, authority: brandingSettingsAuthority(command) };
  }

  function brandingFileError(selectedFile) {
    if (!BRANDING_FILE_TYPES.has(selectedFile.type)) {
      return t('signIn.brandingUnsupportedFile');
    }
    if (selectedFile.size === 0) return t('signIn.brandingEmptyFile');
    if (selectedFile.size > MAX_BRANDING_FILE_SIZE) {
      return t('signIn.brandingFileTooLarge');
    }
    return null;
  }

  async function saveBranding() {
    saving = true;
    saved = false;
    error = null;
    reconciliationStatus = null;
    try {
      const mutationDraft = brandingMutationDraft();
      const reconciliation = await settleAuthoritativeSettingsMutation({
        draft: mutationDraft,
        writeCommands: (command) => [() => updateSignInExperience(command)],
        readSnapshot: getSignInExperience,
        authorityFromSnapshot: brandingSettingsAuthority,
      });
      if (reconciliation.status === 'success') {
        syncBranding(reconciliation.readBackValue);
        saved = true;
      } else reconciliationStatus = reconciliation.status;
    } finally {
      saving = false;
    }
  }

  async function uploadBrandingFile(assetType, uploadEvent) {
    // Capture the input element before the first await: currentTarget is
    // cleared after event dispatch, and late access throws
    // "Cannot set properties of null (setting 'value')".
    const input = uploadEvent.currentTarget;
    const selectedFile = input?.files?.[0];
    if (!selectedFile) return;
    const validationError = brandingFileError(selectedFile);
    if (validationError) {
      error = validationError;
      input.value = '';
      return;
    }
    uploading = assetType;
    error = null;
    try {
      await uploadBranding(assetType, selectedFile, selectedFile.type);
      syncBranding(await getSignInExperience());
    } catch (requestError) {
      error = displayError(requestError);
    } finally {
      uploading = null;
      input.value = '';
    }
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
{#if reconciliationStatus}
  <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900" role="alert">
    <p class="font-semibold">{t(`save.${reconciliationStatus}.title`)}</p>
    <p class="mt-1 text-sm">{t(`save.${reconciliationStatus}.description`)}</p>
  </div>
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
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 class="text-lg font-semibold text-surface-900">{t('signIn.previewTitle')}</h3>
          <p class="mt-1 text-sm text-surface-500">{t('signIn.previewDescription')}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <div class="inline-flex rounded-lg border border-surface-200 p-1" aria-label={t('signIn.previewViewport')}>
            <button type="button" aria-pressed={previewViewport === 'desktop'} onclick={() => previewViewport = 'desktop'} class="rounded-md px-3 py-1.5 text-xs font-medium {previewViewport === 'desktop' ? 'bg-surface-900 text-white' : 'text-surface-600'}">{t('signIn.previewDesktop')}</button>
            <button type="button" aria-pressed={previewViewport === 'mobile'} onclick={() => previewViewport = 'mobile'} class="rounded-md px-3 py-1.5 text-xs font-medium {previewViewport === 'mobile' ? 'bg-surface-900 text-white' : 'text-surface-600'}">{t('signIn.previewMobile')}</button>
          </div>
          <div class="inline-flex rounded-lg border border-surface-200 p-1" aria-label={t('signIn.previewTheme')}>
            <button type="button" aria-pressed={previewTheme === 'light'} onclick={() => previewTheme = 'light'} class="rounded-md px-3 py-1.5 text-xs font-medium {previewTheme === 'light' ? 'bg-surface-900 text-white' : 'text-surface-600'}">{t('signIn.previewLight')}</button>
            <button type="button" aria-pressed={previewTheme === 'dark'} onclick={() => previewTheme = 'dark'} class="rounded-md px-3 py-1.5 text-xs font-medium {previewTheme === 'dark' ? 'bg-surface-900 text-white' : 'text-surface-600'}">{t('signIn.previewDark')}</button>
          </div>
        </div>
      </div>
      <div class="mt-5 overflow-auto rounded-xl bg-surface-100 p-5">
        <div class="mx-auto overflow-hidden rounded-xl border border-surface-200 shadow-sm transition-[max-width] {previewViewport === 'mobile' ? 'max-w-sm' : 'max-w-3xl'}">
          <div class="grid min-h-[26rem] place-items-center p-6 {previewTheme === 'dark' ? 'bg-surface-950' : 'bg-white'}">
            <div class="w-full max-w-sm rounded-xl border p-6 {previewTheme === 'dark' ? 'border-surface-700 bg-surface-900 text-white' : 'border-surface-200 bg-white text-surface-900'}">
              {#if branding.logo_url}
                <img src={branding.logo_url} alt="" class="mb-5 h-10 max-w-full object-contain object-left">
              {/if}
              <h4 class="text-xl font-semibold">{branding.page_title || 'SupaOAuth'}</h4>
              <p class="mt-2 text-sm {previewTheme === 'dark' ? 'text-surface-300' : 'text-surface-500'}">{t('signIn.previewSignInHint')}</p>
              <div class="mt-5 rounded-lg border px-3 py-2 text-sm {previewTheme === 'dark' ? 'border-surface-700 text-surface-400' : 'border-surface-300 text-surface-400'}">user@example.com</div>
              <div class="mt-3 rounded-lg px-3 py-2 text-center text-sm font-semibold text-white" style:background-color={branding.primary_color || '#2563eb'}>{t('signIn.previewContinue')}</div>
              {#if branding.background_url}
                <p class="mt-4 text-xs {previewTheme === 'dark' ? 'text-surface-400' : 'text-surface-500'}">{t('signIn.previewBackgroundConfigured')}</p>
              {/if}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="console-card p-6">
      <h3 class="mb-4 text-lg font-semibold text-surface-900">{t('Branding Assets')}</h3>
      <div class="grid gap-6 lg:grid-cols-2">
        <div>
          <p class="mb-2 text-sm font-medium text-surface-700">{t('Logo')}</p>
          {#if branding.logo_url}<img src={branding.logo_url} alt={t('Logo')} class="mb-3 h-16 max-w-full rounded border border-surface-200 object-contain">{/if}
          <label for="branding-logo-upload" class="inline-flex cursor-pointer rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            {uploading === 'logo' ? t('Uploading...') : t('Upload Logo')}
            <input id="branding-logo-upload" type="file" accept={BRANDING_FILE_ACCEPT} class="sr-only" disabled={uploading !== null} onchange={(uploadEvent) => uploadBrandingFile('logo', uploadEvent)}>
          </label>
          <p class="mt-2 text-xs leading-5 text-surface-500">{t('signIn.logoUploadHint')}</p>
        </div>
        <div>
          <p class="mb-2 text-sm font-medium text-surface-700">{t('Favicon')}</p>
          {#if branding.favicon_url}<img src={branding.favicon_url} alt={t('Favicon')} class="mb-3 h-10 w-10 rounded border border-surface-200 object-contain">{/if}
          <label for="branding-favicon-upload" class="inline-flex cursor-pointer rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            {uploading === 'favicon' ? t('Uploading...') : t('Upload Favicon')}
            <input id="branding-favicon-upload" type="file" accept={BRANDING_FILE_ACCEPT} class="sr-only" disabled={uploading !== null} onchange={(uploadEvent) => uploadBrandingFile('favicon', uploadEvent)}>
          </label>
          <p class="mt-2 text-xs leading-5 text-surface-500">{t('signIn.faviconUploadHint')}</p>
        </div>
      </div>
    </section>
  </div>
{/if}
