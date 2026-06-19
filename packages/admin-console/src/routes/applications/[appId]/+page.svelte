<script>
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  import { page } from '$app/state';
  import { getApplication, updateApplication, deleteApplication, rotateApplicationSecret, listApplicationBindings, createApplicationBinding, deleteApplicationBinding, listResources, listApplicationSecrets, createApplicationSecret, disableApplicationSecret, getApplicationConsent, updateApplicationConsent, getApplicationSignInExperience, updateApplicationSignInExperience, deleteApplicationSignInExperience } from '$lib/api/client.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  const CONFIDENTIAL_AUTH_METHODS = [
    { value: 'client_secret_basic', label: 'client_secret_basic' },
    { value: 'client_secret_post', label: 'client_secret_post' },
  ];

  let appId = $derived(page.params.appId);
  let app = $state(null);
  let bindings = $state([]);
  let resources = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let editing = $state(false);
  let editForm = $state({ name: '', redirect_uris: '', grant_types: '', token_endpoint_auth_method: 'client_secret_basic' });
  let revealedSecret = $state(null);
  let applicationSecrets = $state([]);
  let newSecretName = $state('');
  let consent = $state({ user_scopes: '', organization_scopes: '', allowed_organization_ids: '', require_explicit_consent: true });
  let signInExperience = $state({
    enabled: false,
    page_title: '',
    primary_color: '',
    logo_url: '',
    favicon_url: '',
    background_url: '',
    button_label: '',
    custom_css: '',
  });
  let showBinding = $state(false);
  let newBinding = $state({ resource_id: '', scope_id: '' });

  function formatClientType(type) {
    if (type === 'public') return t('Public client');
    if (type === 'confidential') return t('Confidential client');
    return type || t('Confidential client');
  }

  function formatSecretStatus(status) {
    if (status === 'active') return t('Active');
    if (status === 'disabled') return t('Disabled');
    return status || t('common.notAvailable');
  }

  async function load() {
    loading = true;
    try {
      const [appData, bindingData, resData, secretData, consentData, signInData] = await Promise.all([
        getApplication(appId).catch(() => null),
        listApplicationBindings(appId).catch(() => ({ items: [] })),
        listResources().catch(() => ({ items: [] })),
        listApplicationSecrets(appId).catch(() => ({ items: [] })),
        getApplicationConsent(appId).catch(() => null),
        getApplicationSignInExperience(appId).catch(() => null),
      ]);
      app = appData;
      bindings = bindingData.items || [];
      resources = resData.items || [];
      applicationSecrets = secretData.items || [];
      if (consentData) {
        consent = {
          user_scopes: (consentData.userScopes || consentData.user_scopes || []).join(', '),
          organization_scopes: (consentData.organizationScopes || consentData.organization_scopes || []).join(', '),
          allowed_organization_ids: (consentData.allowedOrganizationIds || consentData.allowed_organization_ids || []).join(', '),
          require_explicit_consent: consentData.requireExplicitConsent ?? consentData.require_explicit_consent ?? true,
        };
      }
      if (signInData) {
        signInExperience = {
          enabled: signInData.enabled ?? false,
          page_title: signInData.branding?.page_title || '',
          primary_color: signInData.branding?.primary_color || '',
          logo_url: signInData.branding?.logo_url || '',
          favicon_url: signInData.branding?.favicon_url || '',
          background_url: signInData.branding?.background_url || '',
          button_label: signInData.branding?.button_label || '',
          custom_css: signInData.branding?.custom_css || '',
        };
      }
      if (app) {
        editForm = {
          name: app.client_name || '',
          redirect_uris: (app.redirect_uris || []).join(', '),
          grant_types: (app.grant_types || []).join(', '),
          token_endpoint_auth_method: app.token_endpoint_auth_method || 'client_secret_basic',
        };
      }
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleUpdate() {
    try {
      await updateApplication(appId, {
        client_name: editForm.name,
        redirect_uris: editForm.redirect_uris.split(',').map(s => s.trim()).filter(Boolean),
        grant_types: editForm.grant_types.split(',').map(s => s.trim()).filter(Boolean),
        token_endpoint_auth_method: app.client_type === 'public' ? 'none' : editForm.token_endpoint_auth_method,
      });
      editing = false;
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDelete() {
    if (!confirm(t('Delete this application permanently?'))) return;
    try {
      await deleteApplication(appId);
      goto(resolve('/applications'));
    } catch (e) {
      error = e.message;
    }
  }

  async function handleRotate() {
    if (!confirm(t('Rotate client secret? The old secret will be invalidated immediately.'))) return;
    try {
      const res = await rotateApplicationSecret(appId);
      if (res.client_secret) revealedSecret = res.client_secret;
    } catch (e) {
      error = e.message;
    }
  }

  async function handleCreateSecret() {
    try {
      const res = await createApplicationSecret(appId, { name: newSecretName || 'Client secret' });
      revealedSecret = res.secret;
      newSecretName = '';
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDisableSecret(secretId) {
    if (!confirm(t('Disable this client secret?'))) return;
    try {
      await disableApplicationSecret(appId, secretId);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleSaveConsent() {
    try {
      await updateApplicationConsent(appId, {
        user_scopes: consent.user_scopes.split(',').map(s => s.trim()).filter(Boolean),
        organization_scopes: consent.organization_scopes.split(',').map(s => s.trim()).filter(Boolean),
        allowed_organization_ids: consent.allowed_organization_ids.split(',').map(s => s.trim()).filter(Boolean),
        require_explicit_consent: consent.require_explicit_consent,
      });
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleSaveSignInExperience() {
    try {
      await updateApplicationSignInExperience(appId, {
        enabled: signInExperience.enabled,
        branding: {
          page_title: signInExperience.page_title || null,
          primary_color: signInExperience.primary_color || null,
          logo_url: signInExperience.logo_url || null,
          favicon_url: signInExperience.favicon_url || null,
          background_url: signInExperience.background_url || null,
          button_label: signInExperience.button_label || null,
          custom_css: signInExperience.custom_css || null,
        },
      });
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleClearSignInExperience() {
    if (!confirm(t('Clear application-specific sign-in experience?'))) return;
    try {
      await deleteApplicationSignInExperience(appId);
      signInExperience = {
        enabled: false,
        page_title: '',
        primary_color: '',
        logo_url: '',
        favicon_url: '',
        background_url: '',
        button_label: '',
        custom_css: '',
      };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleAddBinding() {
    try {
      await createApplicationBinding(appId, {
        resource_id: newBinding.resource_id,
        scope_id: newBinding.scope_id || undefined,
      });
      showBinding = false;
      newBinding = { resource_id: '', scope_id: '' };
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleDeleteBinding(bindingId) {
    try {
      await deleteApplicationBinding(appId, bindingId);
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<div class="mb-4">
  <a href={resolve('/applications')} class="text-sm text-brand-600 hover:text-brand-800">&larr; {t('Back to Applications')}</a>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">{t('Loading...')}</p>
{:else if !app}
  <div class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center">
    <p class="text-surface-500">{t('Application not found')}</p>
  </div>
{:else}
  <div class="flex items-start justify-between mb-6">
    <div>
      <h2 class="text-2xl font-bold text-surface-900">{app.client_name || app.client_id}</h2>
      <p class="text-sm font-mono text-surface-500 mt-1">{t('Client ID')}: {app.client_id}</p>
    </div>
    <div class="flex gap-2">
      <button onclick={() => editing = !editing} class="px-3 py-1.5 text-sm bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200">
        {editing ? t('Cancel') : t('Edit')}
      </button>
      <button onclick={handleRotate} class="px-3 py-1.5 text-sm bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100">{t('Rotate Secret')}</button>
      <button onclick={handleDelete} class="px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100">{t('Delete')}</button>
    </div>
  </div>

  {#if revealedSecret}
    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
      <p class="text-xs text-yellow-700 font-medium mb-1">{t('New Client Secret (shown only once)')}</p>
      <code class="text-sm font-mono text-yellow-900 break-all">{revealedSecret}</code>
      <button onclick={() => revealedSecret = null} class="ml-2 text-xs text-yellow-600">{t('Dismiss')}</button>
    </div>
  {/if}

  {#if editing}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Edit Application')}</h3>
      <div class="space-y-4">
        <div>
          <label for="application-name" class="block text-sm font-medium text-surface-700 mb-1">{t('Name')}</label>
          <input id="application-name" bind:value={editForm.name} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
        <div>
          <label for="application-redirect-uris" class="block text-sm font-medium text-surface-700 mb-1">{t('Redirect URIs (comma-separated)')}</label>
          <input id="application-redirect-uris" bind:value={editForm.redirect_uris} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
        <div>
          <label for="application-grant-types" class="block text-sm font-medium text-surface-700 mb-1">{t('Grant Types (comma-separated)')}</label>
          <input id="application-grant-types" bind:value={editForm.grant_types} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm">
        </div>
        {#if app.client_type !== 'public'}
          <div>
            <label for="application-auth-method" class="block text-sm font-medium text-surface-700 mb-1">{t('Token Endpoint Auth Method')}</label>
            <select id="application-auth-method" bind:value={editForm.token_endpoint_auth_method} class="px-3 py-2 border border-surface-300 rounded-lg text-sm">
              {#each CONFIDENTIAL_AUTH_METHODS as method (method.value)}
                <option value={method.value}>{method.label}</option>
              {/each}
            </select>
            <p class="mt-2 text-xs text-surface-500">{t('Use')} <code>client_secret_post</code> {t('for clients like Better Auth that send client credentials in the token request body.')}</p>
          </div>
        {/if}
        <button onclick={handleUpdate} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">{t('Save')}</button>
      </div>
    </div>
  {:else}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Details')}</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-surface-500">{t('Type')}</p>
          <p class="font-medium text-surface-900">{formatClientType(app.client_type)}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('Auth Method')}</p>
          <p class="font-medium text-surface-900">{app.token_endpoint_auth_method || 'client_secret_basic'}</p>
        </div>
      </div>
      {#if app.redirect_uris?.length}
        <div class="mt-4">
          <p class="text-sm text-surface-500 mb-2">{t('Redirect URIs')}</p>
          {#each app.redirect_uris as uri (uri)}
            <code class="text-xs font-mono text-brand-700 bg-surface-50 px-2 py-0.5 rounded block mb-1">{uri}</code>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
    <div class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Client Secrets')}</h3>
      <div class="flex gap-2 mb-4">
        <input bind:value={newSecretName} class="flex-1 px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder={t('Secret label')}>
        <button onclick={handleCreateSecret} class="px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">{t('Create')}</button>
      </div>
      {#if applicationSecrets.length === 0}
        <p class="text-sm text-surface-400">{t('No tracked client secrets yet.')}</p>
      {:else}
        <div class="space-y-2">
          {#each applicationSecrets as secret (secret.id)}
            <div class="flex items-center justify-between border-b border-surface-100 py-2">
              <div>
                <p class="text-sm font-medium text-surface-900">{secret.name}</p>
                <p class="text-xs font-mono text-surface-400">{secret.secretId || secret.secret_id} · {formatSecretStatus(secret.status)}</p>
              </div>
              {#if secret.status === 'active'}
                <button onclick={() => handleDisableSecret(secret.secretId || secret.secret_id)} class="text-xs text-red-600 hover:text-red-800">{t('Disable')}</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Consent Policy')}</h3>
      <div class="space-y-3">
        <input bind:value={consent.user_scopes} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder={t('User scopes, comma-separated')}>
        <input bind:value={consent.organization_scopes} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder={t('Organization scopes, comma-separated')}>
        <input bind:value={consent.allowed_organization_ids} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder={t('Allowed organization IDs, comma-separated')}>
        <label class="flex items-center gap-2 text-sm text-surface-700">
          <input type="checkbox" bind:checked={consent.require_explicit_consent}>
          {t('Require explicit consent')}
        </label>
        <button onclick={handleSaveConsent} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">{t('Save Consent')}</button>
      </div>
    </div>
  </div>

  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h3 class="text-lg font-semibold text-surface-800">{t('Application Login Experience')}</h3>
        <p class="text-sm text-surface-500 mt-1">{t('Overrides the tenant default login branding for this OAuth client.')}</p>
      </div>
      <label class="flex items-center gap-2 text-sm text-surface-700">
        <input type="checkbox" bind:checked={signInExperience.enabled}>
        {t('Enabled')}
      </label>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <label for="app-login-title" class="block text-sm font-medium text-surface-700 mb-1">{t('Page Title')}</label>
        <input id="app-login-title" bind:value={signInExperience.page_title} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder={app.client_name || 'SupaOAuth'}>
      </div>
      <div>
        <label for="app-login-button" class="block text-sm font-medium text-surface-700 mb-1">{t('Button Label')}</label>
        <input id="app-login-button" bind:value={signInExperience.button_label} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder={t('Sign In')}>
      </div>
      <div>
        <label for="app-login-primary" class="block text-sm font-medium text-surface-700 mb-1">{t('Primary Color')}</label>
        <div class="flex gap-2">
          <input id="app-login-primary" bind:value={signInExperience.primary_color} class="flex-1 px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="#2563eb">
          <div class="w-10 h-10 rounded-lg border border-surface-200" style:background-color={signInExperience.primary_color || '#ffffff'}></div>
        </div>
      </div>
      <div>
        <label for="app-login-logo" class="block text-sm font-medium text-surface-700 mb-1">{t('Logo URL')}</label>
        <input id="app-login-logo" bind:value={signInExperience.logo_url} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="https://...">
      </div>
      <div>
        <label for="app-login-favicon" class="block text-sm font-medium text-surface-700 mb-1">{t('Favicon URL')}</label>
        <input id="app-login-favicon" bind:value={signInExperience.favicon_url} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="https://...">
      </div>
      <div>
        <label for="app-login-background" class="block text-sm font-medium text-surface-700 mb-1">{t('Background URL')}</label>
        <input id="app-login-background" bind:value={signInExperience.background_url} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="https://...">
      </div>
    </div>

    <div class="mt-4">
      <label for="app-login-css" class="block text-sm font-medium text-surface-700 mb-1">{t('Custom CSS')}</label>
      <textarea id="app-login-css" bind:value={signInExperience.custom_css} rows="4" class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono" placeholder={t('Custom CSS for the hosted login page')}></textarea>
    </div>

    <div class="flex gap-2 mt-4">
      <button onclick={handleSaveSignInExperience} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">{t('Save Login Experience')}</button>
      <button onclick={handleClearSignInExperience} class="px-4 py-2 bg-surface-100 text-surface-700 rounded-lg text-sm font-medium hover:bg-surface-200">{t('Clear Override')}</button>
    </div>
  </div>

  <!-- Resource/Scope bindings -->
  <div class="bg-white rounded-xl border border-surface-200 p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-surface-800">{t('Resource Bindings')}</h3>
      <button onclick={() => showBinding = !showBinding} class="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">
        {showBinding ? t('Cancel') : `+ ${t('Bind Resource')}`}
      </button>
    </div>

    {#if showBinding}
      <div class="border border-surface-200 rounded-lg p-4 mb-4">
        <div class="flex gap-3">
          <select bind:value={newBinding.resource_id} class="px-3 py-2 border border-surface-300 rounded-lg text-sm flex-1">
            <option value="">{t('Select resource...')}</option>
            {#each resources as res (res.id)}
              <option value={res.id}>{res.name} ({res.indicator})</option>
            {/each}
          </select>
          <button onclick={handleAddBinding} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">{t('Bind')}</button>
        </div>
      </div>
    {/if}

    {#if bindings.length === 0}
      <p class="text-sm text-surface-400">{t('No resource bindings. Bind API resources to grant this application access to specific scopes.')}</p>
    {:else}
      <div class="space-y-2">
        {#each bindings as b (b.id)}
          <div class="flex items-center justify-between py-2 border-b border-surface-100">
            <div>
              <span class="text-sm font-medium text-surface-900">{b.resourceId}</span>
              {#if b.scopeId}
                <span class="ml-2 px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs">{b.scopeId}</span>
              {/if}
            </div>
            <button onclick={() => handleDeleteBinding(b.id)} class="text-xs text-red-500 hover:text-red-700">{t('Unbind')}</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
