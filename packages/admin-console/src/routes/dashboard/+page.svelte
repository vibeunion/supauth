<script>
  import { onMount } from "svelte";
  import {
    getOAuthServerStatus,
    getDiscovery,
    getProject,
    getCompatibilityReport,
    getCapabilities,
  } from "$lib/api/client.js";
  import CapabilityStatus from "$lib/components/CapabilityStatus.svelte";
  import { groupCapabilityEntries } from "$lib/capability-view.js";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { resolve } from "$app/paths";

  let status = $state(null);
  let discovery = $state(null);
  let project = $state(null);
  let compatReport = $state(null);
  let capabilities = $state({});
  let loading = $state(true);
  let error = $state(null);
  let capabilitiesLoading = $state(true);
  let capabilitiesError = $state(null);

  // Maps low-level migration status values to i18n keys; unknown values
  // fall back to the raw status text.
  const MIGRATION_STATUS_KEYS = {
    oidc_es256_migrated: "dashboard.migrationStatus.oidcEs256Migrated",
    pending: "dashboard.migrationStatus.pending",
  };

  function migrationStatusLabel(value) {
    if (!value) return t("common.notAvailable");
    const key = MIGRATION_STATUS_KEYS[value];
    return key ? t(key) : value;
  }

  // Truncates long internal project refs in the middle; the full value
  // stays available via the title tooltip.
  function formatProjectRef(ref) {
    if (!ref) return t("common.notAvailable");
    return ref.length > 24 ? `${ref.slice(0, 10)}…${ref.slice(-8)}` : ref;
  }
  let groupedCapabilities = $derived(groupCapabilityEntries(capabilities));
  let currentCapabilityEntries = $derived(groupedCapabilities.current);
  let waitingCapabilityEntries = $derived(groupedCapabilities.waiting);

  async function loadDashboard() {
    loading = true;
    error = null;
    try {
      const [statusRes, discoveryRes, projectRes, compatRes] = await Promise.all([
        getOAuthServerStatus(),
        getDiscovery(),
        getProject(),
        getCompatibilityReport(),
      ]);
      status = statusRes;
      discovery = discoveryRes;
      project = projectRes;
      compatReport = compatRes;
    } catch (requestError) {
      error = requestError.message;
    } finally {
      loading = false;
    }
  }

  async function loadCapabilities() {
    capabilitiesLoading = true;
    capabilitiesError = null;
    try {
      const capabilityResponse = await getCapabilities();
      capabilities = capabilityResponse?.capabilities || {};
    } catch (requestError) {
      capabilitiesError = requestError;
    } finally {
      capabilitiesLoading = false;
    }
  }

  onMount(() => {
    void loadDashboard();
    void loadCapabilities();
  });
</script>

<h2 class="text-2xl font-bold text-surface-900 mb-6">{t("dashboard.title")}</h2>

