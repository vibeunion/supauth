<script>
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import {
    listApplications,
    listConnectors,
    listOrganizations,
    listResources,
    resolvePublicSignInExperience,
  } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';

  let loading = $state(true);
  let error = $state(null);
  let onboardingSteps = $state([]);

  function listEntries(response) {
    return response?.items || response?.data || (Array.isArray(response) ? response : []);
  }

  onMount(async () => {
    try {
      const [applications, resources, organizations, connectors, signInExperience] = await Promise.all([
        listApplications(),
        listResources(),
        listOrganizations(),
        listConnectors(),
        resolvePublicSignInExperience(),
      ]);
      onboardingSteps = [
        { labelKey: 'dashboard.createApplication', complete: listEntries(applications).length > 0, path: '/applications' },
        { labelKey: 'dashboard.defineResources', complete: listEntries(resources).length > 0, path: '/api-resources' },
        { labelKey: 'dashboard.createOrganization', complete: listEntries(organizations).length > 0, path: '/organizations' },
        { labelKey: 'dashboard.configureConnector', complete: listEntries(connectors).some((connector) => connector.enabled), path: '/connectors' },
        { labelKey: 'dashboard.setSecurityPolicy', complete: Boolean(signInExperience?.password_policy), path: '/security' },
      ];
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  });
</script>

<div class="mb-8">
  <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{t('getStarted.eyebrow')}</p>
  <h2 class="mt-2 text-3xl font-bold text-surface-950">{t('getStarted.title')}</h2>
  <p class="mt-2 max-w-2xl text-sm leading-6 text-surface-500">{t('getStarted.description')}</p>
</div>

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else if error}
  <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    {#each onboardingSteps as onboardingStep, stepIndex (onboardingStep.path)}
      <a href={resolve(onboardingStep.path)} class="console-card console-card-hover flex items-start gap-4 p-5">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold {onboardingStep.complete ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-500'}">
          {onboardingStep.complete ? '✓' : stepIndex + 1}
        </span>
        <span>
          <span class="block font-semibold text-surface-900">{t(onboardingStep.labelKey)}</span>
          <span class="mt-1 block text-sm text-surface-500">{onboardingStep.complete ? t('getStarted.complete') : t('getStarted.open')}</span>
        </span>
      </a>
    {/each}
  </div>

  <div class="mt-6 rounded-xl border border-brand-200 bg-brand-50/60 p-5">
    <h3 class="font-semibold text-brand-900">{t('getStarted.supabaseTitle')}</h3>
    <p class="mt-2 text-sm leading-6 text-brand-800">{t('getStarted.supabaseDescription')}</p>
  </div>
{/if}
