<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "@svadmin/ui";
  import {
    LOGIN_EMAIL_DOMAIN_CONFIG,
    parseLoginEmailDomainInput,
    readLoginEmailDomain,
  } from "@supauth/shared";
  import { listTenantConfigs, upsertTenantConfig } from "#lib/api/client.js";
  import { settleAuthoritativeSettingsMutation } from "#lib/authoritative-settings-readback.js";
  import { t } from "#lib/i18n.js";
  import { errorMessage } from "#lib/resource-page.js";

  const { type, key } = LOGIN_EMAIL_DOMAIN_CONFIG;
  let input = $state("");
  let savedDomain = $state<string | null>(null);
  let loading = $state(true);
  let loaded = $state(false);
  let saving = $state(false);
  let invalid = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);

  async function readDomain() {
    const { items } = await listTenantConfigs(type);
    return readLoginEmailDomain(items.find((item) => item.key === key));
  }

  async function loadDomain() {
    loading = true;
    error = null;
    try {
      savedDomain = await readDomain();
      input = savedDomain ?? "";
      loaded = true;
    } catch (requestError) {
      error = errorMessage(requestError);
    } finally {
      loading = false;
    }
  }

  async function saveDomain(event: SubmitEvent) {
    event.preventDefault();
    if (loading || saving || !loaded) return;
    saved = false;
    error = null;
    const domain = parseLoginEmailDomainInput(input);
    invalid = domain === undefined;
    if (domain === undefined) return;

    saving = true;
    try {
      const result = await settleAuthoritativeSettingsMutation({
        draft: { command: { domain }, authority: { domain } },
        writeCommands: (command) => [
          () => upsertTenantConfig(type, key, {
            enabled: command.domain !== null,
            value: { domain: command.domain },
          }),
        ],
        readSnapshot: readDomain,
        authorityFromSnapshot: (value) => ({ domain: value }),
      });
      if (result.status === "success") {
        savedDomain = result.readBackValue;
        input = savedDomain ?? "";
        saved = true;
      } else {
        error = t(`save.${result.status}.title`);
      }
    } catch (requestError) {
      error = errorMessage(requestError);
    } finally {
      saving = false;
    }
  }

  onMount(loadDomain);
</script>

<section class="console-card p-6">
  <form onsubmit={saveDomain}>
    <label for="default-email-domain" class="block font-semibold text-surface-900">
      {t("signIn.defaultEmailDomain")}
    </label>
    <p id="default-email-domain-hint" class="mt-1 text-sm text-surface-500">
      {t("signIn.defaultEmailDomainHint")}
    </p>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <input
        id="default-email-domain"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="example.com"
        class="w-full max-w-xs"
        bind:value={input}
        aria-describedby={invalid ? "default-email-domain-hint default-email-domain-error" : "default-email-domain-hint"}
        aria-invalid={invalid}
        disabled={loading || saving || !loaded}
        oninput={() => { invalid = false; saved = false; error = null; }}
      />
      {#if !loading && !loaded}
        <Button type="button" onclick={loadDomain}>{t("signIn.defaultEmailDomainRetry")}</Button>
      {:else}
        <Button type="submit" disabled={loading || saving || input === (savedDomain ?? "")}>
          {saving ? t("Saving...") : t("Save")}
        </Button>
      {/if}
    </div>
    {#if loading}
      <p class="mt-2 text-sm text-surface-500" role="status">{t("common.loading")}</p>
    {:else if invalid}
      <p id="default-email-domain-error" class="mt-2 text-sm text-red-600" role="alert">
        {t("signIn.defaultEmailDomainInvalid")}
      </p>
    {:else if error}
      <p class="mt-2 text-sm text-red-600" role="alert">{error}</p>
    {:else if saved}
      <p class="mt-2 text-sm text-green-700" role="status">{t("Saved")}</p>
    {/if}
  </form>
</section>