{#if loading}
  <p class="text-surface-400">{t("common.loading")}</p>
{:else if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
    {error}
  </div>
{:else}
  <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
    <div class="flex h-full flex-col rounded-xl border border-surface-200 bg-white p-5">
      <p class="text-sm text-surface-500 mb-1">{t("dashboard.oauthServer")}</p>
      <p
        class="text-xl font-bold {status?.enabled
          ? 'text-green-600'
          : 'text-surface-400'}"
      >
        {status?.enabled ? t("dashboard.enabled") : t("dashboard.disabled")}
      </p>
      <p class="mt-auto border-t border-surface-100 pt-3 text-xs text-surface-400">
        {t("dashboard.signing")}: {status?.signing_alg ||
          t("common.notAvailable")}
      </p>
    </div>

    <div class="flex h-full flex-col rounded-xl border border-surface-200 bg-white p-5">
      <p class="text-sm text-surface-500 mb-1">{t("dashboard.issuer")}</p>
      <p class="mb-3 break-all font-mono text-sm text-brand-700">
        {status?.issuer || t("common.notAvailable")}
      </p>
      <p class="mt-auto border-t border-surface-100 pt-3 text-xs text-surface-400">
        {t("dashboard.migration")}: {migrationStatusLabel(status?.migration_status)}
      </p>
    </div>

    <div class="flex h-full flex-col rounded-xl border border-surface-200 bg-white p-5">
      <p class="text-sm text-surface-500 mb-1">{t("dashboard.project")}</p>
      <p class="text-xl font-bold text-surface-900">
        {project?.name || t("common.notAvailable")}
      </p>
      <p class="mt-auto border-t border-surface-100 pt-3 text-xs text-surface-400">
        {t("dashboard.ref")}:
        <code class="font-mono" title={project?.ref || ""}>{formatProjectRef(project?.ref)}</code>
      </p>
    </div>
  </div>

  <!-- OIDC Endpoints -->
  <div class="mb-8 rounded-xl border border-surface-200 bg-white p-4 sm:p-6">
    <h3 class="text-lg font-semibold text-surface-800 mb-4">
      {t("dashboard.oidcEndpoints")}
    </h3>
    <div class="space-y-2">
      {#if discovery}
        {#each [[t("dashboard.authorization"), discovery.authorization_endpoint], [t("dashboard.token"), discovery.token_endpoint], [t("dashboard.userInfo"), discovery.userinfo_endpoint], ["JWKS", discovery.jwks_uri], [t("dashboard.discovery"), discovery.issuer + "/.well-known/openid-configuration"]] as [label, url] (label)}
          <div class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-4">
            <span class="text-sm font-medium text-surface-600 sm:w-28 sm:shrink-0"
              >{label}</span
            >
            <code
              class="w-full min-w-0 flex-1 break-all rounded bg-surface-50 px-2 py-1 font-mono text-sm text-brand-700"
              >{url}</code
            >
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Compatibility -->
  {#if compatReport?.checks?.length}
    <div class="mb-8 rounded-xl border border-surface-200 bg-white p-4 sm:p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">
        {t("dashboard.supabaseCompatibility")}
      </h3>
      <p class="text-xs text-surface-400 mt-3">
        {t("dashboard.checksPassed", {
          passed: compatReport.passed,
          total: compatReport.total,
        })}
      </p>
      <a
        href={resolve("/customize-jwt")}
        class="mt-3 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-900"
      >{t("dashboard.viewCompatibilityDetails")}</a>
    </div>
  {/if}

  <section class="mb-8 rounded-xl border border-surface-200 bg-surface-50 p-4 sm:p-6">
    <h3 class="text-lg font-semibold text-surface-800">
      {t("dashboard.identityCapabilities")}
    </h3>
    <p class="mt-1 text-sm leading-6 text-surface-500">
      {t("dashboard.identityCapabilitiesDescription")}
    </p>
    <div class="mt-5">
      <RequestState
        loading={capabilitiesLoading}
        error={capabilitiesError}
        onRetry={loadCapabilities}
      >
        <div class="space-y-6">
          <div>
            <h4 class="text-sm font-semibold text-surface-800">
              {t("dashboard.currentCapabilities")}
            </h4>
            <div class="mt-3 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {#each currentCapabilityEntries as [capabilityName, capability] (capabilityName)}
                <CapabilityStatus name={capabilityName} {capability} />
              {:else}
                <p class="text-sm text-surface-500">
                  {t("dashboard.noCurrentCapabilities")}
                </p>
              {/each}
            </div>
          </div>
          {#if waitingCapabilityEntries.length}
            <details class="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <summary class="cursor-pointer text-sm font-semibold text-amber-900">
                {t("dashboard.waitingCapabilities", {
                  count: waitingCapabilityEntries.length,
                })}
              </summary>
              <p class="mt-2 text-sm leading-6 text-amber-800">
                {t("dashboard.waitingCapabilitiesDescription")}
              </p>
              <div class="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {#each waitingCapabilityEntries as [capabilityName, capability] (capabilityName)}
                  <CapabilityStatus name={capabilityName} {capability} />
                {/each}
              </div>
            </details>
          {/if}
        </div>
      </RequestState>
    </div>
  </section>

  <!-- Supported features -->
  {#if discovery}
    <div class="rounded-xl border border-surface-200 bg-white p-4 sm:p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">
        {t("dashboard.supportedCapabilities")}
      </h3>
      <div class="flex flex-wrap gap-2">
        {#each discovery.scopes_supported || [] as scope (scope)}
          <span
            class="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-sm font-medium"
            >{scope}</span
          >
        {/each}
        {#each discovery.code_challenge_methods_supported || [] as method (method)}
          <span
            class="px-3 py-1 bg-surface-100 text-surface-700 rounded-full text-sm font-medium"
            >PKCE {method}</span
          >
        {/each}
        {#each discovery.id_token_signing_alg_values_supported || [] as alg (alg)}
          <span
            class="px-3 py-1 bg-surface-100 text-surface-700 rounded-full text-sm font-medium"
            >{alg}</span
          >
        {/each}
      </div>
    </div>
  {/if}
{/if}
