<script>
  import { onMount } from 'svelte';
  import { listTenantConfigs, upsertTenantConfig } from '$lib/api/client.js';

  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let success = $state(null);

  let form = $state({
    enabled: true,
    profile_edit: 'read_only',
    profile_fields_text: 'name\nemail\nphone',
    password_change: true,
    mfa: false,
    passkeys: false,
    email_change: false,
    phone_change: false,
    sessions: false,
    grants: false,
    identities: false,
    delete_account_enabled: false,
    delete_account_url: '',
  });

  function normalizeValue(config) {
    const value = config?.value || {};
    const profile = value.profile || {};
    const security = value.security || {};
    const fields = Array.isArray(profile.fields) ? profile.fields : ['name', 'email', 'phone'];

    return {
      enabled: config?.enabled ?? value.enabled ?? true,
      profile_edit: profile.edit_mode || 'read_only',
      profile_fields_text: fields.join('\n'),
      password_change: security.password_change ?? true,
      mfa: security.mfa ?? false,
      passkeys: security.passkeys ?? false,
      email_change: security.email_change ?? false,
      phone_change: security.phone_change ?? false,
      sessions: value.sessions?.enabled ?? false,
      grants: value.grants?.enabled ?? false,
      identities: value.identities?.enabled ?? false,
      delete_account_enabled: value.delete_account?.enabled ?? !!value.delete_account_url,
      delete_account_url: value.delete_account?.url || value.delete_account_url || '',
    };
  }

  function profileFields() {
    return form.profile_fields_text
      .split(/[\n,]/)
      .map((field) => field.trim())
      .filter(Boolean);
  }

  async function load() {
    loading = true;
    error = null;
    success = null;

    try {
      const res = await listTenantConfigs('account_center');
      const config = (res.items || []).find((item) => item.key === 'default');
      form = normalizeValue(config);
    } catch (e) {
      error = e.message;
    }

    loading = false;
  }

  async function saveAccountCenter() {
    saving = true;
    error = null;
    success = null;

    try {
      await upsertTenantConfig('account_center', 'default', {
        enabled: form.enabled,
        value: {
          enabled: form.enabled,
          profile: {
            edit_mode: form.profile_edit,
            fields: profileFields(),
          },
          security: {
            password_change: form.password_change,
            mfa: form.mfa,
            passkeys: form.passkeys,
            email_change: form.email_change,
            phone_change: form.phone_change,
          },
          sessions: {
            enabled: form.sessions,
          },
          grants: {
            enabled: form.grants,
          },
          identities: {
            enabled: form.identities,
          },
          delete_account: {
            enabled: form.delete_account_enabled,
            url: form.delete_account_url.trim() || null,
          },
          delete_account_url: form.delete_account_url.trim() || null,
        },
      });
      await load();
      success = 'Account Center settings saved';
    } catch (e) {
      error = e.message;
    }

    saving = false;
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">Account Center</h2>
    <p class="text-sm text-surface-500 mt-1">Configure the hosted self-service account center exposed at /account.</p>
  </div>
  <button onclick={saveAccountCenter} disabled={saving || loading} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
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
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Availability</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span>
            <span class="block text-sm font-medium text-surface-800">Hosted Account Center</span>
            <span class="block text-xs text-surface-500 mt-1">Controls the public /account entry.</span>
          </span>
          <input type="checkbox" bind:checked={form.enabled} class="h-4 w-4">
        </label>

        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span>
            <span class="block text-sm font-medium text-surface-800">Password Change</span>
            <span class="block text-xs text-surface-500 mt-1">Links to /account/password.</span>
          </span>
          <input type="checkbox" bind:checked={form.password_change} class="h-4 w-4">
        </label>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Profile</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="profile-edit" class="block text-sm font-medium text-surface-700 mb-1">Edit Mode</label>
          <select id="profile-edit" bind:value={form.profile_edit} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
            <option value="disabled">Disabled</option>
            <option value="read_only">Read Only</option>
            <option value="editable">Editable</option>
          </select>
        </div>

        <div>
          <label for="profile-fields" class="block text-sm font-medium text-surface-700 mb-1">Profile Fields</label>
          <textarea id="profile-fields" bind:value={form.profile_fields_text} class="w-full h-28 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono" placeholder="name&#10;email&#10;phone"></textarea>
        </div>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Modules</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Sessions</span>
          <input type="checkbox" bind:checked={form.sessions} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Application Grants</span>
          <input type="checkbox" bind:checked={form.grants} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Identities</span>
          <input type="checkbox" bind:checked={form.identities} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">MFA</span>
          <input type="checkbox" bind:checked={form.mfa} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Passkeys</span>
          <input type="checkbox" bind:checked={form.passkeys} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Email Change</span>
          <input type="checkbox" bind:checked={form.email_change} class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3">
          <span class="text-sm font-medium text-surface-800">Phone Change</span>
          <input type="checkbox" bind:checked={form.phone_change} class="h-4 w-4">
        </label>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Delete Account</h3>
      <label class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3 mb-4">
        <span>
          <span class="block text-sm font-medium text-surface-800">Enable Delete Account</span>
          <span class="block text-xs text-surface-500 mt-1">If URL is empty, hosted /account uses the built-in DELETE confirmation flow.</span>
        </span>
        <input type="checkbox" bind:checked={form.delete_account_enabled} class="h-4 w-4">
      </label>
      <label for="delete-account-url" class="block text-sm font-medium text-surface-700 mb-1">External Delete Account URL</label>
      <input id="delete-account-url" type="url" bind:value={form.delete_account_url} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="https://example.com/account/delete">
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">Hosted URLs</h3>
      <div class="flex flex-wrap gap-3">
        <a class="text-sm text-brand-600 hover:text-brand-800" href="/account" target="_blank" rel="noreferrer">/account</a>
        <a class="text-sm text-brand-600 hover:text-brand-800" href="/account.html" target="_blank" rel="noreferrer">/account.html</a>
        <a class="text-sm text-brand-600 hover:text-brand-800" href="/account/password" target="_blank" rel="noreferrer">/account/password</a>
      </div>
    </section>
  </div>
{/if}
