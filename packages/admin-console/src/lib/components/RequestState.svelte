<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n.js";
  import { errorMessage, requestErrorState } from "$lib/resource-page.js";
  import Button from '@svadmin/ui/components/ui/button/button.svelte';

  let {
    loading = false,
    error = null,
    empty = false,
    emptyTitle = "No data",
    emptyDescription = "",
    onRetry = null,
    children,
  }: {
    loading?: boolean;
    error?: unknown;
    empty?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    onRetry?: (() => void | Promise<unknown>) | null;
    children: Snippet;
  } = $props();

  const errorTitleKeys: Record<string, string> = {
    forbidden: "state.forbidden",
    not_found: "state.notFound",
    unsupported: "state.unsupported",
    unavailable: "state.unavailable",
    error: "state.requestFailed",
  };
  const errorDescriptionKeys: Record<string, string> = {
    forbidden: "state.forbiddenDescription",
    not_found: "state.notFoundDescription",
    unsupported: "state.unsupportedDescription",
    unavailable: "state.unavailableDescription",
  };

  let errorKind = $derived(requestErrorState(error) || "error");
  let errorTitle = $derived(
    t(errorTitleKeys[errorKind] || "state.requestFailed"),
  );
  let descriptionKey = $derived(errorDescriptionKeys[errorKind]);
  let errorDescription = $derived(
    descriptionKey
      ? t(descriptionKey)
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
      <Button
        type="button"
        onclick={onRetry}
        variant="outline"
        class="mt-4 border-red-300 text-red-800 hover:bg-red-100"
        >{t("Refresh")}</Button
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
