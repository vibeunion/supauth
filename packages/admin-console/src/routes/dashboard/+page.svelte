<script lang="ts">
  import type { AdminEndpointResult } from "@supauth/shared";
  import { errorMessage } from "#lib/resource-page.js";
  import { onMount } from "svelte";
  import {
    getOAuthServerStatus,
    getDiscovery,
    getProject,
    getCompatibilityReport,
    getCapabilities,
  } from "#lib/api/client.js";
  import CapabilityStatus from "#lib/components/CapabilityStatus.svelte";
  import { groupCapabilityEntries } from "#lib/capability-view.js";
  import RequestState from "#lib/components/RequestState.svelte";
  import { t } from "#lib/i18n.js";
  import { resolve } from "#lib/sveltekit-paths.js";
  import ContentPageHeader from "@svadmin/ui/components/content/ContentPageHeader.svelte";
  import DataPanel from "@svadmin/ui/components/content/DataPanel.svelte";
  import DataState from "@svadmin/ui/components/content/DataState.svelte";
  import MetricBlock from "@svadmin/ui/components/content/MetricBlock.svelte";

  let status = $state<AdminEndpointResult<"getOAuthServerStatus"> | null>(null);
  let discovery = $state<AdminEndpointResult<"getDiscovery"> | null>(null);
  let project = $state<AdminEndpointResult<"getProject"> | null>(null);
  let compatReport = $state<AdminEndpointResult<"getCompatibilityReport"> | null>(null);
  let capabilities = $state<AdminEndpointResult<"getCapabilities">["capabilities"]>({});
  let loading = $state(true);
  let error = $state<string | null>(null);
  let capabilitiesLoading = $state(true);
  let capabilitiesError = $state<unknown>(null);

  // Maps low-level migration status values to i18n keys; unknown values
  // fall back to the raw status text.
  const MIGRATION_STATUS_KEYS: Record<string, string> = {
    oidc_es256_migrated: "dashboard.migrationStatus.oidcEs256Migrated",
    pending: "dashboard.migrationStatus.pending",
  };

  function migrationStatusLabel(value: string | null | undefined) {
    if (!value) return t("common.notAvailable");
    const key = MIGRATION_STATUS_KEYS[value];
    return key ? t(key) : value;
  }

  // Truncates long internal project refs in the middle; the full value
  // stays available via the title tooltip.
  function formatProjectRef(ref: string | undefined) {
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
      error = errorMessage(requestError);
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

<ContentPageHeader title={t("dashboard.title")} headingLevel="h2" />

{#if loading}
  <DataState state="loading" title={t("common.loading")} />
{:else if error}
  <DataState
    state="error"
    title={t("state.requestFailed")}
    description={error}
    retry={loadDashboard}
    retryLabel={t("Refresh")}
  />
{:else}
  <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
    <MetricBlock
      label={t("dashboard.oauthServer")}
      value={status?.enabled ? t("dashboard.enabled") : t("dashboard.disabled")}
      detail={`${t("dashboard.signing")}: ${status?.signing_alg || t("common.notAvailable")}`}
      trendTone={status?.enabled ? "positive" : "neutral"}
    />
    <MetricBlock
      label={t("dashboard.issuer")}
      value={(status && "issuer" in status && typeof status.issuer === "string" && status.issuer) || t("common.notAvailable")}
      detail={`${t("dashboard.migration")}: ${migrationStatusLabel(status?.migration_status)}`}
    />
    <MetricBlock
      label={t("dashboard.project")}
      value={project?.name || t("common.notAvailable")}
      detail={`${t("dashboard.ref")}: ${formatProjectRef(project?.ref)}`}
    />
  </div>

  <!-- OIDC Endpoints -->
  <DataPanel title={t("dashboard.oidcEndpoints")} headingLevel="h3" class="mb-8">
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
  </DataPanel>

  <!-- Compatibility -->
  {#if compatReport?.checks?.length}
    <DataPanel title={t("dashboard.supabaseCompatibility")} headingLevel="h3" class="mb-8">
      {#snippet actions()}
        <a
          href={resolve("/customize-jwt")}
          class="inline-flex text-sm font-semibold text-brand-700 hover:text-brand-900"
        >{t("dashboard.viewCompatibilityDetails")}</a>
      {/snippet}
      <p class="text-xs text-surface-400">
        {t("dashboard.checksPassed", {
          passed: compatReport.passed,
          total: compatReport.total,
        })}
      </p>
    </DataPanel>
  {/if}

  <DataPanel
    title={t("dashboard.identityCapabilities")}
    description={t("dashboard.identityCapabilitiesDescription")}
    headingLevel="h3"
    class="mb-8"
  >
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
  </DataPanel>

  <!-- Supported features -->
  {#if discovery}
    <DataPanel title={t("dashboard.supportedCapabilities")} headingLevel="h3">
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
    </DataPanel>
  {/if}
{/if}
