<script>
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  import { getProject, getSecurityStatus, reconcileProject } from '$lib/api/client.js';

  let project = $state(null);
  let security = $state(null);
  let reconcile = $state(null);
  let loading = $state(true);
  let running = $state(false);
  let error = $state(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const [projectRes, securityRes] = await Promise.all([
        getProject(),
        getSecurityStatus(),
      ]);
      project = projectRes;
      security = securityRes;
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function runReconcile() {
    const projectRef = project?.ref || project?.id || project?.project_ref;
    if (!projectRef) {
      error = t('Project ref is unavailable');
      return;
    }
    running = true;
    error = null;
    try {
      reconcile = await reconcileProject(projectRef);
    } catch (e) {
      error = e.message;
    }
    running = false;
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t('Operations')}</h2>
  <button onclick={load} class="px-3 py-1.5 text-sm bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200">{t('Refresh')}</button>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">{error}</div>
{/if}

{#if loading}
  <p class="text-surface-400">{t('Loading...')}</p>
{:else}
  <div class="space-y-6">
    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Project Reconcile')}</h3>
      <p class="font-mono text-sm text-surface-600 mb-4">{project?.ref || project?.id || project?.project_ref || t('unknown project')}</p>
      <button onclick={runReconcile} disabled={running} class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
        {running ? t('Reconciling...') : t('Run Reconcile')}
      </button>
      {#if reconcile}
        <div class="mt-4 bg-surface-50 border border-surface-200 rounded-lg p-4">
          <p class="text-sm font-medium text-surface-800">{t('Fully provisioned:')} {reconcile.fully_provisioned ? t('yes') : t('no')}</p>
          <div class="mt-3 space-y-2">
            {#each reconcile.results || [] as result (`${result.step}-${result.status}`)}
              <p class="text-xs text-surface-600"><span class="font-mono">{result.step}</span>: {result.status}</p>
            {/each}
          </div>
        </div>
      {/if}
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('Security Gate')}</h3>
      {#if security}
        <div class="grid grid-cols-2 gap-3 text-sm">
          <p class="text-surface-600">{t('Admin auth:')} <span class="font-mono text-surface-900">{security.admin_auth_mode}</span></p>
          <p class="text-surface-600">{t('Token auth:')} <span class="font-mono text-surface-900">{security.token_auth_allowed ? t('allowed') : t('disabled')}</span></p>
          <p class="text-surface-600">{t('Rate limit:')} <span class="font-mono text-surface-900">{security.rate_limit_rpm}/min</span></p>
          <p class="text-surface-600">{t('Brute force protection:')} <span class="font-mono text-surface-900">{security.brute_force_protection ? t('on') : t('off')}</span></p>
        </div>
        {#if security.warnings?.length}
          <div class="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            {security.warnings.join(' · ')}
          </div>
        {/if}
      {:else}
        <p class="text-surface-500">{t('Security status unavailable')}</p>
      {/if}
    </section>
  </div>
{/if}
