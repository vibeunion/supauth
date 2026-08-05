<script>
  import { t } from "$lib/i18n.js";

  let { name, capability = null } = $props();

  let available = $derived(capability?.available === true);
  let source = $derived(capability?.source || "unknown");
  let reasonCode = $derived(capability?.reason_code || null);

  const reasonKeys = {
    not_advertised_by_upstream: "capability.reason.notAdvertised",
    capability_negotiation_unavailable: "capability.reason.negotiationUnavailable",
    not_supported_by_runtime: "capability.reason.notSupported",
    runtime_verification_failed: "capability.reason.verificationFailed",
    configuration_required: "capability.reason.configurationRequired",
  };
  const sourceKeys = {
    gotrue: "capability.source.gotrue",
    supacloud: "capability.source.supacloud",
    supaoauth: "capability.source.supaoauth",
  };

  function capabilityLabel(capabilityName) {
    const translationKey = `capability.name.${capabilityName}`;
    const translatedLabel = t(translationKey);
    return translatedLabel === translationKey
      ? t("capability.platformFeature")
      : translatedLabel;
  }

  function reasonLabel(code) {
    if (!code) return t("capability.ready");
    return t(reasonKeys[code] || "capability.reason.unavailable");
  }

  function sourceLabel(authority) {
    return t(sourceKeys[authority] || "capability.source.unknown");
  }

  function timestamp(isoTimestamp) {
    return isoTimestamp
      ? new Date(isoTimestamp).toLocaleString()
      : t("common.notAvailable");
  }
</script>

<article class="rounded-xl border border-surface-200 bg-white p-4">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h4 class="font-semibold text-surface-900">{capabilityLabel(name)}</h4>
    </div>
    <span class={available
      ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
      : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"}
    >{available ? t("capability.available") : t("capability.unavailable")}</span>
  </div>
  <dl class="mt-4 grid gap-2 text-xs text-surface-600 sm:grid-cols-2">
    <div><dt class="text-surface-400">{t("capability.source")}</dt><dd class="mt-0.5 font-medium">{sourceLabel(source)}</dd></div>
    <div><dt class="text-surface-400">{t("capability.version")}</dt><dd class="mt-0.5 font-medium">{capability?.version || t("common.notAvailable")}</dd></div>
    <div class="sm:col-span-2"><dt class="text-surface-400">{t("capability.reason")}</dt><dd class="mt-0.5">{reasonLabel(reasonCode)}</dd></div>
    <div class="sm:col-span-2"><dt class="text-surface-400">{t("capability.lastVerified")}</dt><dd class="mt-0.5">{timestamp(capability?.last_verified_at)}</dd></div>
  </dl>
</article>
