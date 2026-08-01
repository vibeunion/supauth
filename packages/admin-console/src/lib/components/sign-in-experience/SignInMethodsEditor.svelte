<script>
  import { onMount } from "svelte";
  import {
    getAuthConfig,
    getSignInExperience,
    updateAuthConfig,
    updateSignInExperience,
  } from "$lib/api/client.js";
  import { t } from "$lib/i18n.js";
  import { resolveAuthoritativeSignupEnabled } from "./signup-authority.js";
  import {
    canonicalStringSet,
    signInMethodsSettingsAuthority,
    settleAuthoritativeSettingsMutation,
  } from "$lib/authoritative-settings-readback.js";

  const signInMethods = [
    { value: "password", labelKey: "Password" },
    { value: "magic_link", labelKey: "Magic Link" },
    { value: "phone_otp", labelKey: "Phone OTP" },
  ];

  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let saved = $state(false);
  let reconciliationStatus = $state(null);
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

  async function readMethodsSnapshot() {
    const [signInExperience, authConfig] = await Promise.all([
      getSignInExperience(),
      getAuthConfig(),
    ]);
    return { signInExperience, authConfig };
  }

  function applyMethodsSnapshot(snapshot) {
    const { signInExperience, authConfig } = snapshot;
    signUpEnabled = resolveAuthoritativeSignupEnabled(authConfig);
    enabledMethods = (
      signInExperience?.sign_in_methods || ["password"]
    ).filter((methodName) =>
      signInMethods.some((method) => method.value === methodName),
    );
  }

  async function readMethods() {
    applyMethodsSnapshot(await readMethodsSnapshot());
  }

  async function loadMethods() {
    loading = true;
    saved = false;
    reconciliationStatus = null;
    error = null;
    try {
      await readMethods();
    } catch (requestError) {
      error = requestError.message;
    } finally {
      loading = false;
    }
  }

  function methodMutationDraft() {
    const methodsDraft = canonicalStringSet(
      [...enabledMethods],
      "sign_in_experience.sign_in_methods",
    );
    const signUpDraft = signUpEnabled;
    const command = {
      signInExperience: {
        sign_in_methods: methodsDraft,
        sign_up_enabled: signUpDraft,
      },
      authConfig: {
        enable_signup: signUpDraft,
        disable_signup: !signUpDraft,
      },
    };
    return { command, authority: signInMethodsSettingsAuthority(command) };
  }

  async function saveMethods() {
    saving = true;
    saved = false;
    reconciliationStatus = null;
    error = null;
    const mutationDraft = methodMutationDraft();
    try {
      const reconciliation = await settleAuthoritativeSettingsMutation({
        draft: mutationDraft,
        writeCommands: (command) => [
          () => updateSignInExperience(command.signInExperience),
          () => updateAuthConfig(command.authConfig),
        ],
        readSnapshot: readMethodsSnapshot,
        authorityFromSnapshot: signInMethodsSettingsAuthority,
      });
      if (reconciliation.status === "success") {
        applyMethodsSnapshot(reconciliation.readBackValue);
        saved = true;
      }
      else reconciliationStatus = reconciliation.status;
    } finally {
      saving = false;
    }
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
{#if reconciliationStatus}<div
    class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900"
    role="alert"
  >
    <p class="font-semibold">
      {t(`save.${reconciliationStatus}.title`)}
    </p>
    <p class="mt-1 text-sm text-amber-800">
      {t(`save.${reconciliationStatus}.description`)}
    </p>
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
