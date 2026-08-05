<script>
  import { onMount } from "svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import {
    deleteCustomUiAssets,
    getCustomUiStatus,
  } from "$lib/api/client.js";
  import {
    customUiActionAllowed,
    customUiMutationTarget,
    customUiReadBackConfirms,
    customUiStatusReady,
  } from "$lib/custom-ui-reconciliation.js";
  import { t } from "$lib/i18n.js";
  import { createDurableMutationLockStore } from "$lib/mutation-reconciliation.js";
  import { errorMessage, mutationOutcomeUnknown } from "$lib/resource-page.js";

  const CUSTOM_UI_LOCK_OWNER = "sign-in-experience";
  // 保留 upload 仅为恢复升级前的持久锁；新上传在 UI 与服务端均被阻断。
  const customUiMutationLockStore = createDurableMutationLockStore({
    storageKey: "supaoauth.admin.custom-ui-mutation-locks.v1",
    allowedActions: ["delete", "upload"],
    storageProvider: () => globalThis.localStorage,
  });

  let customUiStatus = $state(null);
  let loading = $state(true);
  let mutating = $state(false);
  let loadError = $state(null);
  let mutationError = $state(null);
  let reconciliationError = $state(null);
  let mutationStorageError = $state(null);
  let mutationLocks = $state({});
  let mutationStorageReady = $state(false);
  let notice = $state("");
  let outcomeUnknown = $derived(Object.keys(mutationLocks).length > 0);
  let statusReady = $derived(
    !loading && !loadError && customUiStatusReady(customUiStatus),
  );

  function timestamp(isoTimestamp) {
    return isoTimestamp
      ? new Date(isoTimestamp).toLocaleString()
      : t("common.notAvailable");
  }

  function fileSize(bytes) {
    if (!Number.isFinite(bytes)) return t("common.notAvailable");
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  async function readCustomUiStatus() {
    const status = await getCustomUiStatus();
    customUiStatus = status;
    return status;
  }

  async function loadStatus() {
    loading = true;
    loadError = null;
    try {
      await readCustomUiStatus();
    } catch (requestError) {
      loadError = requestError;
    } finally {
      loading = false;
    }
  }

  function updateMutationLocks(lockCommand) {
    try {
      mutationLocks = lockCommand();
      mutationStorageReady = true;
      mutationStorageError = null;
      return true;
    } catch (storageError) {
      mutationStorageReady = false;
      mutationStorageError = storageError;
      return false;
    }
  }

  function restoreMutationLocks() {
    return updateMutationLocks(() => customUiMutationLockStore.restore());
  }

  function mutationDescriptor(action, targetId) {
    return { action, ownerId: CUSTOM_UI_LOCK_OWNER, targetId };
  }

  function stageMutation(action, targetId) {
    if (!restoreMutationLocks() || Object.keys(mutationLocks).length > 0) return false;
    return updateMutationLocks(() => customUiMutationLockStore.stage(
      mutationLocks,
      mutationDescriptor(action, targetId),
    ));
  }

  function clearMutation(action, targetId) {
    return updateMutationLocks(() => customUiMutationLockStore.clear(
      mutationLocks,
      mutationDescriptor(action, targetId),
    ));
  }

  function mutationAllowed(action) {
    return mutationStorageReady
      && !mutating
      && !outcomeUnknown
      && statusReady
      && customUiActionAllowed(action, customUiStatus);
  }

  function beginMutation(action) {
    if (!mutationAllowed(action)) return null;
    const targetId = customUiMutationTarget(customUiStatus);
    if (!stageMutation(action, targetId)) return null;
    mutating = true;
    mutationError = null;
    reconciliationError = null;
    notice = "";
    return targetId;
  }

  async function reconcileLockedMutation(action, targetId) {
    reconciliationError = null;
    try {
      const status = await readCustomUiStatus();
      if (!customUiReadBackConfirms(action, targetId, status)) return false;
      if (!clearMutation(action, targetId)) return false;
      mutationError = null;
      return true;
    } catch (readBackError) {
      reconciliationError = readBackError;
      return false;
    }
  }

  async function recordMutationFailure(action, targetId, requestError) {
    mutationError = requestError;
    if (!mutationOutcomeUnknown(requestError)) {
      clearMutation(action, targetId);
      return;
    }
    if (await reconcileLockedMutation(action, targetId)) {
      notice = t("customUi.authoritativeReadBackConfirmed");
    }
  }

  async function removeCustomUi() {
    if (!mutationAllowed("delete")) return;
    if (!confirm(t("customUi.deleteConfirm"))) return;
    const targetId = beginMutation("delete");
    if (!targetId) return;
    try {
      const deletion = await deleteCustomUiAssets();
      if (await reconcileLockedMutation("delete", targetId)) {
        notice = deletion?.cleanup_pending || deletion?.audit_pending
          ? t("customUi.deletionPending")
          : t("customUi.deleted");
      }
    } catch (requestError) {
      await recordMutationFailure("delete", targetId, requestError);
    } finally {
      mutating = false;
    }
  }

  function beginReconciliation() {
    if (loading || mutating) return false;
    mutating = true;
    mutationError = null;
    reconciliationError = null;
    notice = "";
    if (restoreMutationLocks()) return true;
    mutating = false;
    return false;
  }

  function clearConfirmedMutations(status) {
    for (const lock of Object.values(mutationLocks)) {
      if (customUiReadBackConfirms(lock.action, lock.targetId, status)) {
        if (!clearMutation(lock.action, lock.targetId)) return false;
      }
    }
    return true;
  }

  async function reconcileStatus() {
    if (!beginReconciliation()) return;
    try {
      const status = await readCustomUiStatus();
      if (clearConfirmedMutations(status) && Object.keys(mutationLocks).length === 0) {
        notice = t("customUi.authoritativeReadBackConfirmed");
      }
    } catch (readBackError) {
      reconciliationError = readBackError;
    } finally {
      mutating = false;
    }
  }

  function acknowledgeUnknownMutation() {
    if (loading || mutating) return;
    if (!confirm(t("customUi.acknowledgeConfirm"))) return;
    if (!confirm(t("customUi.allowRetryConfirm"))) return;
    for (const lock of Object.values(mutationLocks)) {
      if (!clearMutation(lock.action, lock.targetId)) return;
    }
    mutationError = null;
    reconciliationError = null;
    notice = t("customUi.acknowledged");
  }

  onMount(() => {
    restoreMutationLocks();
    void loadStatus();
  });
</script>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">{t("customUi.title")}</h2>
    <p class="mt-1 max-w-3xl text-sm leading-6 text-surface-500">
      {t("customUi.description")}
    </p>
  </div>
  <div class="flex flex-wrap gap-2">
    <button
      type="button"
      onclick={removeCustomUi}
      disabled={!mutationAllowed("delete")}
      class="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
    >{t("customUi.delete")}</button>
  </div>
</div>

{#if notice}
  <div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
    {notice}
  </div>
{/if}
{#if mutationError}
  <div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
    {errorMessage(mutationError)}
  </div>
{/if}
{#if !mutationStorageReady && mutationStorageError}
  <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
    <p class="font-semibold text-amber-950">{t("customUi.storageUnavailableTitle")}</p>
    <p class="mt-1 text-sm leading-6 text-amber-900">{t("customUi.storageUnavailableDescription")}</p>
    <p class="mt-2 text-sm text-amber-900">{errorMessage(mutationStorageError)}</p>
    <button
      type="button"
      onclick={restoreMutationLocks}
      class="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
    >{t("customUi.retryStorage")}</button>
  </div>
{/if}
{#if outcomeUnknown}
  <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
    <p class="font-semibold text-amber-950">{t("customUi.outcomeUnknownTitle")}</p>
    <p class="mt-1 text-sm leading-6 text-amber-900">{t("customUi.outcomeUnknownDescription")}</p>
    {#if reconciliationError}
      <p class="mt-2 text-sm text-amber-900">{errorMessage(reconciliationError)}</p>
    {/if}
    <button
      type="button"
      onclick={reconcileStatus}
      disabled={loading || mutating}
      class="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
    >{t("customUi.reconcile")}</button>
    <button
      type="button"
      onclick={acknowledgeUnknownMutation}
      disabled={loading || mutating}
      class="ml-2 mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
    >{t("customUi.acknowledge")}</button>
  </div>
{/if}

<RequestState {loading} error={loadError} onRetry={loadStatus}>
  <div class="space-y-5">
    <section class="console-card p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 class="text-lg font-semibold text-surface-900">{t("customUi.lifecycleTitle")}</h3>
          <p class="mt-1 text-sm text-surface-500">{t(`customUi.status.${customUiStatus?.status || "disabled"}`)}</p>
        </div>
        <span class={customUiStatus?.status === "blocked_unsafe_origin"
          ? "rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
          : customUiStatus?.status === "cleanup_pending"
            ? "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
            : "rounded-full bg-surface-100 px-3 py-1 text-xs font-semibold text-surface-600"}
        >{t(`customUi.statusLabel.${customUiStatus?.status || "disabled"}`)}</span>
      </div>
      <dl class="mt-5 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
        <div><dt class="text-surface-500">{t("customUi.uploadedAt")}</dt><dd class="mt-1 font-medium text-surface-900">{timestamp(customUiStatus?.uploaded_at)}</dd></div>
        <div><dt class="text-surface-500">{t("customUi.fileCount")}</dt><dd class="mt-1 font-medium text-surface-900">{customUiStatus?.file_count ?? 0}</dd></div>
        <div><dt class="text-surface-500">{t("customUi.auditState")}</dt><dd class="mt-1 font-medium text-surface-900">{customUiStatus?.audit_pending ? t("customUi.pending") : t("customUi.settled")}</dd></div>
        <div><dt class="text-surface-500">{t("customUi.cleanupState")}</dt><dd class="mt-1 font-medium text-surface-900">{customUiStatus?.cleanup_pending ? t("customUi.pending") : t("customUi.settled")}</dd></div>
      </dl>
      {#if customUiStatus?.content_sha256}
        <p class="mt-5 break-all rounded-lg bg-surface-50 p-3 font-mono text-xs text-surface-600">
          SHA-256 · {customUiStatus.content_sha256}
        </p>
      {/if}
    </section>

    {#if customUiStatus?.files?.length}
      <section class="console-card overflow-hidden">
        <div class="border-b border-surface-100 p-5">
          <h3 class="font-semibold text-surface-900">{t("customUi.filesTitle")}</h3>
        </div>
        <div class="overflow-x-auto">
          <table>
            <thead><tr><th>{t("customUi.filePath")}</th><th>{t("customUi.fileType")}</th><th>{t("customUi.fileSize")}</th></tr></thead>
            <tbody>
              {#each customUiStatus.files as customUiFile (customUiFile.path)}
                <tr>
                  <td><code class="text-xs">{customUiFile.path}</code></td>
                  <td>{customUiFile.content_type}</td>
                  <td>{fileSize(customUiFile.size)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <section class="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h3 class="font-semibold text-amber-950">{t("customUi.securityTitle")}</h3>
      <p class="mt-2 text-sm leading-6 text-amber-900">{t("customUi.securityDescription")}</p>
    </section>
  </div>
</RequestState>
