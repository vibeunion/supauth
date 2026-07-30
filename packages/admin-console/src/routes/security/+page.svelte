<script>
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { collectionItems, tabFromRoute } from "$lib/resource-page.js";
  import {
    getAuthConfig,
    getAuthConfigRuntimeConsistency,
    getBeforeUserCreatedHookStatus,
    getSecurityConfig,
    listTenantConfigs,
    updateAuthConfig,
    updateSecurityConfig,
    upsertTenantConfig,
  } from "$lib/api/client.js";

  const tabs = [
    { value: "password", labelKey: "detail.password" },
    { value: "captcha", labelKey: "detail.captcha" },
    { value: "blocklist", labelKey: "detail.blocklist" },
    { value: "general", labelKey: "detail.general" },
  ];
  const tabValues = tabs.map((tab) => tab.value);
  const standardCharacterPolicy =
    "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";
  const strongCharacterPolicy = `${standardCharacterPolicy}:!@#$%^&*()_+-=[]{};'\\\\:"|<>?,./\`~`;

  let authConfig = $state(null);
  let runtimeConsistency = $state(null);
  let passwordForm = $state({
    password_min_length: 8,
    character_policy: "none",
  });
  let captchaForm = $state({
    provider: "none",
    enabled: false,
    secret: "",
    secret_configured: false,
  });
  let blocklistForm = $state({
    allowed_email_domains: "",
    blocked_email_domains: "",
    blocked_oauth_providers: "",
    allowed_oauth_providers: "",
    invite_only: false,
    hook_registered: false,
    hook_verified: false,
    hook_reason_code: null,
  });
  let generalForm = $state({
    jwt_expiry: 3600,
    enable_confirmations: false,
    external_anonymous_users_enabled: false,
    brute_force_protection: true,
    max_login_attempts: 10,
  });
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state(null);
  let activeTab = $derived(
    tabFromRoute(page.params.tab, tabValues, "password"),
  );

  function requiredCharacters() {
    if (passwordForm.character_policy === "strong")
      return strongCharacterPolicy;
    if (passwordForm.character_policy === "standard")
      return standardCharacterPolicy;
    return "";
  }

  function initializePasswordForm() {
    const required = authConfig.password_required_characters || "";
    passwordForm = {
      password_min_length: authConfig.password_min_length ?? 8,
      character_policy:
        required === strongCharacterPolicy
          ? "strong"
          : required === standardCharacterPolicy
            ? "standard"
            : "none",
    };
  }

  function initializeGeneralForm(securityConfig) {
    generalForm = {
      jwt_expiry: authConfig.jwt_expiry ?? 3600,
      enable_confirmations: authConfig.enable_confirmations ?? false,
      external_anonymous_users_enabled:
        authConfig.external_anonymous_users_enabled ?? false,
      brute_force_protection:
        securityConfig.bruteForceProtection ??
        securityConfig.brute_force_protection ??
        true,
      max_login_attempts:
        securityConfig.maxLoginAttempts ??
        securityConfig.max_login_attempts ??
        10,
    };
  }

  function initializeBlocklistForm(authHookConfig, hookStatus) {
    blocklistForm = {
      allowed_email_domains: (
        authHookConfig?.value?.allowed_email_domains || []
      ).join(", "),
      blocked_email_domains: (
        authHookConfig?.value?.blocked_email_domains || []
      ).join(", "),
      blocked_oauth_providers: (
        authHookConfig?.value?.blocked_oauth_providers || []
      ).join(", "),
      allowed_oauth_providers: (
        authHookConfig?.value?.allowed_oauth_providers || []
      ).join(", "),
      invite_only: authHookConfig?.value?.invite_only === true,
      hook_registered: hookStatus?.registered === true,
      hook_verified: hookStatus?.verified === true,
      hook_reason_code: hookStatus?.reason_code || null,
    };
  }

  function initializeCaptchaForm(captchaConfig) {
    captchaForm = {
      provider: "none",
      enabled: false,
      secret: "",
      secret_configured: false,
      ...(captchaConfig?.value || {}),
    };
    captchaForm.secret = "";
  }

  function initializeForms(
    securityConfig,
    captchaConfig,
    authHookConfig,
    beforeUserCreatedHookStatus,
  ) {
    initializePasswordForm();
    initializeGeneralForm(securityConfig);
    initializeBlocklistForm(authHookConfig, beforeUserCreatedHookStatus);
    initializeCaptchaForm(captchaConfig);
  }

  async function loadSecurity() {
    loading = true;
    error = null;
    saved = false;
    try {
      const [
        authResponse,
        securityResponse,
        captchaResponse,
        authHookResponse,
        consistencyResponse,
        beforeUserCreatedHookStatus,
      ] = await Promise.all([
        getAuthConfig(),
        getSecurityConfig(),
        listTenantConfigs("captcha"),
        listTenantConfigs("auth_hook"),
        getAuthConfigRuntimeConsistency(),
        getBeforeUserCreatedHookStatus(),
      ]);
      authConfig = authResponse;
      runtimeConsistency = consistencyResponse;
      initializeForms(
        securityResponse,
        collectionItems(captchaResponse).find(
          (config) => config.key === "default",
        ),
        collectionItems(authHookResponse).find(
          (config) => config.key === "signup_policy",
        ),
        beforeUserCreatedHookStatus,
      );
    } catch (requestError) {
      error = requestError;
    }
    loading = false;
  }

  async function saveCommand(command) {
    saving = true;
    saved = false;
    error = null;
    try {
      await command();
      await loadSecurity();
      saved = true;
    } catch (requestError) {
      error = requestError;
    }
    saving = false;
  }

  function savePasswordPolicy() {
    return saveCommand(() =>
      updateAuthConfig({
        password_min_length: Number(passwordForm.password_min_length),
        password_required_characters: requiredCharacters(),
      }),
    );
  }

  function saveCaptcha() {
    const value = {
      provider: captchaForm.provider,
      secret_configured: captchaForm.secret_configured,
    };
    if (captchaForm.secret) value.secret = captchaForm.secret;
    return saveCommand(() =>
      upsertTenantConfig("captcha", "default", {
        enabled: captchaForm.enabled,
        value,
      }),
    );
  }

  function saveBlocklist() {
    return saveCommand(() =>
      upsertTenantConfig("auth_hook", "signup_policy", {
        enabled: true,
        value: {
          allowed_email_domains: blocklistForm.allowed_email_domains
            .split(",")
            .map((domain) => domain.trim())
            .filter(Boolean),
          blocked_email_domains: blocklistForm.blocked_email_domains
            .split(",")
            .map((domain) => domain.trim())
            .filter(Boolean),
          blocked_oauth_providers: blocklistForm.blocked_oauth_providers
            .split(",")
            .map((provider) => provider.trim())
            .filter(Boolean),
          allowed_oauth_providers: blocklistForm.allowed_oauth_providers
            .split(",")
            .map((provider) => provider.trim())
            .filter(Boolean),
          invite_only: blocklistForm.invite_only,
        },
      }),
    );
  }

  function saveGeneral() {
    return saveCommand(() =>
      Promise.all([
        updateAuthConfig({
          jwt_expiry: Number(generalForm.jwt_expiry),
          enable_confirmations: generalForm.enable_confirmations,
          external_anonymous_users_enabled:
            generalForm.external_anonymous_users_enabled,
        }),
        updateSecurityConfig({
          brute_force_protection: generalForm.brute_force_protection,
          max_login_attempts: Number(generalForm.max_login_attempts),
        }),
      ]),
    );
  }

  onMount(loadSecurity);
