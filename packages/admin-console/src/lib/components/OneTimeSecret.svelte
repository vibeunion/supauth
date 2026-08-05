<script>
  import { t } from "$lib/i18n.js";

  let { secret } = $props();
  let copied = $state(false);
  let copyError = $state("");

  $effect(() => {
    if (!secret) return;
    copied = false;
    copyError = "";
  });

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      copied = true;
      copyError = "";
    } catch {
      copyError = t("application.secret.copyFailed");
    }
  }
</script>

<div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
  <p class="text-xs font-semibold text-amber-800">
    {t("application.secret.shownOnce")}
  </p>
  <div class="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
    <code class="min-w-0 flex-1 break-all text-sm text-amber-950">
      {secret}
    </code>
    <button
      type="button"
      onclick={copySecret}
      class="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-semibold text-amber-950 hover:bg-amber-100"
    >
      {copied ? t("application.secret.copied") : t("application.secret.copy")}
    </button>
  </div>
  {#if copyError}
    <p class="mt-2 text-sm text-red-700" role="alert">{copyError}</p>
  {/if}
</div>
