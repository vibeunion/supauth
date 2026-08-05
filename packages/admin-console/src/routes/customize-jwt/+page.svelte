<script>
  import { onMount } from "svelte";
  import {
    SUPABASE_REQUIRED_CLAIMS,
    SUPABASE_RUNTIME_ROLES,
    SUPAOAUTH_CLAIM_KEYS,
    SUPAOAUTH_PERMISSION_PROJECTION_LIMIT,
    SUPAOAUTH_ROLE_PROJECTION_LIMIT,
  } from "@supauth/shared";
  import {
    getCompatibilityReport,
    getCustomAccessTokenHookStatus,
    getProject,
    verifyCustomAccessTokenHook,
  } from "$lib/api/client.js";
  import {
    authHookStatusIsActive,
    parseAuthHookStatus,
  } from "$lib/auth-hook-status.js";
  import { t } from "$lib/i18n.js";
  import {
    SUPAOAUTH_FIELD_TYPES,
    validateExtensionDraft,
  } from "$lib/jwt-preview.js";

  const hookPath = "/v1/auth-hooks/custom-access-token";
  const hookStateClasses = {
    active: "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700",
    inactive: "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700",
    loading: "rounded-full bg-surface-100 px-3 py-1 text-xs font-semibold text-surface-600",
    unavailable: "rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700",
  };
  const hookStateLabelKeys = {
    active: "Active",
    inactive: "Not effective",
    loading: "Loading...",
    unavailable: "state.unavailable",
  };
  const previewClaimValues = {
    iss: "https://project.supabase.co/auth/v1",
    aud: "authenticated",
    exp: 1900003600,
    iat: 1900000000,
    sub: "00000000-0000-4000-8000-000000000000",
    role: SUPABASE_RUNTIME_ROLES[1],
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-000000000001",
    email: "user@example.com",
    phone: "",
    is_anonymous: false,
  };
  const previewBaseClaims = Object.fromEntries(
    SUPABASE_REQUIRED_CLAIMS.map((claimName) => [
      claimName,
      previewClaimValues[claimName] ?? `<${claimName}>`,
    ]),
  );
  function extensionExample(projectRef, projection = {}) {
    return JSON.stringify(
    {
      app_metadata: {
        supaoauth: {
          schema_version: 2,
          projects: projectRef ? { [projectRef]: projection } : {},
        },
      },
    },
    null,
    2,
    );
  }

  let extensionDraft = $state(extensionExample());
  let compatibilityReport = $state(null);
  let compatibilityLoading = $state(true);
  let compatibilityError = $state(null);
  let projectLoading = $state(true);
  let projectError = $state(null);
  let hookStatus = $state(null);
  let hookLoading = $state(true);
  let hookError = $state(null);
  let verifying = $state(false);
  let verificationMessage = $state("");
  let verificationError = $state("");
  let validation = $derived.by(() => validateExtensionDraft(extensionDraft));
  let validationMessages = $derived.by(() =>
    validation.errors.map(validationMessage),
  );
  let claimPreview = $derived.by(() => buildClaimPreview(validation.value));
  let hookState = $derived.by(() => {
    if (hookLoading) return "loading";
    if (hookError) return "unavailable";
    return hookStatus?.registered && hookStatus?.verified
      ? "active"
      : "inactive";
  });

  function validationMessage(validationError) {
    const params = { ...validationError.params };
    if (params.expectedType)
      params.expectedType = t(`jwt.schemaType.${params.expectedType}`);
    return t(`jwt.error.${validationError.code}`, params);
  }

  function buildClaimPreview(validExtension) {
    return {
      ...previewBaseClaims,
      app_metadata: validExtension?.app_metadata || {},
    };
  }

  async function loadCompatibility() {
    compatibilityLoading = true;
    compatibilityError = null;
    try {
      compatibilityReport = await getCompatibilityReport();
    } catch (requestError) {
      compatibilityError = requestError.message;
    } finally {
      compatibilityLoading = false;
    }
  }

  async function loadProjectContext() {
    projectLoading = true;
    projectError = null;
    try {
      const project = await getProject();
      const projectRef = project?.ref || project?.project_ref || project?.id;
      if (!projectRef) throw new Error(t("common.notAvailable"));
      extensionDraft = extensionExample(projectRef, {
        roles: ["tenant_admin"],
        permissions: ["users.read"],
        current_org_id: "org_demo",
        current_org_role: "member",
      });
    } catch (requestError) {
      projectError = requestError.message;
    } finally {
      projectLoading = false;
    }
  }

  async function loadHookStatus() {
    hookLoading = true;
    hookError = null;
    hookStatus = null;
    try {
      const authoritativeStatus = parseAuthHookStatus(
        await getCustomAccessTokenHookStatus(),
      );
      if (!authoritativeStatus) throw new Error(t("jwt.hookStatusInvalid"));
      hookStatus = authoritativeStatus;
    } catch (requestError) {
      hookError = requestError.message;
    } finally {
      hookLoading = false;
    }
  }

  onMount(() => {
    void loadCompatibility();
    void loadProjectContext();
    void loadHookStatus();
  });

  async function verifyHook() {
    verifying = true;
    hookError = null;
    verificationMessage = "";
    verificationError = "";
    try {
      const verification = await verifyCustomAccessTokenHook();
      const authoritativeStatus = parseAuthHookStatus(
        await getCustomAccessTokenHookStatus(),
      );
      if (!authoritativeStatus) throw new Error(t("jwt.hookStatusInvalid"));
      hookStatus = authoritativeStatus;
      if (!authHookStatusIsActive(authoritativeStatus)) {
        verificationError = t("jwt.hookVerificationNotConfirmed");
        return;
      }
      verificationMessage =
        verification.message || t("JWT hook verification passed");
    } catch (requestError) {
      hookStatus = null;
      hookError = requestError.message;
    } finally {
      verifying = false;
    }
  }
