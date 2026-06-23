<script>
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  import { getAuthConfig, getOAuthServerStatus, getSignInExperience, updateSignInExperience, uploadBranding } from '$lib/api/client.js';

  let config = $state(null);
  let oauthStatus = $state(null);
  let signInExp = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let uploadingLogo = $state(false);
  let uploadingFavicon = $state(false);
  let themeDraft = $state({
    primary_color: '',
    description: '',
    background_url: '',
    button_label: '',
    custom_css: '',
    illustration: '',
    content: '',
  });
  const illustrationOptions = [
    { value: '', label: 'No Illustration' },
    { value: 'security', label: 'Security Illustration' },
    { value: 'identity', label: 'Identity Illustration' },
    { value: 'cloud', label: 'Cloud Illustration' },
  ];
  const structuredContentPlaceholder = JSON.stringify({
    layout: 'features',
    illustration: 'security',
    items: [
      { icon: 'shield', title: '标准认证协议', desc: 'OAuth 2.0 · OIDC' },
      { icon: 'users', title: '统一身份体系', desc: '人 · AI 服务 · 设备账号' },
      { icon: 'key', title: '细粒度权限', desc: '角色模板 · 策略级控权' },
      { icon: 'audit', title: '全链路审计', desc: '身份事件证据流' },
    ],
  }, null, 2);
  let savingTheme = $state(false);
  let themeSaved = $state(false);

  function resolveIllustration(content) {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return '';
    const illustration = typeof content.illustration === 'string' ? content.illustration : '';
    return illustrationOptions.some((option) => option.value === illustration) ? illustration : '';
  }

  function syncThemeDraft(experience) {
    const branding = experience?.branding || {};
    const contentObject = branding.content && typeof branding.content === 'object' && !Array.isArray(branding.content)
      ? branding.content
      : null;
    const content = branding.content
      ? (typeof branding.content === 'string' ? branding.content : JSON.stringify(branding.content, null, 2))
      : '';
    themeDraft = {
      primary_color: branding.primary_color || '',
      description: branding.description || '',
      background_url: branding.background_url || '',
      button_label: branding.button_label || '',
      custom_css: branding.custom_css || '',
      illustration: resolveIllustration(contentObject),
      content,
    };
  }

  function parseStructuredContent(value) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(t('Structured login content must be valid JSON.'));
    }
  }

  function buildStructuredContent() {
    const content = parseStructuredContent(themeDraft.content);
    const illustration = themeDraft.illustration.trim();

    if (Array.isArray(content)) {
      return illustration ? { illustration, items: content } : content;
    }
    if (!content || typeof content !== 'object') {
      return illustration ? { illustration } : content;
    }

    const nextContent = { ...content };
    if (illustration) {
      nextContent.illustration = illustration;
    } else {
      delete nextContent.illustration;
    }
    return nextContent;
  }

  async function saveTheme() {
    savingTheme = true;
    themeSaved = false;
    try {
      await updateSignInExperience({
        branding: {
          primary_color: themeDraft.primary_color.trim() || null,
          description: themeDraft.description.trim() || null,
          background_url: themeDraft.background_url.trim() || null,
          button_label: themeDraft.button_label.trim() || null,
          custom_css: themeDraft.custom_css.trim() || null,
          content: buildStructuredContent(),
        },
      });
      signInExp = await getSignInExperience();
      syncThemeDraft(signInExp);
      themeSaved = true;
      setTimeout(() => { themeSaved = false; }, 2000);
    } catch (e) {
      error = e.message;
    }
    savingTheme = false;
  }

  async function loadData() {
    loading = true;
    try {
      [config, oauthStatus, signInExp] = await Promise.all([
        getAuthConfig().catch(() => null),
        getOAuthServerStatus().catch(() => null),
        getSignInExperience().catch(() => null),
      ]);
      syncThemeDraft(signInExp);
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

<h2 class="text-2xl font-bold text-surface-900 mb-6">{t('Settings')}</h2>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">{t('Loading...')}</p>
{:else}
  <!-- OAuth Server -->
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('OAuth 2.0 / OIDC Server')}</h3>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-sm text-surface-500">{t('Status')}</p>
        <p class="font-medium {oauthStatus?.enabled ? 'text-green-600' : 'text-surface-400'}">
          {oauthStatus?.enabled ? t('Enabled') : t('Disabled')}
        </p>
      </div>
      <div>
        <p class="text-sm text-surface-500">{t('Signing Algorithm')}</p>
        <p class="font-medium text-surface-900">{oauthStatus?.signing_alg || 'HS256'}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">{t('Dynamic Registration')}</p>
        <p class="font-medium text-surface-900">{oauthStatus?.allow_dynamic_registration ? t('Enabled') : t('Disabled')}</p>
      </div>
      <div>
        <p class="text-sm text-surface-500">{t('Migration Status')}</p>
        <p class="font-medium text-surface-900">{oauthStatus?.migration_status || 'N/A'}</p>
      </div>
    </div>
  </div>

  <!-- Branding Assets (SupaCloud Storage) -->
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Branding Assets')}</h3>
    <p class="text-sm text-surface-500 mb-4">{t('Upload logo and favicon to SupaCloud Storage. Files are served from the public')} <code class="bg-surface-50 px-1 rounded">branding</code> {t('bucket.')}</p>

    <div class="grid grid-cols-2 gap-6">
      <!-- Logo -->
      <div>
        <p class="text-sm font-medium text-surface-700 mb-2">{t('Logo')}</p>
        {#if signInExp?.branding?.logo_url}
          <div class="mb-2">
            <img src={signInExp.branding.logo_url} alt={t('Logo')} class="h-16 w-auto rounded border border-surface-200">
            <p class="text-xs text-surface-400 mt-1 break-all">{signInExp.branding.logo_url}</p>
          </div>
        {/if}
        <label class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 cursor-pointer">
          {uploadingLogo ? t('Uploading...') : t('Upload Logo')}
          <input type="file" accept="image/*" class="hidden" onchange={(e) => handleBrandingUpload('logo', e)} disabled={uploadingLogo}>
        </label>
      </div>

      <!-- Favicon -->
      <div>
        <p class="text-sm font-medium text-surface-700 mb-2">{t('Favicon')}</p>
        {#if signInExp?.branding?.favicon_url}
          <div class="mb-2">
            <img src={signInExp.branding.favicon_url} alt={t('Favicon')} class="h-8 w-8 rounded border border-surface-200">
            <p class="text-xs text-surface-400 mt-1 break-all">{signInExp.branding.favicon_url}</p>
          </div>
        {/if}
        <label class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 cursor-pointer">
          {uploadingFavicon ? t('Uploading...') : t('Upload Favicon')}
          <input type="file" accept="image/*" class="hidden" onchange={(e) => handleBrandingUpload('favicon', e)} disabled={uploadingFavicon}>
        </label>
      </div>
    </div>
  </div>

  <!-- Sign-in Experience -->
  {#if signInExp}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Sign-in Experience')}</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-surface-500">{t('Sign-up')}</p>
          <p class="font-medium text-surface-900">{signInExp.sign_up_enabled ? t('Open') : t('Closed')}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('MFA Required')}</p>
          <p class="font-medium text-surface-900">{signInExp.mfa_required ? t('Yes') : t('No')}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('Password Min Length')}</p>
          <p class="font-medium text-surface-900">{signInExp.password_policy?.min_length || 8}</p>
        </div>
        {#if signInExp.branding?.primary_color}
          <div>
            <p class="text-sm text-surface-500">{t('Primary Color')}</p>
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded border border-surface-200" style="background-color: {signInExp.branding.primary_color}"></div>
              <span class="font-medium text-surface-900">{signInExp.branding.primary_color}</span>
            </div>
          </div>
        {/if}
      </div>

      <!-- 登录页整页主题：由 sign-in-experience 全局配置驱动，应用级配置可继续覆盖。 -->
      <div class="mt-6 pt-6 border-t border-surface-100">
        <h4 class="text-sm font-semibold text-surface-800 mb-1">{t('Tenant Login Page Theme')}</h4>
        <p class="text-xs text-surface-400 mb-4">{t('Controls the default hosted login page background, intro, button and CSS. Application overrides still take precedence.')}</p>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label for="login-primary-color" class="block text-sm font-medium text-surface-700 mb-1">{t('Primary Color')}</label>
            <div class="flex gap-2">
              <input id="login-primary-color" bind:value={themeDraft.primary_color} class="flex-1 px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="#2563eb">
              <div class="w-10 h-10 rounded-lg border border-surface-200" style:background-color={themeDraft.primary_color || '#ffffff'}></div>
            </div>
          </div>
          <div>
            <label for="login-button-label" class="block text-sm font-medium text-surface-700 mb-1">{t('Button Label')}</label>
            <input id="login-button-label" bind:value={themeDraft.button_label} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder={t('Sign In')}>
          </div>
          <div class="lg:col-span-2">
            <label for="login-background-url" class="block text-sm font-medium text-surface-700 mb-1">{t('Background URL')}</label>
            <input id="login-background-url" bind:value={themeDraft.background_url} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm" placeholder="https://...">
          </div>
          <div class="lg:col-span-2">
            <label for="login-illustration" class="block text-sm font-medium text-surface-700 mb-1">{t('Illustration Theme')}</label>
            <p class="text-xs text-surface-400 mb-2">{t('Optional built-in illustration rendered by the hosted login template. Stored as branding.content.illustration.')}</p>
            <select id="login-illustration" bind:value={themeDraft.illustration} class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm bg-white">
              {#each illustrationOptions as option (option.value)}
                <option value={option.value}>{t(option.label)}</option>
              {/each}
            </select>
          </div>
          <div class="lg:col-span-2">
            <label for="login-description" class="block text-sm font-medium text-surface-700 mb-1">{t('Login Page Intro')}</label>
            <p class="text-xs text-surface-400 mb-2">{t('Short system intro shown on the login page under the title. Leave empty to hide.')}</p>
            <textarea id="login-description" bind:value={themeDraft.description} rows="3" class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm font-sans resize-y" placeholder={t('Short system description...')}></textarea>
          </div>
          <div class="lg:col-span-2">
            <label for="login-content-json" class="block text-sm font-medium text-surface-700 mb-1">{t('Structured Login Content')}</label>
            <p class="text-xs text-surface-400 mb-2">{t('JSON feature items rendered by the hosted login template. Use custom-ui files for full-page custom HTML.')}</p>
            <textarea id="login-content-json" bind:value={themeDraft.content} rows="8" class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono resize-y" placeholder={structuredContentPlaceholder}></textarea>
          </div>
          <div class="lg:col-span-2">
            <label for="login-custom-css" class="block text-sm font-medium text-surface-700 mb-1">{t('Custom CSS')}</label>
            <p class="text-xs text-surface-400 mb-2">{t('Optional CSS applied to hosted login, account, claim and password pages.')}</p>
            <textarea id="login-custom-css" bind:value={themeDraft.custom_css} rows="6" class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono resize-y" placeholder={t('Custom CSS for the hosted login page')}></textarea>
          </div>
        </div>
        <div class="flex items-center gap-3 mt-2">
          <button onclick={saveTheme} disabled={savingTheme} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60">
            {savingTheme ? t('Saving...') : t('Save Login Experience')}
          </button>
          {#if themeSaved}
            <span class="text-sm text-green-600">{t('Saved')}</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Auth settings -->
  {#if config}
    <div class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Auth Configuration')}</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-surface-500">{t('Sign-up')}</p>
          <p class="font-medium text-surface-900">{config.enable_signup ? t('Open') : t('Closed')}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('Email Confirmations')}</p>
          <p class="font-medium text-surface-900">{config.enable_confirmations ? t('Required') : t('Auto-confirm')}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('Anonymous Users')}</p>
          <p class="font-medium text-surface-900">{config.external_anonymous_users_enabled ? t('Enabled') : t('Disabled')}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('JWT Expiry')}</p>
          <p class="font-medium text-surface-900">{config.jwt_expiry || 3600}s</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('Password Min Length')}</p>
          <p class="font-medium text-surface-900">{config.password_min_length || 8}</p>
        </div>
        <div>
          <p class="text-sm text-surface-500">{t('MFA Max Factors')}</p>
          <p class="font-medium text-surface-900">{config.mfa_max_enrolled_factors || 10}</p>
        </div>
      </div>
    </div>
  {/if}
{/if}
