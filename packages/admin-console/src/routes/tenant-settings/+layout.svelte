<script>
  import { onMount } from "svelte";
  import PageTabs from "$lib/components/PageTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { getCapabilities } from "$lib/api/client.js";
  import { capabilityAvailable } from "$lib/resource-page.js";

  let { children } = $props();

  const baseTabs = [
    { path: "/tenant-settings/settings", labelKey: "tenant.tab.settings" },
    { path: "/tenant-settings/domains", labelKey: "tenant.tab.domains" },
    { path: "/tenant-settings/oidc-configs", labelKey: "tenant.tab.oidc" },
    { path: "/tenant-settings/advanced", labelKey: "tenant.tab.advanced" },
    {
      path: "/tenant-settings/diagnostics",
      labelKey: "tenant.tab.diagnostics",
    },
  ];
  let capabilities = $state(null);
  let capabilityError = $state(null);
  let capabilityLoading = $state(true);
  let tenantSettingsTabs = $derived(
    capabilityAvailable(capabilities, "tenant_collaborators_v1")
      ? [
          ...baseTabs,
          { path: "/tenant-settings/members", labelKey: "detail.members" },
        ]
      : baseTabs,
  );

  async function loadCapabilities() {
    capabilityLoading = true;
    capabilityError = null;
    try {
      capabilities = await getCapabilities();
    } catch (requestError) {
      capabilities = null;
      capabilityError = requestError;
    } finally {
      capabilityLoading = false;
    }
  }

  onMount(loadCapabilities);
</script>

<RequestState
  loading={capabilityLoading}
  error={capabilityError}
  onRetry={loadCapabilities}
>
  <PageTabs tabs={tenantSettingsTabs} />
  {@render children()}
</RequestState>
