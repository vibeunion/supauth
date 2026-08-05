<script>
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { getAuthConfigRuntimeConsistency, getProject, getSecurityStatus } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';
  import { adminAuthModeLabelKey } from '$lib/tenant-settings.js';

  let loading = $state(true);
  let error = $state(null);
  let project = $state(null);
  let securityStatus = $state(null);
  let runtimeConsistency = $state(null);

  onMount(async () => {
    try {
      [project, securityStatus, runtimeConsistency] = await Promise.all([
        getProject(),
        getSecurityStatus(),
        getAuthConfigRuntimeConsistency(),
      ]);
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  });
</script>

<div class="mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t('tenant.settingsTitle')}</h2>
  <p class="mt-1 text-sm text-surface-500">{t('tenant.settingsDescription')}</p>
</div>

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else if error}
  <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
{:else}
  <div class="grid gap-4 lg:grid-cols-3">
    <section class="console-card p-5">
      <p class="text-sm text-surface-500">{t('dashboard.project')}</p>
      <p class="mt-2 text-lg font-semibold text-surface-900">{project?.name || t('common.notAvailable')}</p>
      <code class="mt-2 block text-xs text-surface-500">{project?.ref || project?.id || t('common.notAvailable')}</code>
    </section>
    <section class="console-card p-5">
      <p class="text-sm text-surface-500">{t('tenant.adminAuth')}</p>
      <p class="mt-2 text-lg font-semibold text-surface-900">{securityStatus?.admin_auth_mode ? t(adminAuthModeLabelKey(securityStatus.admin_auth_mode)) : t('common.notAvailable')}</p>
      <p class="mt-2 text-xs text-surface-500">{t('tenant.rateLimit')}: {securityStatus?.rate_limit_rpm ?? t('common.notAvailable')}</p>
    </section>
    <section class="console-card p-5">
      <p class="text-sm text-surface-500">{t('tenant.runtimeConsistency')}</p>
      <p class="mt-2 text-lg font-semibold {runtimeConsistency?.consistent ? 'text-emerald-700' : 'text-amber-700'}">
        {runtimeConsistency?.consistent ? t('tenant.consistent') : t('tenant.reviewRequired')}
      </p>
    </section>
  </div>

  <div class="mt-6 grid gap-4 lg:grid-cols-2">
    <a href={resolve('/sign-in-experience')} class="console-card console-card-hover p-5">
      <h3 class="font-semibold text-surface-900">{t('nav.signInExperience')}</h3>
      <p class="mt-2 text-sm text-surface-500">{t('tenant.signInLinkHint')}</p>
    </a>
    <a href={resolve('/security')} class="console-card console-card-hover p-5">
      <h3 class="font-semibold text-surface-900">{t('nav.security')}</h3>
      <p class="mt-2 text-sm text-surface-500">{t('tenant.securityLinkHint')}</p>
    </a>
  </div>
{/if}
