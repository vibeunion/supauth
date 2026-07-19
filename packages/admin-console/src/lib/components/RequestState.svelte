<script>
  import { t } from "$lib/i18n.js";
  import { errorMessage, requestErrorState } from "$lib/resource-page.js";

  let {
    loading = false,
    error = null,
    empty = false,
    emptyTitle = "No data",
    emptyDescription = "",
    onRetry = null,
    children,
  } = $props();

  const errorTitleKeys = {
    forbidden: "state.forbidden",
    not_found: "state.notFound",
    unsupported: "state.unsupported",
    unavailable: "state.unavailable",
    error: "state.requestFailed",
  };
  const errorDescriptionKeys = {
    forbidden: "state.forbiddenDescription",
    not_found: "state.notFoundDescription",
    unsupported: "state.unsupportedDescription",
    unavailable: "state.unavailableDescription",
  };

  let errorKind = $derived(requestErrorState(error));
  let errorTitle = $derived(
    t(errorTitleKeys[errorKind] || "state.requestFailed"),
  );
  let errorDescription = $derived(
    errorDescriptionKeys[errorKind]
      ? t(errorDescriptionKeys[errorKind])
      : errorMessage(error),
  );
</script>

{#if loading}
  <div
    class="rounded-xl border border-surface-200 bg-white p-8 text-center text-sm text-surface-500"
    role="status"
  >
    {t("common.loading")}
  </div>
{:else if error}
  <div class="rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
    <h3 class="font-semibold text-red-900">{errorTitle}</h3>
    <p class="mt-1 text-sm text-red-700">{errorDescription}</p>
    {#if onRetry}
      <button
        type="button"
        onclick={onRetry}
        class="mt-4 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
        >{t("Refresh")}</button
      >
    {/if}
  </div>
{:else if empty}
  <div
    class="rounded-xl border border-surface-200 bg-surface-50 p-8 text-center"
  >
    <h3 class="font-medium text-surface-700">{t(emptyTitle)}</h3>
    {#if emptyDescription}<p class="mt-2 text-sm text-surface-500">
        {t(emptyDescription)}
      </p>{/if}
  </div>
{:else}
  {@render children()}
{/if}