</script>

<div class="mb-6">
  <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
    {t("jwt.eyebrow")}
  </p>
  <h2 class="mt-2 text-3xl font-bold text-surface-950">{t("jwt.title")}</h2>
  <p class="mt-2 max-w-3xl text-sm leading-6 text-surface-500">
    {t("jwt.description")}
  </p>
</div>

<div class="space-y-6">
  <section class="rounded-xl border border-amber-200 bg-amber-50 p-5" role="note">
    <h3 class="font-semibold text-amber-950">{t("jwt.readOnlyTitle")}</h3>
    <p class="mt-2 text-sm leading-6 text-amber-900">
      {t("jwt.readOnlyDescription")}
    </p>
  </section>

  <section class="rounded-xl border border-blue-200 bg-blue-50 p-5">
    <h3 class="font-semibold text-blue-950">
      {t("jwt.supabaseContractTitle")}
    </h3>
    <p class="mt-2 text-sm leading-6 text-blue-800">
      {t("jwt.supabaseContract")}
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      {#each SUPABASE_REQUIRED_CLAIMS as requiredClaim (requiredClaim)}
        <code
          class="rounded-full border border-blue-200 bg-white/70 px-2.5 py-1 text-xs text-blue-800"
          >{requiredClaim}</code
        >
      {/each}
    </div>
    <p class="mt-4 text-xs leading-5 text-blue-800">
      {t("jwt.runtimeRoles")}
      {#each SUPABASE_RUNTIME_ROLES as runtimeRole, roleIndex (runtimeRole)}
        <code class="rounded bg-white/70 px-1.5 py-0.5">{runtimeRole}</code
        >{roleIndex < SUPABASE_RUNTIME_ROLES.length - 1 ? "、" : ""}
      {/each}
    </p>
    <p class="mt-2 text-xs leading-5 text-blue-800">
      {t("jwt.projectionLimits", {
        roleLimit: SUPAOAUTH_ROLE_PROJECTION_LIMIT,
        permissionLimit: SUPAOAUTH_PERMISSION_PROJECTION_LIMIT,
      })}
    </p>
  </section>

  <section class="console-card p-6">
    <div class="mb-4">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("jwt.editorTitle")}
      </h3>
      <p class="mt-1 text-sm leading-6 text-surface-500">
        {t("jwt.editorDescription")}
      </p>
    </div>
    {#if projectLoading}
      <p class="mb-4 text-sm text-surface-400">{t("common.loading")}</p>
    {:else if projectError}
      <div
        class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        role="alert"
      >
        <p>{projectError}</p>
        <button
          type="button"
          onclick={loadProjectContext}
          class="mt-3 rounded-lg border border-red-300 px-3 py-1.5 font-medium text-red-800 hover:bg-red-100"
          >{t("Refresh")}</button
        >
      </div>
    {/if}
    <textarea
      bind:value={extensionDraft}
      aria-label={t("jwt.editorAria")}
      rows="16"
      spellcheck="false"
      class="w-full rounded-lg border border-surface-300 bg-surface-950 px-4 py-3 font-mono text-sm leading-6 text-surface-100 focus:border-brand-500 focus:outline-none"
    ></textarea>
    <div
      class="mt-4 rounded-lg border {validationMessages.length
        ? 'border-red-200 bg-red-50'
        : 'border-emerald-200 bg-emerald-50'} p-4"
    >
      {#if validationMessages.length}
        <p class="font-semibold text-red-800">{t("jwt.validationFailed")}</p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
          {#each validationMessages as validationErrorMessage (validationErrorMessage)}
            <li>{validationErrorMessage}</li>
          {/each}
        </ul>
      {:else}
        <p class="font-semibold text-emerald-800">{t("jwt.validationValid")}</p>
        <p class="mt-1 text-sm text-emerald-700">
          {t("jwt.validationValidHint")}
        </p>
      {/if}
    </div>
    <div class="mt-4">
      <p
        class="text-xs font-semibold uppercase tracking-[0.14em] text-surface-500"
      >
        {t("jwt.schemaTitle")}
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each Object.entries(SUPAOAUTH_FIELD_TYPES) as [fieldName, expectedType] (fieldName)}
          <code
            class="rounded-full border border-surface-200 bg-surface-50 px-2.5 py-1 text-xs text-surface-700"
          >
            {fieldName}: {t(`jwt.schemaType.${expectedType}`)}
          </code>
        {/each}
      </div>
    </div>
    <div class="mt-4">
      <p
        class="text-xs font-semibold uppercase tracking-[0.14em] text-surface-500"
      >
        {t("jwt.blockedTopLevelKeys")}
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each SUPAOAUTH_CLAIM_KEYS as blockedClaim (blockedClaim)}
          <code
            class="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700"
            >{blockedClaim}</code
          >
        {/each}
      </div>
    </div>
  </section>

  <section class="console-card p-6">
    <div class="mb-4">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("jwt.previewTitle")}
      </h3>
      <p class="mt-1 text-sm leading-6 text-surface-500">
        {t("jwt.previewDescription")}
      </p>
    </div>
    <pre
      class="max-h-[28rem] overflow-auto rounded-lg bg-surface-950 p-4 text-xs leading-6 text-surface-100">{JSON.stringify(
        claimPreview,
        null,
        2,
      )}</pre>
  </section>

  <section class="console-card p-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-lg font-semibold text-surface-900">
          {t("jwt.hookTitle")}
        </h3>
        <p class="mt-2 text-sm leading-6 text-surface-500">
          {t("jwt.hookDescription")}
        </p>
      </div>
      <span class={hookStateClasses[hookState]}
        >{t(hookStateLabelKeys[hookState])}</span
      >
    </div>
    {#if hookError}
      <div
        class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        role="alert"
      >
        <p>{hookError}</p>
        <button
          type="button"
          onclick={loadHookStatus}
          class="mt-3 rounded-lg border border-red-300 px-3 py-1.5 font-medium text-red-800 hover:bg-red-100"
          >{t("Refresh")}</button
        >
      </div>
    {/if}
    <div class="mt-4 rounded-lg bg-surface-950 p-4 text-sm text-white">
      <p><span class="text-surface-400">POST</span> <code>{hookPath}</code></p>
      <p class="mt-2">
        <span class="text-surface-400">Protocol</span>
        <code>Standard Webhooks v1</code>
      </p>
      <p class="mt-2">
        <span class="text-surface-400">Signed headers</span>
        <code>webhook-id</code>, <code>webhook-timestamp</code>,
        <code>webhook-signature</code>
      </p>
    </div>
    <p class="mt-3 text-xs leading-5 text-surface-500">{t("jwt.secretHint")}</p>
    <button
      disabled={hookLoading || verifying}
      onclick={verifyHook}
      class="mt-4 rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
      >{verifying ? t("Loading...") : t("Verify runtime hook")}</button
    >
    {#if verificationMessage}<p class="mt-3 text-sm text-emerald-700">
        {verificationMessage}
      </p>{/if}
    {#if verificationError}<p class="mt-3 text-sm text-red-700" role="alert">
        {verificationError}
      </p>{/if}
  </section>

  <section class="console-card p-6">
    <h3 class="text-lg font-semibold text-surface-900">
      {t("jwt.compatibilityTitle")}
    </h3>
    {#if compatibilityLoading}
      <p class="mt-3 text-surface-400">{t("common.loading")}</p>
    {:else if compatibilityError}
      <div
        class="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"
      >
        <p>{compatibilityError}</p>
        <button
          type="button"
          onclick={loadCompatibility}
          class="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
          >{t("Refresh")}</button
        >
      </div>
    {:else}
      <div class="mt-4 space-y-2">
        {#each compatibilityReport?.checks || [] as compatibilityCheck (compatibilityCheck.check_id)}
          {#if compatibilityCheck.check_id.startsWith("rb-") || compatibilityCheck.check_id.startsWith("sc-")}
            <div class="flex items-start gap-3 py-1">
              <span
                class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full {compatibilityCheck.status ===
                'pass'
                  ? 'bg-emerald-500'
                  : compatibilityCheck.status === 'fail'
                    ? 'bg-red-500'
                    : 'bg-amber-500'}"
              ></span>
              <span class="text-sm text-surface-700"
                >{compatibilityCheck.message}</span
              >
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
</div>
