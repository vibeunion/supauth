<script lang="ts">
  import type { CapabilityStatus } from "@supauth/shared";
  import DataPanel from "@svadmin/ui/components/content/DataPanel.svelte";
  import DescriptionList from "@svadmin/ui/components/content/DescriptionList.svelte";
  import StatusBadge from "@svadmin/ui/components/content/StatusBadge.svelte";
  import { t } from "#lib/i18n.js";

  let { name, capability = null }: { name: string; capability?: CapabilityStatus | null | undefined } = $props();

  let available = $derived(capability?.available === true);
  let source = $derived(capability?.source || "unknown");
  let reasonCode = $derived(capability?.reason_code || null);

  const reasonKeys: Record<string, string> = {
    not_advertised_by_upstream: "capability.reason.notAdvertised",
    capability_negotiation_unavailable: "capability.reason.negotiationUnavailable",
    not_supported_by_runtime: "capability.reason.notSupported",
    runtime_verification_failed: "capability.reason.verificationFailed",
    configuration_required: "capability.reason.configurationRequired",
  };
  const sourceKeys: Record<string, string> = {
    gotrue: "capability.source.gotrue",
    supacloud: "capability.source.supacloud",
    supaoauth: "capability.source.supaoauth",
  };

  function capabilityLabel(capabilityName: string) {
    const translationKey = `capability.name.${capabilityName}`;
    const translatedLabel = t(translationKey);
    return translatedLabel === translationKey
      ? t("capability.platformFeature")
      : translatedLabel;
  }

  function reasonLabel(code: string | null) {
    if (!code) return t("capability.ready");
    return t(reasonKeys[code] || "capability.reason.unavailable");
  }

  function sourceLabel(authority: string) {
    return t(sourceKeys[authority] || "capability.source.unknown");
  }

  function timestamp(isoTimestamp: string | undefined) {
    return isoTimestamp
      ? new Date(isoTimestamp).toLocaleString()
      : t("common.notAvailable");
  }
</script>

<DataPanel title={capabilityLabel(name)} headingLevel="h3">
  {#snippet actions()}
    <StatusBadge
      status={available ? "success" : "warning"}
      label={available ? t("capability.available") : t("capability.unavailable")}
    />
  {/snippet}
  <DescriptionList
    columns={2}
    items={[
      { label: t("capability.source"), value: sourceLabel(source) },
      { label: t("capability.version"), value: capability?.version || t("common.notAvailable") },
      { label: t("capability.reason"), value: reasonLabel(reasonCode), span: 2 },
      { label: t("capability.lastVerified"), value: timestamp(capability?.last_verified_at), span: 2 },
    ]}
  />
</DataPanel>
