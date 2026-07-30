<script>
  import { onMount } from "svelte";
  import { t } from "$lib/i18n.js";
  import {
    createConnectorFromFactory,
    listConnectors,
    updateConnector,
    testConnector,
    listConnectorFactories,
  } from "$lib/api/client.js";

  let connectors = $state([]);
  let factories = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let testing = $state(null);
  let selectedFactory = $state(null);
  let factoryForm = $state({});

  const chinaConnectors = [
    "wechat",
    "wechat_miniprogram",
    "wechat_mp",
    "qq",
    "weibo",
    "alipay",
    "dingtalk",
    "douyin",
    "baidu",
    "huawei",
    "xiaomi",
    "kuaishou",
    "bilibili",
  ];

  async function load() {
    loading = true;
    try {
      const [res, factoryRes] = await Promise.all([
        listConnectors(),
        listConnectorFactories(),
      ]);
      connectors = Array.isArray(res) ? res : res.items || res.data || [];
      factories = factoryRes.items || [];
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function handleToggle(connector) {
    try {
      await updateConnector(connector.id, { enabled: !connector.enabled });
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  async function handleTest(connectorId) {
    testing = connectorId;
    try {
      const result = await testConnector(connectorId);
      alert(
        result.status === "reachable"
          ? t("Connection test passed")
          : t("Connection test failed"),
      );
    } catch (e) {
      alert(`${t("Test failed")}: ${e.message}`);
    }
    testing = null;
  }

  function factorySchema(factory) {
    return factory?.configSchema || factory?.config_schema || {};
  }

  function factoryFields(factory) {
    const schema = factorySchema(factory);
    return [
      ...new Set([
        ...(schema.required || []),
        ...(schema.secret_fields || []),
        ...(schema.optional || []),
      ]),
    ];
  }

  function configureFactory(factory) {
    selectedFactory = factory;
    factoryForm = Object.fromEntries(
      factoryFields(factory).map((fieldName) => [fieldName, ""]),
    );
  }

  async function saveFactoryConnector() {
    const schema = factorySchema(selectedFactory);
    const missingField = (schema.required || []).find(
      (fieldName) => !String(factoryForm[fieldName] || "").trim(),
    );
    if (missingField) {
      error = t("Required connector field is missing: {field}", {
        field: missingField,
      });
      return;
    }
    try {
      await createConnectorFromFactory(
        selectedFactory.factoryId || selectedFactory.factory_id,
        { ...factoryForm, enabled: true },
      );
      selectedFactory = null;
      factoryForm = {};
      await load();
    } catch (requestError) {
      error = requestError.message;
    }
  }

  onMount(load);
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-2xl font-bold text-surface-900">{t("Connectors")}</h2>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-4">
    {error}
  </div>
{/if}

{#if loading}
  <p class="text-surface-400">{t("Loading...")}</p>
{:else if connectors.length === 0}
  <div
    class="bg-surface-50 rounded-xl border border-surface-200 p-8 text-center"
  >
    <p class="text-surface-500">{t("No connectors available")}</p>
    <p class="text-sm text-surface-400 mt-2">
      {t(
        "Connectors are configured through SupaCloud. Check your project settings.",
      )}
    </p>
  </div>
{:else}
  <h3 class="text-lg font-semibold text-surface-800 mb-3">
    {t("Factory Catalog")}
  </h3>
  <div class="grid grid-cols-3 gap-3 mb-8">
    {#each factories as factory (factory.id)}
      <div class="bg-white rounded-lg border border-surface-200 p-4">
        <p class="font-medium text-surface-900">{factory.name}</p>
        <p class="text-xs text-surface-500 mt-1">
          {factory.factoryId || factory.factory_id} · {factory.protocol} · {factory.category}
        </p>
        <button
          disabled={!factory.enabled}
          onclick={() => configureFactory(factory)}
          class="mt-3 text-xs font-semibold text-brand-700 disabled:text-surface-400"
          >{factory.enabled ? t("Configure") : t("Unavailable")}</button
        >
      </div>
    {/each}
    {#if factories.length === 0}
      <div
        class="bg-surface-50 rounded-lg border border-surface-200 p-4 text-sm text-surface-500"
      >
        {t("No factory definitions yet.")}
      </div>
    {/if}
  </div>

  {#if selectedFactory}
    <section class="console-card mb-8 p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="font-semibold text-surface-900">{selectedFactory.name}</h3>
          <p class="mt-1 text-sm text-surface-500">
            {factorySchema(selectedFactory).notes ||
              t(
                "Configure the inbound identity provider with the typed factory schema.",
              )}
          </p>
        </div>
        <button
          onclick={() => (selectedFactory = null)}
          class="text-sm text-surface-500">{t("Cancel")}</button
        >
      </div>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        {#each factoryFields(selectedFactory) as fieldName (fieldName)}
          {@const secretField = (
            factorySchema(selectedFactory).secret_fields || []
          ).includes(fieldName)}
          <div>
            <label
              for={`connector-${fieldName}`}
              class="mb-1 block text-sm font-medium text-surface-700"
              >{fieldName}</label
            ><input
              id={`connector-${fieldName}`}
              type={secretField ? "password" : "text"}
              bind:value={factoryForm[fieldName]}
              autocomplete={secretField ? "new-password" : "off"}
              class="w-full"
            />
            <p class="mt-1 text-xs text-surface-400">
              {secretField
                ? t("Secret is sent once and is never returned by the API.")
                : (factorySchema(selectedFactory).required || []).includes(
                      fieldName,
                    )
                  ? t("Required")
                  : t("Optional")}
            </p>
          </div>
        {/each}
      </div>
      <button
        onclick={saveFactoryConnector}
        class="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >{t("Save")}</button
      >
    </section>
  {/if}

  <!-- International -->
  <h3 class="text-lg font-semibold text-surface-800 mb-3">
    {t("Social Connectors")}
  </h3>
  <div class="grid grid-cols-4 gap-3 mb-8">
    {#each connectors.filter((c) => !chinaConnectors.includes(c.id)) as connector (connector.id)}
      <div
        class="bg-white rounded-lg border {connector.enabled
          ? 'border-green-300 bg-green-50'
          : 'border-surface-200'} p-4"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-surface-900 capitalize"
            >{connector.id}</span
          >
          <span
            class="text-xs px-2 py-0.5 rounded-full {connector.enabled
              ? 'bg-green-100 text-green-700'
              : 'bg-surface-100 text-surface-500'}"
          >
            {connector.enabled ? t("Enabled") : t("Disabled")}
          </span>
        </div>
        <div class="flex gap-2">
          <button
            onclick={() => handleToggle(connector)}
            class="text-xs text-brand-600 hover:text-brand-800"
          >
            {connector.enabled ? t("Disable") : t("Enable")}
          </button>
          {#if connector.enabled}
            <button
              onclick={() => handleTest(connector.id)}
              class="text-xs text-surface-600 hover:text-surface-800"
              disabled={testing === connector.id}
            >
              {testing === connector.id ? t("Testing...") : t("Test")}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- China -->
  <h3 class="text-lg font-semibold text-surface-800 mb-3">
    {t("China Connectors")}
  </h3>
  <div class="grid grid-cols-4 gap-3">
    {#each connectors.filter( (c) => chinaConnectors.includes(c.id), ) as connector (connector.id)}
      <div
        class="bg-white rounded-lg border {connector.enabled
          ? 'border-green-300 bg-green-50'
          : 'border-surface-200'} p-4"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-surface-900">{connector.id}</span>
          <span
            class="text-xs px-2 py-0.5 rounded-full {connector.enabled
              ? 'bg-green-100 text-green-700'
              : 'bg-surface-100 text-surface-500'}"
          >
            {connector.enabled ? t("Enabled") : t("Disabled")}
          </span>
        </div>
        <div class="flex gap-2">
          <button
            onclick={() => handleToggle(connector)}
            class="text-xs text-brand-600 hover:text-brand-800"
          >
            {connector.enabled ? t("Disable") : t("Enable")}
          </button>
          {#if connector.enabled}
            <button
              onclick={() => handleTest(connector.id)}
              class="text-xs text-surface-600 hover:text-surface-800"
              disabled={testing === connector.id}
            >
              {testing === connector.id ? t("Testing...") : t("Test")}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
