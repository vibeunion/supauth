<script>
  import { t } from "$lib/i18n.js";

  let { name, capability = null } = $props();

  let available = $derived(capability?.available === true);
  let source = $derived(capability?.source || t("common.notAvailable"));
  let reasonCode = $derived(capability?.reason_code || null);

  function timestamp(isoTimestamp) {
    return isoTimestamp
      ? new Date(isoTimestamp).toLocaleString()
      : t("common.notAvailable");
  }
</script>

<article class="rounded-xl border border-surface-200 bg-white p-4">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h4 class="font-semibold text-surface-900">{t(`capability.name.${name}`)}</h4>
      <code class="mt-1 block break-all text-[11px] text-surface-400">{name}</code>
    </div>
    <span class={available
      ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
      : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"}
    >{available ? t("capability.available") : t("capability.unavailable")}</span>
  </div>
  <dl class="mt-4 grid gap-2 text-xs text-surface-600 sm:grid-cols-2">
    <div><dt class="text-surface-400">{t("capability.source")}</dt><dd class="mt-0.5 font-medium">{source}</dd></div>
    <div><dt class="text-surface-400">{t("capability.version")}</dt><dd class="mt-0.5 font-medium">{capability?.version || t("common.notAvailable")}</dd></div>
    <div class="sm:col-span-2"><dt class="text-surface-400">{t("capability.reason")}</dt><dd class="mt-0.5 break-all font-mono">{reasonCode || t("capability.ready")}</dd></div>
    <div class="sm:col-span-2"><dt class="text-surface-400">{t("capability.lastVerified")}</dt><dd class="mt-0.5">{timestamp(capability?.last_verified_at)}</dd></div>
  </dl>
</article>
