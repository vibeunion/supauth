<script>
  import { onMount } from 'svelte';
  import { getAuthConfig, getOAuthServerStatus, getSignInExperience, uploadBranding } from '$lib/api/client.js';

  let config = $state(null);
  let oauthStatus = $state(null);
  let signInExp = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let uploadingLogo = $state(false);
  let uploadingFavicon = $state(false);

  async function loadData() {
    loading = true;
    try {
      [config, oauthStatus, signInExp] = await Promise.all([
        getAuthConfig().catch(() => null),
        getOAuthServerStatus().catch(() => null),
        getSignInExperience().catch(() => null),
      ]);
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleBrandingUpload(assetType, event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (assetType === 'logo') uploadingLogo = true;
    if (assetType === 'favicon') uploadingFavicon = true;

    try {
      const result = await uploadBranding(assetType, file, file.type);
      // Refresh sign-in experience to show new URL
      signInExp = await getSignInExperience();
    } catch (e) {
      error = e.message;
    }

    if (assetType === 'logo') uploadingLogo = false;
    if (assetType === 'favicon') uploadingFavicon = false;
  }

  onMount(loadData);
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">Settings</h2>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else}
  <!-- OAuth Server -->
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">OAuth 2.0 / OIDC Server</h3>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-sm text-surface-500">Status</p>
        <p class="font-medium {oauthStatus?.enabled ? 'text-green-600' : 'text-surface-400'}">
          {oauthStatus?.enabled ? 'Enabled' : 'Disabled'}
        </p>
      </div>
      <div>
        <p class="text-sm text-surface-500">Signing Algorithm</p>
        <p class="font-medium text-surface-900">{oauthStatus?.signing_alg || 'HS256'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">Dynamic Registration</p>
        <p class="font-medium text-surface-900">{oauthStatus?.allow_dynamic_registration ? 'Enabled' : 'Disabled'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">Migration Status</p>
        <p class="font-medium text-surface-900">{oauthStatus?.migration_status || 'N/A'}</p>
      </div>
    </div>
  </div>

  <!-- Branding Assets (SupaCloud Storage) -->
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">Branding Assets</h3>
    <p class="text-sm text-surface-500 mb-4">Upload logo and favicon to SupaCloud Storage. Files are served from the public <code class="bg-surface-50 px-1 rounded">branding</code> bucket.</p>

    <div class="grid grid-cols-2 gap-6">
      <!-- Logo -->
      <div>
        <p class="text-sm font-medium text-surface-700 mb-2">Logo</p>
        {#if signInExp?.branding?.logo_url}
          <div class="mb-2">
            <img src={signInExp.branding.logo_url} alt="Logo" class="h-16 w-auto rounded border border-surface-200">
            <p class="text-xs text-surface-400 mt-1 break-all">{signInExp.branding.logo_url}</p>
          </div>
        {/if}
        <label class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 cursor-pointer">
          {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
          <input type="file" accept="image/*" class="hidden" onchange={(e) => handleBrandingUpload('logo', e)} disabled={uploadingLogo}>
        </label>
      </div>

      <!-- Favicon -->
      <div>
        <p class="text-sm font-medium text-surface-700 mb-2">Favicon</p>
        {#if signInExp?.branding?.favicon_url}
          <div class="mb-2">
            <img src={signInExp.branding.favicon_url} alt="Favicon" class="h-8 w-8 rounded border border-surface-200">
            <p class="text-xs text-surface-400 mt-1 break-all">{signInExp.branding.favicon_url}</p>
          </div>
        {/if}
        <label class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 cursor-pointer">
          {uploadingFavicon ? 'Uploading...' : 'Upload Favicon'}
          <input type="file" accept="image/*" class="hidden" onchange={(e) => handleBrandingUpload('favicon', e)} disabled={uploadingFavicon}>
        </label>
      </div>
    </div>
  </div>

  <!-- Sign-in Experience -->
  {#if signInExp}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Sign-in Experience</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-surface-500">Sign-up</p>
          <p class="font-medium text-surface-900">{signInExp.sign_up_enabled ? 'Open' : 'Closed'}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">MFA Required</p>
          <p class="font-medium text-surface-900">{signInExp.mfa_required ? 'Yes' : 'No'}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">Password Min Length</p>
          <p class="font-medium text-surface-900">{signInExp.password_policy?.min_length || 8}</p>
        </div>
        {#if signInExp.branding?.primary_color}
          <div>
            <p class="text-sm text-surface-500">Primary Color</p>
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded border border-surface-200" style="background-color: {signInExp.branding.primary_color}"></div>
              <span class="font-medium text-surface-900">{signInExp.branding.primary_color}</span>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Auth settings -->
  {#if config}
    <div class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Auth Configuration</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-surface-500">Sign-up</p>
          <p class="font-medium text-surface-900">{config.enable_signup ? 'Open' : 'Closed'}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">Email Confirmations</p>
          <p class="font-medium text-surface-900">{config.enable_confirmations ? 'Required' : 'Auto-confirm'}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">Anonymous Users</p>
          <p class="font-medium text-surface-900">{config.external_anonymous_users_enabled ? 'Enabled' : 'Disabled'}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">JWT Expiry</p>
          <p class="font-medium text-surface-900">{config.jwt_expiry || 3600}s</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">Password Min Length</p>
          <p class="font-medium text-surface-900">{config.password_min_length || 8}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">MFA Max Factors</p>
          <p class="font-medium text-surface-900">{config.mfa_max_enrolled_factors || 10}</p>
        </div>
      </div>
    </div>
  {/if}
{/if}
