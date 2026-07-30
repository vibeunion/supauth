<script>
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { AdminApiError } from "$lib/admin-api.js";
  import { t } from "$lib/i18n.js";
  import { capabilityAvailable, tabFromRoute } from "$lib/resource-page.js";
  import {
    getCapabilities,
    getEnterpriseSSOConfig,
    updateEnterpriseSSOConfig,
  } from "$lib/api/client.js";

  const baseTabs = [
    { value: "connection", labelKey: "detail.connection" },
    { value: "experience", labelKey: "detail.experience" },
  ];

  let configuration = $state(null);
  let capabilities = $state(null);
  let form = $state({
    domains: "",
    sso_protocol: "oidc",
    jit_provisioning: true,
    org_membership_mapping: "{}",
    role_mapping: "{}",
  });
  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let configId = $derived(page.params.configId);
  let idpInitiatedAvailable = $derived(
    capabilityAvailable(capabilities, "enterprise_sso_idp_initiated_v1"),
  );
  let tabs = $derived(
    idpInitiatedAvailable
      ? [...baseTabs, { value: "idp", labelKey: "detail.idpInitiated" }]
      : baseTabs,
  );
  let requestedTab = $derived(page.params.tab || "connection");
  let activeTab = $derived(
    tabFromRoute(
      requestedTab,
      tabs.map((tab) => tab.value),
      "connection",
    ),
  );
  let tabError = $derived(
    capabilities && requestedTab !== activeTab
      ? new AdminApiError(
          t("state.unsupportedDescription"),
          501,
          "capability_unavailable",
        )
      : null,
  );

  async function loadConfiguration() {
    loading = true;
    error = null;
    try {
      [configuration, capabilities] = await Promise.all([
        getEnterpriseSSOConfig(configId),
        getCapabilities(),
      ]);
      form = {
        domains: (configuration.domains || []).join(", "),
        sso_protocol:
          configuration.ssoProtocol || configuration.sso_protocol || "oidc",
        jit_provisioning:
          configuration.jitProvisioning ??
          configuration.jit_provisioning ??
          true,
        org_membership_mapping: JSON.stringify(
          configuration.orgMembershipMapping ||
            configuration.org_membership_mapping ||
            {},
          null,
          2,
        ),
        role_mapping: JSON.stringify(
          configuration.roleMapping || configuration.role_mapping || {},
          null,
          2,
        ),
      };
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
  }

  async function saveConfiguration() {
    saving = true;
    error = null;
    try {
      await updateEnterpriseSSOConfig(configId, {
        domains: form.domains
          .split(",")
          .map((domain) => domain.trim())
          .filter(Boolean),
        sso_protocol: form.sso_protocol,
        jit_provisioning: form.jit_provisioning,
        org_membership_mapping: JSON.parse(form.org_membership_mapping || "{}"),
        role_mapping: JSON.parse(form.role_mapping || "{}"),
      });
      await loadConfiguration();
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  onMount(loadConfiguration);
</script>

<div class="mb-5">
  <a
    href={resolve("/enterprise-sso")}
    class="text-sm font-medium text-brand-700 hover:text-brand-900"
    >← {t("Enterprise SSO")}</a
  >
  <h2 class="mt-4 text-3xl font-bold text-surface-950">
    {configuration?.connectorId || configuration?.connector_id || configId}
  </h2>
  <p class="mt-1 font-mono text-xs text-surface-500">{configId}</p>
</div>
<DetailTabs
  {tabs}
  {activeTab}
  basePath={`/enterprise-sso/${encodeURIComponent(configId)}`}
/>

<RequestState {loading} error={error || tabError} onRetry={loadConfiguration}>
  {#if activeTab === "connection"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.connection")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="sso-protocol"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Protocol")}</label
          ><select
            id="sso-protocol"
            bind:value={form.sso_protocol}
            class="w-full"
            ><option value="oidc">OIDC</option><option value="saml">SAML</option
            ></select
          >
        </div>
        <div>
          <label
            for="sso-domains"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Domains")}</label
          ><input id="sso-domains" bind:value={form.domains} class="w-full" />
        </div>
      </div>
      <button
        disabled={saving}
        onclick={saveConfiguration}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else if activeTab === "experience"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("detail.experience")}
      </h3>
      <label
        class="mt-4 flex items-center justify-between rounded-lg border border-surface-200 p-4"
        ><span
          ><span class="block font-medium text-surface-900"
            >{t("JIT provisioning")}</span
          ><span class="mt-1 block text-sm text-surface-500"
            >{t(
              "Provision users through the inbound GoTrue connector after successful identity verification.",
            )}</span
          ></span
        ><input type="checkbox" bind:checked={form.jit_provisioning} /></label
      >
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="sso-org-map"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Org Mapping JSON")}</label
          ><textarea
            id="sso-org-map"
            rows="8"
            bind:value={form.org_membership_mapping}
            class="w-full font-mono"
          ></textarea>
        </div>
        <div>
          <label
            for="sso-role-map"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Role Mapping JSON")}</label
          ><textarea
            id="sso-role-map"
            rows="8"
            bind:value={form.role_mapping}
            class="w-full font-mono"
          ></textarea>
        </div>
      </div>
      <button
        disabled={saving}
        onclick={saveConfiguration}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else}
    <section class="rounded-xl border border-blue-200 bg-blue-50 p-6">
      <h3 class="font-semibold text-blue-950">{t("detail.idpInitiated")}</h3>
      <p class="mt-2 text-sm leading-6 text-blue-800">
        {t(
          "This project reports verified IdP-initiated inbound SSO support. SupaOAuth remains a service provider and never acts as a SAML identity provider.",
        )}
      </p>
    </section>
  {/if}
</RequestState>
