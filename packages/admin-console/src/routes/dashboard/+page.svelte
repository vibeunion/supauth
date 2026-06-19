<script>
  import { onMount } from 'svelte';
  import {
    getOAuthServerStatus,
    getDiscovery,
    getProject,
    getCompatibilityReport,
    listApplications,
    listResources,
    listOrganizations,
    listConnectors,
    resolvePublicSignInExperience,
  } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';

  let status = $state(null);
  let discovery = $state(null);
  let project = $state(null);
  let compatReport = $state(null);
  let onboarding = $state([]);
  let loading = $state(true);
  let error = $state(null);

  onMount(async () => {
    try {
      const [statusRes, discoveryRes, projectRes, compatRes, apps, resources, orgs, connectors, signIn] = await Promise.all([
        getOAuthServerStatus().catch(() => null),
        getDiscovery().catch(() => null),
        getProject().catch(() => null),
        getCompatibilityReport().catch(() => null),
        listApplications().catch(() => ({ items: [] })),
        listResources().catch(() => ({ items: [] })),
        listOrganizations().catch(() => ({ items: [] })),
        listConnectors().catch(() => []),
        resolvePublicSignInExperience().catch(() => null),
      ]);
      status = statusRes;
      discovery = discoveryRes;
      project = projectRes;
      compatReport = compatRes;
      const appItems = apps.items || apps.data || (Array.isArray(apps) ? apps : []);
      const resourceItems = resources.items || resources.data || (Array.isArray(resources) ? resources : []);
      const orgItems = orgs.items || orgs.data || (Array.isArray(orgs) ? orgs : []);
      const connectorItems = connectors.items || connectors.data || (Array.isArray(connectors) ? connectors : []);
      onboarding = [
        { label: t('dashboard.createApplication'), done: appItems.length > 0, path: '/applications' },
        { label: t('dashboard.defineResources'), done: resourceItems.length > 0, path: '/resources' },
        { label: t('dashboard.createOrganization'), done: orgItems.length > 0, path: '/organizations' },
        { label: t('dashboard.configureConnector'), done: connectorItems.some((item) => item.enabled), path: '/connectors' },
        { label: t('dashboard.setSecurityPolicy'), done: !!signIn?.password_policy, path: '/security' },
      ];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  });
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">{t('dashboard.title')}</h2>

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
{:else}
  <!-- Status cards -->
  {#if onboarding.length}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-8">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('dashboard.onboarding')}</h3>
      <div class="grid grid-cols-5 gap-3">
        {#each onboarding as item (item.label)}
          <a href={item.path} class="rounded-lg border border-surface-200 px-3 py-3 text-sm hover:border-brand-300 hover:bg-brand-50">
            <span class="block w-5 h-5 rounded-full mb-2 {item.done ? 'bg-green-500' : 'bg-surface-300'}"></span>
            <span class="font-medium text-surface-800">{item.label}</span>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <div class="grid grid-cols-3 gap-4 mb-8">
    <div class="bg-white rounded-xl border border-surface-200 p-5">
      <p class="text-sm text-surface-500 mb-1">{t('dashboard.oauthServer')}</p>
      <p class="text-xl font-bold {status?.enabled ? 'text-green-600' : 'text-surface-400'}">
        {status?.enabled ? t('dashboard.enabled') : t('dashboard.disabled')}
      </p>
      <p class="text-xs text-surface-400 mt-2">{t('dashboard.signing')}: {status?.signing_alg || t('common.notAvailable')}</p>
    </div>

    <div class="bg-white rounded-xl border border-surface-200 p-5">
      <p class="text-sm text-surface-500 mb-1">{t('dashboard.issuer')}</p>
      <p class="text-sm font-mono text-brand-700 break-all">{status?.issuer || t('common.notAvailable')}</p>
      <p class="text-xs text-surface-400 mt-2">{t('dashboard.migration')}: {status?.migration_status || t('common.notAvailable')}</p>
    </div>

    <div class="bg-white rounded-xl border border-surface-200 p-5">
      <p class="text-sm text-surface-500 mb-1">{t('dashboard.project')}</p>
      <p class="text-xl font-bold text-surface-900">{project?.name || t('common.notAvailable')}</p>
      <p class="text-xs text-surface-400 mt-2">{t('dashboard.ref')}: {project?.ref || t('common.notAvailable')}</p>
    </div>
  </div>

  <!-- OIDC Endpoints -->
  <div class="bg-white rounded-xl border border-surface-200 p-6 mb-8">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('dashboard.oidcEndpoints')}</h3>
    <div class="space-y-2">
      {#if discovery}
        {#each [
          [t('dashboard.authorization'), discovery.authorization_endpoint],
          [t('dashboard.token'), discovery.token_endpoint],
          [t('dashboard.userInfo'), discovery.userinfo_endpoint],
          ['JWKS', discovery.jwks_uri],
          [t('dashboard.discovery'), discovery.issuer + '/.well-known/openid-configuration'],
        ] as [label, url] (label)}
          <div class="flex items-center gap-4 py-2">
            <span class="text-sm font-medium text-surface-600 w-28 shrink-0">{label}</span>
            <code class="text-sm font-mono text-brand-700 break-all bg-surface-50 px-2 py-1 rounded flex-1">{url}</code>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Compatibility -->
  {#if compatReport?.checks?.length}
    <div class="bg-white rounded-xl border border-surface-200 p-6 mb-8">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('dashboard.supabaseCompatibility')}</h3>
      <div class="space-y-2">
        {#each compatReport.checks as check (check.check_id)}
          <div class="flex items-center gap-3 py-1">
            <span class="w-3 h-3 rounded-full {check.status === 'pass' ? 'bg-green-500' : check.status === 'fail' ? 'bg-red-500' : 'bg-yellow-500'}"></span>
            <span class="text-sm text-surface-700">{check.message}</span>
          </div>
        {/each}
      </div>
      <p class="text-xs text-surface-400 mt-3">{t('dashboard.checksPassed', { passed: compatReport.passed, total: compatReport.total })}</p>
    </div>
  {/if}

  <!-- Supported features -->
  {#if discovery}
    <div class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">{t('dashboard.supportedCapabilities')}</h3>
      <div class="flex flex-wrap gap-2">
        {#each discovery.scopes_supported || [] as scope (scope)}
          <span class="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-sm font-medium">{scope}</span>
        {/each}
        {#each discovery.code_challenge_methods_supported || [] as method (method)}
          <span class="px-3 py-1 bg-surface-100 text-surface-700 rounded-full text-sm font-medium">PKCE {method}</span>
        {/each}
        {#each discovery.id_token_signing_alg_values_supported || [] as alg (alg)}
          <span class="px-3 py-1 bg-surface-100 text-surface-700 rounded-full text-sm font-medium">{alg}</span>
        {/each}
      </div>
    </div>
  {/if}
{/if}
