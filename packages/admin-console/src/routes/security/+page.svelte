<script lang="ts">
  import { decodeSchema, JsonObjectSchema, type AdminEndpointResult } from "@supauth/shared";
  import type { SettingsMutationOptions } from "$lib/authoritative-settings-readback.js";
  import type { MutationReconciliation } from "$lib/mutation-reconciliation.js";
  import { captchaValue, blocklistValue } from "$lib/components/settings-values.js";
  type SecuritySnapshot = Awaited<ReturnType<typeof fetchSecuritySnapshot>>;
  type TenantConfig = AdminEndpointResult<"listTenantConfigs">["items"][number];
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import DetailTabs from "$lib/components/DetailTabs.svelte";
  import RequestState from "$lib/components/RequestState.svelte";
  import { t } from "$lib/i18n.js";
  import { blocklistHookReasonKey } from "./blocklist-hook-reason.js";
  import {
    blocklistSettingsAuthority,
    canonicalTrimmedStringSet,
    captchaSettingsAuthority,
    generalSecuritySettingsAuthority,
    passwordPolicySettingsAuthority,
    settleAuthoritativeSettingsMutation,
  } from "$lib/authoritative-settings-readback.js";
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

  let authConfig = $state<AdminEndpointResult<"getAuthConfig"> | null>(null);
  let runtimeConsistency = $state<AdminEndpointResult<"getAuthConfigRuntimeConsistency"> | null>(null);
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
  let blocklistForm = $state<{
    allowed_email_domains: string; blocked_email_domains: string;
    blocked_oauth_providers: string; allowed_oauth_providers: string;
    invite_only: boolean; hook_registered: boolean; hook_verified: boolean;
    hook_reason_code: string | null;
  }>({
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
    lockout_duration_sec: 900,
  });
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  let reconciliationStatus = $state<MutationReconciliation<SecuritySnapshot>["status"] | null>(null);
  let error = $state<unknown>(null);
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
    if (!authConfig) throw new Error("Auth configuration has not been loaded");
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

  function initializeGeneralForm(securityConfig: AdminEndpointResult<"getSecurityConfig">) {
    if (!authConfig) throw new Error("Auth configuration has not been loaded");
    generalForm = {
      jwt_expiry: authConfig.jwt_expiry ?? 3600,
      enable_confirmations: authConfig.enable_confirmations ?? false,
      external_anonymous_users_enabled:
        authConfig.external_anonymous_users_enabled ?? false,
      brute_force_protection:
        securityConfig.bruteForceProtection ??
        ("brute_force_protection" in securityConfig && typeof securityConfig.brute_force_protection === "boolean" ? securityConfig.brute_force_protection : undefined) ??
        true,
      max_login_attempts:
        securityConfig.maxLoginAttempts ??
        ("max_login_attempts" in securityConfig && typeof securityConfig.max_login_attempts === "number" ? securityConfig.max_login_attempts : undefined) ??
        10,
      lockout_duration_sec:
        securityConfig.lockoutDurationSec ??
        ("lockout_duration_sec" in securityConfig && typeof securityConfig.lockout_duration_sec === "number" ? securityConfig.lockout_duration_sec : undefined) ??
        900,
    };
  }

  function initializeBlocklistForm(authHookConfig: TenantConfig | undefined, hookStatus: AdminEndpointResult<"getBeforeUserCreatedHookStatus">) {
    const value = blocklistValue(authHookConfig?.value);
    blocklistForm = {
      allowed_email_domains: (
        value.allowed_email_domains || []
      ).join(", "),
      blocked_email_domains: (
        value.blocked_email_domains || []
      ).join(", "),
      blocked_oauth_providers: (
        value.blocked_oauth_providers || []
      ).join(", "),
      allowed_oauth_providers: (
        value.allowed_oauth_providers || []
      ).join(", "),
      invite_only: value.invite_only === true,
      hook_registered: hookStatus?.registered === true,
      hook_verified: hookStatus?.verified === true,
      hook_reason_code: hookStatus?.reason_code || null,
    };
  }

  function initializeCaptchaForm(captchaConfig: TenantConfig | undefined) {
    captchaForm = {
      provider: "none",
      secret: "",
      secret_configured: false,
      ...captchaValue(captchaConfig?.value),
      enabled: captchaConfig?.enabled ?? false,
    };
    captchaForm.secret = "";
  }

  function initializeForms(
    securityConfig: AdminEndpointResult<"getSecurityConfig">,
    captchaConfig: TenantConfig | undefined,
    authHookConfig: TenantConfig | undefined,
    beforeUserCreatedHookStatus: AdminEndpointResult<"getBeforeUserCreatedHookStatus">,
  ) {
    initializePasswordForm();
    initializeGeneralForm(securityConfig);
    initializeBlocklistForm(authHookConfig, beforeUserCreatedHookStatus);
    initializeCaptchaForm(captchaConfig);
  }

  async function fetchSecuritySnapshot() {
    const responses = await Promise.all([
      getAuthConfig(),
      getSecurityConfig(),
      listTenantConfigs("captcha"),
      listTenantConfigs("auth_hook"),
      getAuthConfigRuntimeConsistency(),
      getBeforeUserCreatedHookStatus(),
    ]);
    const [
      authResponse,
      securityResponse,
      captchaResponse,
      authHookResponse,
      consistencyResponse,
      beforeUserCreatedHookStatus,
    ] = responses;
    return {
      authConfig: authResponse,
      securityConfig: securityResponse,
      captchaConfigs: captchaResponse,
      authHookConfigs: authHookResponse,
      runtimeConsistency: consistencyResponse,
      beforeUserCreatedHookStatus,
    };
  }

  function defaultCaptchaConfig(securitySnapshot: SecuritySnapshot) {
    return collectionItems<TenantConfig>(securitySnapshot.captchaConfigs).find(
      (config) => config.key === "default",
    );
  }

  function signupPolicyConfig(securitySnapshot: SecuritySnapshot) {
    return collectionItems<TenantConfig>(securitySnapshot.authHookConfigs).find(
      (config) => config.key === "signup_policy",
    );
  }

  function applySecuritySnapshot(securitySnapshot: SecuritySnapshot) {
    authConfig = securitySnapshot.authConfig;
    runtimeConsistency = securitySnapshot.runtimeConsistency;
    initializeForms(
      securitySnapshot.securityConfig,
      defaultCaptchaConfig(securitySnapshot),
      signupPolicyConfig(securitySnapshot),
      securitySnapshot.beforeUserCreatedHookStatus,
    );
  }

  async function readSecurityState() {
    applySecuritySnapshot(await fetchSecuritySnapshot());
  }

  async function loadSecurity() {
    loading = true;
    saved = false;
    reconciliationStatus = null;
    error = null;
    try {
      await readSecurityState();
    } catch (requestError) {
      error = requestError;
    } finally {
      loading = false;
    }
  }

  async function saveCommand<Command, Authority>(
    settingsMutation: Omit<SettingsMutationOptions<Command, Authority, SecuritySnapshot>, "readSnapshot">,
  ) {
    saving = true;
    saved = false;
    reconciliationStatus = null;
    error = null;
    try {
      const reconciliation = await settleAuthoritativeSettingsMutation({
        ...settingsMutation,
        readSnapshot: fetchSecuritySnapshot,
      });
      if (reconciliation.status === "success") {
        applySecuritySnapshot(reconciliation.readBackValue);
        saved = true;
      }
      else reconciliationStatus = reconciliation.status;
    } finally {
      saving = false;
    }
  }

  function commaSeparatedValues(fieldDraft: string) {
    return fieldDraft
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function savePasswordPolicy() {
    const command = {
      authConfig: {
        password_min_length: Number(passwordForm.password_min_length),
        password_required_characters: requiredCharacters(),
      },
    };
    return saveCommand({
      draft: {
        command,
        authority: passwordPolicySettingsAuthority(command),
      },
      writeCommands: (frozenCommand) => [
        () => updateAuthConfig(frozenCommand.authConfig),
      ],
      authorityFromSnapshot: passwordPolicySettingsAuthority,
    });
  }

  function saveCaptcha() {
    const provider = captchaForm.provider;
    const secret = captchaForm.secret.trim();
    const secretConfigured = secret
      ? true
      : captchaForm.secret_configured === true;
    const captchaConfig = {
      enabled: captchaForm.enabled === true && provider !== "none",
      value: { provider, secret_configured: secretConfigured, ...(secret ? { secret } : {}) },
    };
    const command = { captchaConfig };
    return saveCommand({
      draft: {
        command,
        authority: captchaSettingsAuthority(captchaConfig),
      },
      writeCommands: (frozenCommand) => [
        () =>
          upsertTenantConfig(
            "captcha",
            "default",
            {
              enabled: frozenCommand.captchaConfig.enabled,
              value: decodeSchema(JsonObjectSchema, frozenCommand.captchaConfig.value),
            },
          ),
      ],
      authorityFromSnapshot: (snapshot) =>
        captchaSettingsAuthority(defaultCaptchaConfig(snapshot)),
    });
  }

  function blocklistConfigDraft() {
    return {
      enabled: true,
      value: {
        allowed_email_domains: canonicalTrimmedStringSet(
          commaSeparatedValues(blocklistForm.allowed_email_domains),
          "blocklist.allowed_email_domains",
        ),
        blocked_email_domains: canonicalTrimmedStringSet(
          commaSeparatedValues(blocklistForm.blocked_email_domains),
          "blocklist.blocked_email_domains",
        ),
        blocked_oauth_providers: canonicalTrimmedStringSet(
          commaSeparatedValues(blocklistForm.blocked_oauth_providers),
          "blocklist.blocked_oauth_providers",
        ),
        allowed_oauth_providers: canonicalTrimmedStringSet(
          commaSeparatedValues(blocklistForm.allowed_oauth_providers),
          "blocklist.allowed_oauth_providers",
        ),
        invite_only: blocklistForm.invite_only,
      },
    };
  }

  function saveBlocklist() {
    const authHookConfig = blocklistConfigDraft();
    const command = { authHookConfig };
    return saveCommand({
      draft: {
        command,
        authority: blocklistSettingsAuthority(authHookConfig),
      },
      writeCommands: (frozenCommand) => [
        () =>
          upsertTenantConfig(
            "auth_hook",
            "signup_policy",
            {
              enabled: frozenCommand.authHookConfig.enabled,
              value: decodeSchema(JsonObjectSchema, frozenCommand.authHookConfig.value),
            },
          ),
      ],
      authorityFromSnapshot: (snapshot) =>
        blocklistSettingsAuthority(signupPolicyConfig(snapshot)),
    });
  }

  function saveGeneral() {
    const command = {
      authConfig: {
        jwt_expiry: Number(generalForm.jwt_expiry),
        enable_confirmations: generalForm.enable_confirmations,
        external_anonymous_users_enabled:
          generalForm.external_anonymous_users_enabled,
      },
      securityConfig: {
        bruteForceProtection: generalForm.brute_force_protection,
        maxLoginAttempts: Number(generalForm.max_login_attempts),
        lockoutDurationSec: Number(generalForm.lockout_duration_sec),
      },
    };
    return saveCommand({
      draft: {
        command,
        authority: generalSecuritySettingsAuthority(command),
      },
      writeCommands: (frozenCommand) => [
        () => updateAuthConfig(frozenCommand.authConfig),
        () => updateSecurityConfig(frozenCommand.securityConfig),
      ],
      authorityFromSnapshot: generalSecuritySettingsAuthority,
    });
  }

  onMount(loadSecurity);
</script>

<div class="mb-6">
  <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
    {t("nav.section.authentication")}
  </p>
  <h2 class="mt-2 text-3xl font-bold text-surface-950">
    {t("security.title")}
  </h2>
  <p class="mt-2 text-sm text-surface-500">
    {t("security.description")}
  </p>
</div>
<DetailTabs {tabs} {activeTab} basePath="/security" />
{#if saved}<div
    class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-700"
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

<RequestState {loading} {error} onRetry={loadSecurity}>
  {#if activeTab === "password"}
    <section class="console-card p-6">
      <h3 class="text-lg font-semibold text-surface-900">
        {t("security.passwordTitle")}
      </h3>
      <p class="mt-1 text-sm text-surface-500">
        {t("security.passwordDescription")}
      </p>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="password-min-length"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("security.passwordMinLength")}</label
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
            >{t("security.passwordRequiredCharacters")}</label
          ><select
            id="password-character-policy"
            bind:value={passwordForm.character_policy}
            class="w-full"
            ><option value="none">{t("security.passwordCharactersNone")}</option
            ><option value="standard"
              >{t("security.passwordCharactersStandard")}</option
            ><option value="strong"
              >{t("security.passwordCharactersStrong")}</option
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
      <h3 class="text-lg font-semibold text-surface-900">
        {t("security.captchaTitle")}
      </h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="captcha-provider"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("security.captchaProvider")}</label
          ><select
            id="captcha-provider"
            bind:value={captchaForm.provider}
            class="w-full"
            ><option value="none">{t("security.captchaDisabled")}</option><option
              value="hcaptcha">hCaptcha</option
            ><option value="turnstile">Cloudflare Turnstile</option></select
          >
        </div>
        <div>
          <label
            for="captcha-secret"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("security.captchaSecret")}</label
          ><input
            id="captcha-secret"
            type="password"
            bind:value={captchaForm.secret}
            placeholder={captchaForm.secret_configured ? "••••••••" : ""}
            class="w-full"
          />
          <p class="mt-1 text-xs text-surface-500">
            {captchaForm.secret_configured
              ? t("security.captchaSecretConfigured")
              : t("security.captchaSecretNotConfigured")}
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
            {t("security.blocklistTitle")}
          </h3>
          <p class="mt-1 text-sm text-surface-500">
            {t("security.blocklistDescription")}
          </p>
        </div>
        <span
          class={blocklistForm.hook_registered && blocklistForm.hook_verified
            ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
            : "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"}
          >{blocklistForm.hook_registered && blocklistForm.hook_verified
            ? t("security.blocklistActive")
            : t("security.blocklistNotEffective")}</span
        >
      </div>
      {#if blocklistForm.hook_reason_code}
        <p class="mt-3 text-xs text-amber-700">
          {t("security.blocklistRuntimeReason")}:
          {t(blocklistHookReasonKey(blocklistForm.hook_reason_code))}
        </p>
      {/if}
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            for="allowed-domains"
            class="mb-1 block text-sm font-medium text-surface-700"
            >{t("security.blocklistAllowedEmailDomains")}</label
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
            >{t("security.blocklistBlockedEmailDomains")}</label
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
            >{t("security.blocklistBlockedOauthProviders")}</label
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
            >{t("security.blocklistAllowedOauthProviders")}</label
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
          >{t("security.blocklistInviteOnly")}</span
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
          {t("security.gotrueRuntimeTitle")}
        </h3>
        <p class="mt-1 text-sm leading-6 text-surface-500">
          {t("security.gotrueRuntimeDescription")}
        </p>
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
          >
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
      </section>
      <section class="console-card p-6">
        <h3 class="text-lg font-semibold text-surface-900">
          {t("security.adminLoginTitle")}
        </h3>
        <p class="mt-1 text-sm leading-6 text-surface-500">
          {t("security.adminLoginDescription")}
        </p>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <label
            class="flex items-center justify-between rounded-lg border border-surface-200 p-4 md:col-span-2"
            ><span class="font-medium text-surface-900"
              >{t("security.adminBruteForceProtection")}</span
            ><input
              type="checkbox"
              bind:checked={generalForm.brute_force_protection}
            /></label
          >
          <div>
            <label
              for="max-attempts"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("security.adminMaxLoginAttempts")}</label
            ><input
              id="max-attempts"
              type="number"
              min="1"
              max="10000"
              bind:value={generalForm.max_login_attempts}
            />
          </div>
          <div>
            <label
              for="lockout-duration"
              class="mb-1 block text-sm font-medium text-surface-700"
              >{t("security.adminLockoutDuration")}</label
            ><input
              id="lockout-duration"
              type="number"
              min="1"
              max="2592000"
              bind:value={generalForm.lockout_duration_sec}
            />
          </div>
        </div>
        <p class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {t("security.endUserLockoutBoundary")}
        </p>
      </section>
      <button
        disabled={saving}
        onclick={saveGeneral}
        class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >{saving ? t("Saving...") : t("Save")}</button
      >
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
