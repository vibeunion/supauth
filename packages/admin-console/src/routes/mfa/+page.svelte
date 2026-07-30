<script>
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import RequestState from "$lib/components/RequestState.svelte";
  import {
    getAuthConfig,
    listUsers,
    updateAuthConfig,
  } from "$lib/api/client.js";
  import { t } from "$lib/i18n.js";
  import { collectionItems } from "$lib/resource-page.js";

  let users = $state([]);
  let maximumEnrolledFactors = $state(10);
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state(null);
  let verifiedTotpFactors = $derived(
    users
      .flatMap((user) => user.factors || [])
      .filter(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "verified",
      ).length,
  );
  let usersWithVerifiedTotp = $derived(
    users.filter((user) =>
      (user.factors || []).some(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "verified",
      ),
    ).length,
  );

  function normalizeFactorLimit(rawLimit) {
    const parsedLimit = Number(rawLimit);
    if (!Number.isFinite(parsedLimit)) return 1;
    return Math.min(20, Math.max(1, Math.trunc(parsedLimit)));
  }

  async function loadMfaStatus() {
    loading = true;
    error = null;
    saved = false;
    try {
      const [authConfig, userResponse] = await Promise.all([
        getAuthConfig(),
        listUsers({ page: 1, limit: 100 }),
      ]);
      maximumEnrolledFactors = authConfig.mfa_max_enrolled_factors ?? 10;
      users = collectionItems(userResponse);
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
  }

  async function saveFactorLimit() {
    saving = true;
    error = null;
    saved = false;
    try {
      maximumEnrolledFactors = normalizeFactorLimit(maximumEnrolledFactors);
      await updateAuthConfig({
        mfa_max_enrolled_factors: maximumEnrolledFactors,
      });
      await loadMfaStatus();
      saved = true;
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  onMount(loadMfaStatus);
</script>

<div class="mb-6 flex items-start justify-between gap-4">
  <div>
    <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
      {t("mfa.eyebrow")}
    </p>
    <h2 class="mt-2 text-3xl font-bold text-surface-950">{t("mfa.title")}</h2>
    <p class="mt-2 max-w-2xl text-sm leading-6 text-surface-500">
      {t(
        "GoTrue owns TOTP enrollment, challenge, verification, factor removal, AAL claims, and session issuance.",
      )}
    </p>
  </div>
  <button
    onclick={saveFactorLimit}
    disabled={loading || saving}
    class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >{saving ? t("Saving...") : t("Save")}</button
  >
</div>
{#if saved}<div
    class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-700"
  >
    {t("Saved")}
  </div>{/if}

<RequestState {loading} {error} onRetry={loadMfaStatus}>
  <div class="space-y-6">
    <div class="grid gap-4 md:grid-cols-3">
      <section class="console-card p-5">
        <p
          class="text-xs font-semibold uppercase tracking-wide text-surface-500"
        >
          {t("MFA method")}
        </p>
        <p class="mt-2 text-2xl font-bold text-surface-950">TOTP</p>
      </section>
      <section class="console-card p-5">
        <p
          class="text-xs font-semibold uppercase tracking-wide text-surface-500"
        >
          {t("mfa.loadedVerifiedFactors")}
        </p>
        <p class="mt-2 text-2xl font-bold text-surface-950">
          {verifiedTotpFactors}
        </p>
      </section>
      <section class="console-card p-5">
        <p
          class="text-xs font-semibold uppercase tracking-wide text-surface-500"
        >
          {t("mfa.loadedUsersWithVerifiedTotp")}
        </p>
        <p class="mt-2 text-2xl font-bold text-surface-950">
          {usersWithVerifiedTotp}
        </p>
        <p class="mt-1 text-xs text-surface-500">
          {t("mfa.aalCapabilityHint")}
        </p>
      </section>
    </div>
    <p class="text-xs text-surface-500">{t("mfa.loadedUserLimitHint")}</p>
    <section class="console-card p-6">
      <label
        for="mfa-factor-limit"
        class="mb-1 block text-sm font-medium text-surface-700"
        >{t("MFA Max Factors")}</label
      ><input
        id="mfa-factor-limit"
        type="number"
        min="1"
        max="20"
        step="1"
        bind:value={maximumEnrolledFactors}
        class="w-full max-w-xs"
      />
      <p class="mt-2 text-sm text-surface-500">{t("mfa.factorLimitHint")}</p>
    </section>
    <section class="rounded-xl border border-blue-200 bg-blue-50 p-5">
      <h3 class="font-semibold text-blue-950">
        {t("mfa.supabaseBoundaryTitle")}
      </h3>
      <p class="mt-2 text-sm leading-6 text-blue-800">
        {t("mfa.supabaseBoundary")}
      </p>
    </section>
    <a
      href={resolve("/users")}
      class="inline-flex items-center text-sm font-semibold text-brand-700 hover:text-brand-900"
      >{t("mfa.manageUserFactors")} →</a
    >
  </div>
</RequestState>
