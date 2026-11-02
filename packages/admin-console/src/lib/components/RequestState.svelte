<script lang="ts">
  import type { Snippet } from "svelte";
  import DataState, { type DataStateKind } from "@svadmin/ui/components/content/DataState.svelte";
  import { definedOptions } from "@svadmin/core/options";
  import { t } from "#lib/i18n.js";
  import { errorMessage, requestErrorState } from "#lib/resource-page.js";

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
  let errorTitle = $derived(t(errorTitleKeys[errorKind] || "state.requestFailed"));
  let descriptionKey = $derived(errorDescriptionKeys[errorKind]);
  let errorDescription = $derived(
    descriptionKey ? t(descriptionKey) : errorMessage(error),
  );
  let dataState = $derived<DataStateKind | null>(
    loading ? "loading" : error ? (errorKind === "forbidden" ? "forbidden" : "error") : empty ? "empty" : null,
  );
  let dataTitle = $derived(
    loading ? t("common.loading") : error ? errorTitle : t(emptyTitle),
  );
  let dataDescription = $derived(
    loading ? undefined : error ? errorDescription : emptyDescription ? t(emptyDescription) : undefined,
  );
  let retryAction = $derived(
    error && onRetry ? () => { void onRetry?.(); } : undefined,
  );
</script>

{#if dataState}
  <DataState
    state={dataState}
    title={dataTitle}
    loadingLabel={t("common.loading")}
    retryLabel={t("Refresh")}
    {...definedOptions({ description: dataDescription, retry: retryAction })}
  />
{:else}
  {@render children()}
{/if}
