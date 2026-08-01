<script>
  import { onMount } from "svelte";
  import { t } from "$lib/i18n.js";
  import { listTenantConfigs, upsertTenantConfig } from "$lib/api/client.js";
  import {
    readAccountCenterConfig,
    validateExternalDeleteAccountUrlDraft,
  } from "./account-center-settings.js";
  import {
    accountCenterSettingsAuthority,
    settleAuthoritativeSettingsMutation,
  } from "$lib/authoritative-settings-readback.js";

  let loading = $state(true);
  let saving = $state(false);
  let error = $state(null);
  let success = $state(null);
  let reconciliationStatus = $state(null);
  let deleteAccountUrlError = $state(null);

  let form = $state({
    enabled: true,
    profile_edit: "read_only",
    profile_fields_text: "name\nemail\nphone",
    password_change: true,
    mfa: false,
    email_change: false,
    phone_change: false,
    grants: false,
    identities: false,
    delete_account_enabled: false,
    delete_account_url: "",
  });

  function normalizeValue(config) {
    const value = config?.value || {};
    const profile = value.profile || {};
    const security = value.security || {};
    const fields = Array.isArray(profile.fields)
      ? profile.fields
      : ["name", "email", "phone"];

    return {
      enabled: config?.enabled ?? value.enabled ?? true,
      profile_edit: profile.edit_mode || "read_only",
      profile_fields_text: fields.join("\n"),
      password_change: security.password_change ?? true,
      mfa: security.mfa ?? false,
      email_change: security.email_change ?? false,
      phone_change: security.phone_change ?? false,
      grants: value.grants?.enabled ?? false,
      identities: value.identities?.enabled ?? false,
      delete_account_enabled:
        value.delete_account?.enabled ?? !!value.delete_account_url,
      delete_account_url:
        value.delete_account?.url || value.delete_account_url || "",
    };
  }

  function profileFields() {
    return form.profile_fields_text
      .split(/[\n,]/)
      .map((field) => field.trim())
      .filter(Boolean);
  }

  async function readAccountCenter() {
    const config = await readAccountCenterConfig(listTenantConfigs);
    form = normalizeValue(config);
  }

  async function load() {
    loading = true;
    error = null;
    success = null;
    reconciliationStatus = null;
    deleteAccountUrlError = null;

    try {
      await readAccountCenter();
    } catch {
      error = t("state.requestFailed");
    } finally {
      loading = false;
    }
  }

  function accountCenterSecurityDraft() {
    return {
      password_change: form.password_change,
      mfa: form.mfa,
      email_change: form.email_change,
      phone_change: form.phone_change,
    };
  }

  function accountCenterValueDraft(deleteAccountUrl) {
    return {
      enabled: form.enabled,
      profile: {
        edit_mode: form.profile_edit,
        fields: profileFields(),
      },
      security: accountCenterSecurityDraft(),
      grants: { enabled: form.grants },
      identities: { enabled: form.identities },
      delete_account: {
        enabled: form.delete_account_enabled,
        url: deleteAccountUrl,
      },
      delete_account_url: deleteAccountUrl,
    };
  }

  function accountCenterMutationDraft(deleteAccountUrl) {
    const command = {
      enabled: form.enabled,
      value: accountCenterValueDraft(deleteAccountUrl),
    };
    return { command, authority: accountCenterSettingsAuthority(command) };
  }

  async function saveAccountCenter() {
    error = null;
    success = null;
    reconciliationStatus = null;
    const deleteUrlValidation = validateExternalDeleteAccountUrlDraft(
      form.delete_account_url,
      import.meta.env.MODE,
    );
    if (!deleteUrlValidation.ok) {
      deleteAccountUrlError = t("accountCenter.invalidDeleteAccountUrl");
      return;
    }

    deleteAccountUrlError = null;
    saving = true;
    const mutationDraft = accountCenterMutationDraft(deleteUrlValidation.url);

    try {
      const reconciliation = await settleAuthoritativeSettingsMutation({
        draft: mutationDraft,
        writeCommands: (configDraft) => [
          () => upsertTenantConfig("account_center", "default", configDraft),
        ],
        readSnapshot: () => readAccountCenterConfig(listTenantConfigs),
        authorityFromSnapshot: accountCenterSettingsAuthority,
      });
      if (reconciliation.status === "success") {
        form = normalizeValue(reconciliation.readBackValue);
        success = t("Account Center settings saved");
      } else reconciliationStatus = reconciliation.status;
    } finally {
      saving = false;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">{t("Account Center")}</h2>
    <p class="text-sm text-surface-500 mt-1">
      {t(
        "Configure the hosted self-service account center exposed at /account.",
      )}
    </p>
  </div>
  <button
    onclick={saveAccountCenter}
    disabled={saving || loading}
    class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
  >
    {saving ? t("Saving...") : t("Save")}
  </button>
</div>

{#if error}
  <div
    class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4"
    role="alert"
  >
    {error}
  </div>
{/if}

{#if success}
  <div
    class="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 mb-4"
  >
    {success}
  </div>
{/if}

{#if reconciliationStatus}
  <div
    class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900"
    role="alert"
  >
    <p class="font-semibold">
      {t(`save.${reconciliationStatus}.title`)}
    </p>
    <p class="mt-1 text-sm text-amber-800">
      {t(`save.${reconciliationStatus}.description`)}
    </p>
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else}
  <div class="space-y-6">
    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">
        {t("Availability")}
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
        >
          <span>
            <span class="block text-sm font-medium text-surface-800"
              >{t("Hosted Account Center")}</span
            >
            <span class="block text-xs text-surface-500 mt-1"
              >{t("Controls the public /account entry.")}</span
            >
          </span>
          <input type="checkbox" bind:checked={form.enabled} class="h-4 w-4" />
        </label>

        <label
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
        >
          <span>
            <span class="block text-sm font-medium text-surface-800"
              >{t("Password Change")}</span
            >
            <span class="block text-xs text-surface-500 mt-1"
              >{t("Links to /account/password.")}</span
            >
          </span>
          <input
            type="checkbox"
            bind:checked={form.password_change}
            class="h-4 w-4"
          />
        </label>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">
        {t("Profile")}
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            for="profile-edit"
            class="block text-sm font-medium text-surface-700 mb-1"
            >{t("Edit Mode")}</label
          >
          <select
            id="profile-edit"
            bind:value={form.profile_edit}
            class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
          >
            <option value="disabled">{t("Disabled")}</option>
            <option value="read_only">{t("Read Only")}</option>
            <option value="editable">{t("Editable")}</option>
          </select>
        </div>

        <div>
          <label
            for="profile-fields"
            class="block text-sm font-medium text-surface-700 mb-1"
            >{t("Profile Fields")}</label
          >
          <textarea
            id="profile-fields"
            bind:value={form.profile_fields_text}
            class="w-full h-28 px-3 py-2 border border-surface-300 rounded-lg text-sm font-mono"
            placeholder="name&#10;email&#10;phone"
          ></textarea>
        </div>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">
        {t("Modules")}
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          data-capability-status="capability_unavailable"
        >
          <span class="block text-sm font-medium text-amber-900">
            {t("accountCenter.sessionsUnavailableTitle")}
          </span>
          <span class="mt-1 block text-xs text-amber-800">
            {t("accountCenter.sessionsUnavailableDescription")}
          </span>
        </div>
        <label
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
        >
          <span class="text-sm font-medium text-surface-800"
            >{t("Application Grants")}</span
          >
          <input type="checkbox" bind:checked={form.grants} class="h-4 w-4" />
        </label>
        <label
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
        >
          <span class="text-sm font-medium text-surface-800"
            >{t("Identities")}</span
          >
          <input
            type="checkbox"
            bind:checked={form.identities}
            class="h-4 w-4"
          />
        </label>
        <label
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
        >
          <span class="text-sm font-medium text-surface-800">{t("MFA")}</span>
          <input type="checkbox" bind:checked={form.mfa} class="h-4 w-4" />
        </label>
        <label
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
        >
          <span class="text-sm font-medium text-surface-800"
            >{t("Email Change")}</span
          >
          <input
            type="checkbox"
            bind:checked={form.email_change}
            class="h-4 w-4"
          />
        </label>
        <label
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3"
        >
          <span class="text-sm font-medium text-surface-800"
            >{t("Phone Change")}</span
          >
          <input
            type="checkbox"
            bind:checked={form.phone_change}
            class="h-4 w-4"
          />
        </label>
      </div>
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">
        {t("Delete Account")}
      </h3>
      <label
        class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3 mb-4"
      >
        <span>
          <span class="block text-sm font-medium text-surface-800"
            >{t("Enable Delete Account")}</span
          >
          <span class="block text-xs text-surface-500 mt-1"
            >{t(
              "If URL is empty, hosted /account uses the built-in DELETE confirmation flow.",
            )}</span
          >
        </span>
        <input
          type="checkbox"
          bind:checked={form.delete_account_enabled}
          class="h-4 w-4"
        />
      </label>
      <label
        for="delete-account-url"
        class="block text-sm font-medium text-surface-700 mb-1"
        >{t("External Delete Account URL")}</label
      >
      <input
        id="delete-account-url"
        type="url"
        bind:value={form.delete_account_url}
        oninput={() => {
          deleteAccountUrlError = null;
        }}
        aria-invalid={deleteAccountUrlError ? "true" : "false"}
        aria-describedby={deleteAccountUrlError
          ? "delete-account-url-error"
          : undefined}
        class="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm"
        placeholder="https://example.com/account/delete"
      />
      {#if deleteAccountUrlError}
        <p
          id="delete-account-url-error"
          class="mt-2 text-sm text-red-700"
          role="alert"
        >
          {deleteAccountUrlError}
        </p>
      {/if}
    </section>

    <section class="bg-white rounded-xl border border-surface-200 p-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-4">
        {t("Hosted URLs")}
      </h3>
      <div class="flex flex-wrap gap-3">
        <a
          class="text-sm text-brand-600 hover:text-brand-800"
          href="/account"
          target="_blank"
          rel="noreferrer">/account</a
        >
        <a
          class="text-sm text-brand-600 hover:text-brand-800"
          href="/account.html"
          target="_blank"
          rel="noreferrer">/account.html</a
        >
        <a
          class="text-sm text-brand-600 hover:text-brand-800"
          href="/account/password"
          target="_blank"
          rel="noreferrer">/account/password</a
        >
      </div>
    </section>
  </div>
{/if}