</script>

<div class="mb-6">
  <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
    {t("nav.section.authentication")}
  </p>
  <h2 class="mt-2 text-3xl font-bold text-surface-950">
    {t("Security Policy")}
  </h2>
  <p class="mt-2 text-sm text-surface-500">
    {t(
      "Only policies that map to the active GoTrue runtime are configurable here.",
    )}
  </p>
</div>
<DetailTabs {tabs} {activeTab} basePath="/security" />
{#if saved}<div
    class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-700"
  >
    {t("Saved")}
  </div>{/if}

<RequestState {loading} {error} onRetry={loadSecurity}>
  {#if activeTab === "password"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("Password Policy")}
      </h3>
      <p class="mt-1 text-sm text-surface-500">
        {t(
          "The saved character classes are read back from GoTrue password_required_characters.",
        )}
      </p>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="password-min-length"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Minimum Length")}</label
          ><input
            id="password-min-length"
            type="number"
            min="6"
            max="128"
            bind:value={passwordForm.password_min_length}
            class="w-full"
          />
        </div>
        <div>
          <label
            for="password-character-policy"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Required characters")}</label
          ><select
            id="password-character-policy"
            bind:value={passwordForm.character_policy}
            class="w-full"
            ><option value="none">{t("No character requirement")}</option
            ><option value="standard"
              >{t("Lowercase, uppercase, and number")}</option
            ><option value="strong"
              >{t("Lowercase, uppercase, number, and symbol")}</option
            ></select
          >
        </div>
      </div>
      <button
        disabled={saving}
        onclick={savePasswordPolicy}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else if activeTab === "captcha"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">CAPTCHA</h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="captcha-provider"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Provider")}</label
          ><select
            id="captcha-provider"
            bind:value={captchaForm.provider}
            class="w-full"
            ><option value="none">{t("Disabled")}</option><option
              value="hcaptcha">hCaptcha</option
            ><option value="turnstile">Cloudflare Turnstile</option></select
          >
        </div>
        <div>
          <label
            for="captcha-secret"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Secret")}</label
          ><input
            id="captcha-secret"
            type="password"
            bind:value={captchaForm.secret}
            placeholder={captchaForm.secret_configured ? "••••••••" : ""}
            class="w-full"
          />
          <p class="mt-1 text-xs text-surface-500">
            {captchaForm.secret_configured
              ? t("Secret configured")
              : t("Secret not configured")}
          </p>
        </div>
      </div>
      <label
        class="mt-4 flex items-center justify-between rounded-lg border border-surface-200 p-4"
        ><span class="font-medium text-surface-900">{t("Enabled")}</span><input
          type="checkbox"
          bind:checked={captchaForm.enabled}
        /></label
      ><button
        disabled={saving}
        onclick={saveCaptcha}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else if activeTab === "blocklist"}
    <section class="console-card p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-lg font-semibold text-surface-900">
            {t("detail.blocklist")}
          </h3>
          <p class="mt-1 text-sm text-surface-500">
            {t(
              "Enforcement uses the registered GoTrue before-user-created hook and authoritative server-side invitation checks.",
            )}
          </p>
        </div>
        <span
          class={blocklistForm.hook_registered && blocklistForm.hook_verified
            ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
            : "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"}
          >{blocklistForm.hook_registered && blocklistForm.hook_verified
            ? t("Active")
            : t("Not effective")}</span
        >
      </div>
      {#if blocklistForm.hook_reason_code}
        <p class="mt-3 text-xs text-amber-700">
          {t("Runtime verification reason")}: <code
            >{blocklistForm.hook_reason_code}</code
          >
        </p>
      {/if}
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="allowed-domains"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Allowed email domains")}</label
          ><input
            id="allowed-domains"
            bind:value={blocklistForm.allowed_email_domains}
            class="w-full"
            placeholder="company.example"
          />
        </div>
        <div>
          <label
            for="blocked-domains"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Blocked email domains")}</label
          ><input
            id="blocked-domains"
            bind:value={blocklistForm.blocked_email_domains}
            class="w-full"
            placeholder="example.test"
          />
        </div>
        <div>
          <label
            for="blocked-providers"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Blocked OAuth providers")}</label
          ><input
            id="blocked-providers"
            bind:value={blocklistForm.blocked_oauth_providers}
            class="w-full"
            placeholder="provider-id"
          />
        </div>
        <div>
          <label
            for="allowed-providers"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("Allowed OAuth providers")}</label
          ><input
            id="allowed-providers"
            bind:value={blocklistForm.allowed_oauth_providers}
            class="w-full"
            placeholder="google, github"
          />
        </div>
      </div>
      <label
        class="mt-4 flex items-center justify-between rounded-lg border border-surface-200 p-4"
        ><span class="font-medium text-surface-900"
          >{t("Invite-only sign-up")}</span
        ><input
          type="checkbox"
          bind:checked={blocklistForm.invite_only}
        /></label
      ><button
        disabled={saving}
        onclick={saveBlocklist}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
    </section>
  {:else}
    <div class="space-y-5">
      <section class="console-card p-6">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("Account Protection")}
        </h3>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <label
            class="flex items-center justify-between rounded-lg border border-surface-200 p-4"
            ><span class="font-medium text-surface-900"
              >{t("Email Confirmations")}</span
            ><input
              type="checkbox"
              bind:checked={generalForm.enable_confirmations}
            /></label
          ><label
            class="flex items-center justify-between rounded-lg border border-surface-200 p-4"
            ><span class="font-medium text-surface-900"
              >{t("Anonymous Users")}</span
            ><input
              type="checkbox"
              bind:checked={generalForm.external_anonymous_users_enabled}
            /></label
          ><label
            class="flex items-center justify-between rounded-lg border border-surface-200 p-4"
            ><span class="font-medium text-surface-900"
              >{t("Brute Force Protection")}</span
            ><input
              type="checkbox"
              bind:checked={generalForm.brute_force_protection}
            /></label
          >
          <div>
            <label
              for="max-attempts"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("Max Login Attempts")}</label
            ><input
              id="max-attempts"
              type="number"
              min="1"
              bind:value={generalForm.max_login_attempts}
            />
          </div>
          <div>
            <label
              for="jwt-expiry"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("JWT Expiry Seconds")}</label
            ><input
              id="jwt-expiry"
              type="number"
              min="60"
              bind:value={generalForm.jwt_expiry}
            />
          </div>
        </div>
        <button
          disabled={saving}
          onclick={saveGeneral}
          class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >{saving ? t("Saving...") : t("Save")}</button
        >
      </section>
      <section class="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h3 class="font-semibold text-blue-950">
          {t("tenant.runtimeConsistency")}
        </h3>
        <p class="mt-2 text-sm text-blue-800">
          {runtimeConsistency?.consistent
            ? t("tenant.consistent")
            : t("tenant.reviewRequired")}
        </p>
      </section>
    </div>
  {/if}
</RequestState>
