<script>
  import { resolve } from "$app/paths";
  import { t } from "$lib/i18n.js";

  let { tabs = [], activeTab = "", basePath = "" } = $props();

  function tabHref(tab) {
    return resolve(`${basePath}/${tab.value}`);
  }
</script>

<nav
  class="mb-6 flex flex-wrap gap-1 border-b border-surface-200"
  aria-label={t("common.sectionNavigation")}
>
  {#each tabs as tab (tab.value)}
    <a
      href={tabHref(tab)}
      aria-current={activeTab === tab.value ? "page" : undefined}
      class={activeTab === tab.value
        ? "border-b-2 border-brand-600 px-3 py-2.5 text-sm font-semibold text-brand-700"
        : "border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-surface-500 hover:border-surface-300 hover:text-surface-800"}
      >{t(tab.labelKey)}</a
    >
  {/each}
</nav>
