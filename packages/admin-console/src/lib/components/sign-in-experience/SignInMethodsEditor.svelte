<script>
  import { onMount } from "svelte";
  import {
    getAuthConfig,
    getSignInExperience,
    updateAuthConfig,
    updateSignInExperience,
  } from "$lib/api/client.js";
  import { t } from "$lib/i18n.js";

  const signInMethods = [
    { value: "password", labelKey: "Password" },
    { value: "magic_link", labelKey: "Magic Link" },
    { value: "phone_otp", labelKey: "Phone OTP" },
  ];

  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let saved = $state(false);
  let signUpEnabled = $state(true);
  let enabledMethods = $state(["password"]);

  function setMethodEnabled(methodName, enabled) {
    if (enabled && !enabledMethods.includes(methodName))
      enabledMethods = [...enabledMethods, methodName];
    if (!enabled)
      enabledMethods = enabledMethods.filter(
        (configuredMethod) => configuredMethod !== methodName,
      );
  }

  async function loadMethods() {
    loading = true;
    error = null;
    try {
      const [signInExperience, authConfig] = await Promise.all([
        getSignInExperience(),
        getAuthConfig(),
      ]);
      signUpEnabled =
        signInExperience?.sign_up_enabled ?? authConfig?.enable_signup ?? true;
      enabledMethods = (
        signInExperience?.sign_in_methods || ["password"]
      ).filter((methodName) =>
        signInMethods.some((method) => method.value === methodName),
      );
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  }

  async function saveMethods() {
    saving = true;
    saved = false;
    error = null;
    try {
      await Promise.all([
        updateSignInExperience({
          sign_in_methods: enabledMethods,
          sign_up_enabled: signUpEnabled,
        }),
        updateAuthConfig({
          enable_signup: signUpEnabled,
          disable_signup: !signUpEnabled,
        }),
      ]);
      await loadMethods();
      saved = true;
    } catch (requestError) {
      error = requestError.message;
    }
    saving = false;
  }

  onMount(loadMethods);
</script>

<div class="mb-6 flex items-start justify-between gap-4">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">
      {t("signIn.methodsTitle")}
    </h2>
    <p class="mt-1 text-sm text-surface-500">
      {t("signIn.methodsDescription")}
    </p>
  </div>
  <button
    onclick={saveMethods}
    disabled={loading || saving || enabledMethods.length === 0}
    class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
  >
    {saving ? t("Saving...") : t("Save")}
  </button>
</div>

{#if error}<div
    class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"
  >
    {error}
  </div>{/if}
{#if saved}<div
    class="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700"
  >
    {t("Saved")}
  </div>{/if}

{#if loading}
  <p class="text-surface-400">{t("common.loading")}</p>
{:else}
  <div class="space-y-6">
    <section class="console-card p-6">
      <h3 class="mb-4 text-lg font-semibold text-surface-900">
        {t("Sign-in Methods")}
      </h3>
      <div class="grid gap-3 lg:grid-cols-2">
        {#each signInMethods as signInMethod (signInMethod.value)}
          <label
            class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
          >
            <span class="text-sm font-medium text-surface-800"
              >{t(signInMethod.labelKey)}</span
            >
            <input
              type="checkbox"
              checked={enabledMethods.includes(signInMethod.value)}
              onchange={(changeEvent) =>
                setMethodEnabled(
                  signInMethod.value,
                  changeEvent.currentTarget.checked,
                )}
            />
          </label>
        {/each}
      </div>
      {#if enabledMethods.length === 0}<p class="mt-3 text-sm text-red-600">
          {t("signIn.oneMethodRequired")}
        </p>{/if}
    </section>

    <section class="console-card p-6">
      <label class="flex items-center justify-between gap-4">
        <span>
          <span class="block font-semibold text-surface-900"
            >{t("Sign-up Enabled")}</span
          >
          <span class="mt-1 block text-sm text-surface-500"
            >{t("signIn.signUpRuntimeHint")}</span
          >
        </span>
        <input type="checkbox" bind:checked={signUpEnabled} />
      </label>
    </section>

    <div
      class="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-800"
    >
      {t("signIn.supabaseMethodBoundary")}
    </div>
  </div>
{/if}
