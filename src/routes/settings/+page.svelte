<script>
  import { onMount } from 'svelte';
  import { getAuthConfig, getOAuthServerStatus, getSignInExperience } from '$lib/api/client.js';

  let config = $state(null);
  let oauthStatus = $state(null);
  let signInExp = $state(null);
  let loading = $state(true);
  let error = $state(null);

  onMount(async () => {
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
  });
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
          <p class="text-sm text-surface-500">Password Min Length</p>
          <p class="font-medium text-surface-900">{signInExp.password_policy?.min_length || 8}</p>
        </div>
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
