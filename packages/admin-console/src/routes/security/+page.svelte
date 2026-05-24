<script>
  import { onMount } from 'svelte';
  import {
    getAuthConfig,
    getSignInExperience,
    updateAuthConfig,
    updateSignInExperience,
  } from '$lib/api/client.js';

  const signInMethodOptions = [
    { value: 'password', label: 'Password' },
    { value: 'magic_link', label: 'Magic Link' },
    { value: 'phone_otp', label: 'Phone OTP' },
    { value: 'passkey', label: 'Passkey' },
  ];

  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let success = $state(null);

  let securityForm = $state({
    sign_in_methods: ['password'],
    sign_up_enabled: true,
    mfa_required: false,
    password_min_length: 8,
    require_uppercase: false,
    require_lowercase: true,
    require_numbers: true,
    require_symbols: false,
    jwt_expiry: 3600,
    mfa_max_enrolled_factors: 10,
    enable_confirmations: false,
    external_anonymous_users_enabled: false,
  });

  function setMethod(method, enabled) {
    if (enabled && !securityForm.sign_in_methods.includes(method)) {
      securityForm.sign_in_methods = [...securityForm.sign_in_methods, method];
    }
    if (!enabled) {
      securityForm.sign_in_methods = securityForm.sign_in_methods.filter(item => item !== method);
    }
  }

  async function load() {
    loading = true;
    error = null;
    success = null;

    try {
      const [authConfig, signInExperience] = await Promise.all([
        getAuthConfig().catch(() => null),
        getSignInExperience().catch(() => null),
      ]);

      securityForm = {
        sign_in_methods: signInExperience?.sign_in_methods?.length
          ? signInExperience.sign_in_methods
          : ['password'],
        sign_up_enabled: signInExperience?.sign_up_enabled ?? authConfig?.enable_signup ?? true,
        mfa_required: signInExperience?.mfa_required ?? false,
        password_min_length: signInExperience?.password_policy?.min_length ?? authConfig?.password_min_length ?? 8,
        require_uppercase: signInExperience?.password_policy?.require_uppercase ?? false,
        require_lowercase: signInExperience?.password_policy?.require_lowercase ?? true,
        require_numbers: signInExperience?.password_policy?.require_numbers ?? true,
        require_symbols: signInExperience?.password_policy?.require_symbols ?? false,
        jwt_expiry: authConfig?.jwt_expiry ?? 3600,
        mfa_max_enrolled_factors: authConfig?.mfa_max_enrolled_factors ?? 10,
        enable_confirmations: authConfig?.enable_confirmations ?? false,
        external_anonymous_users_enabled: authConfig?.external_anonymous_users_enabled ?? false,
      };
    } catch (e) {
      error = e.message;
    }

    loading = false;
  }

  async function saveSecurityPolicy() {
    saving = true;
    error = null;
    success = null;

    try {
      const passwordMinLength = Number(securityForm.password_min_length) || 8;
      const jwtExpiry = Number(securityForm.jwt_expiry) || 3600;
      const mfaMaxFactors = Number(securityForm.mfa_max_enrolled_factors) || 10;

      await Promise.all([
        updateSignInExperience({
          sign_in_methods: securityForm.sign_in_methods,
          sign_up_enabled: securityForm.sign_up_enabled,
          mfa_required: securityForm.mfa_required,
          password_policy: {
            min_length: passwordMinLength,
            require_uppercase: securityForm.require_uppercase,
            require_lowercase: securityForm.require_lowercase,
            require_numbers: securityForm.require_numbers,
            require_symbols: securityForm.require_symbols,
          },
        }),
        updateAuthConfig({
          enable_signup: securityForm.sign_up_enabled,
          enable_confirmations: securityForm.enable_confirmations,
          external_anonymous_users_enabled: securityForm.external_anonymous_users_enabled,
          password_min_length: passwordMinLength,
          jwt_expiry: jwtExpiry,
          mfa_max_enrolled_factors: mfaMaxFactors,
        }),
      ]);

      securityForm.password_min_length = passwordMinLength;
      securityForm.jwt_expiry = jwtExpiry;
      securityForm.mfa_max_enrolled_factors = mfaMaxFactors;
      success = 'Security policy saved';
    } catch (e) {
      error = e.message;
    }

    saving = false;
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">Security Policy</h2>
  <button onclick={saveSecurityPolicy} disabled={saving || loading} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
    {saving ? 'Saving...' : 'Save'}
  </button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if success}
  <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 mb-4">{success}</div>
{/if}

{#if loading}
  <p class="text-surface-400">Loading...</p>
{:else}
  <div class="space-y-6">
    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Sign-in Methods</h3>
      <div class="grid grid-cols-2 gap-4">
        {#each signInMethodOptions as method (method.value)}
          <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
            <span class="text-sm font-medium text-surface-800">{method.label}</span>
            <input
              type="checkbox"
              checked={securityForm.sign_in_methods.includes(method.value)}
              onchange={(e) => setMethod(method.value, e.currentTarget.checked)}
              class="h-4 w-4"
            >
          </label>
        {/each}
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Account Protection</h3>
      <div class="grid grid-cols-2 gap-4">
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Sign-up Enabled</span>
          <input type="checkbox" bind:checked={securityForm.sign_up_enabled} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">MFA Required</span>
          <input type="checkbox" bind:checked={securityForm.mfa_required} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Email Confirmations</span>
          <input type="checkbox" bind:checked={securityForm.enable_confirmations} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Anonymous Users</span>
          <input type="checkbox" bind:checked={securityForm.external_anonymous_users_enabled} class="h-4 w-4">
        </label>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Password Policy</h3>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label for="password-min-length" class="block text-sm font-medium text-surface-700 mb-1">Minimum Length</label>
          <input id="password-min-length" type="number" min="6" max="128" bind:value={securityForm.password_min_length} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
        <div>
          <label for="mfa-max-factors" class="block text-sm font-medium text-surface-700 mb-1">MFA Max Factors</label>
          <input id="mfa-max-factors" type="number" min="1" max="20" bind:value={securityForm.mfa_max_enrolled_factors} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Uppercase Letter</span>
          <input type="checkbox" bind:checked={securityForm.require_uppercase} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Lowercase Letter</span>
          <input type="checkbox" bind:checked={securityForm.require_lowercase} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Number</span>
          <input type="checkbox" bind:checked={securityForm.require_numbers} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Symbol</span>
          <input type="checkbox" bind:checked={securityForm.require_symbols} class="h-4 w-4">
        </label>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Session Policy</h3>
      <div>
        <label for="jwt-expiry" class="block text-sm font-medium text-surface-700 mb-1">JWT Expiry Seconds</label>
        <input id="jwt-expiry" type="number" min="60" bind:value={securityForm.jwt_expiry} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
      </div>
    </section>
  </div>
{/if}
