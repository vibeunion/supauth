<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { t } from '$lib/i18n.js';
  import { resolveConsolePath } from '$lib/navigation.js';

  let { tabs = [] }: { tabs?: ReadonlyArray<{ path: string; labelKey: string }> } = $props();

  function tabIsActive(tabPath: string) {
    const targetPath = `${base}${tabPath}`.replace(/\/$/, '') || '/';
    const currentPath = page.url.pathname.replace(/\/$/, '') || '/';
    return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
  }
</script>

<nav class="mb-6 flex flex-wrap gap-1 border-b border-surface-200" aria-label={t('common.sectionNavigation')}>
  {#each tabs as tab (tab.path)}
    <a
      href={resolveConsolePath(tab.path, base)}
      aria-current={tabIsActive(tab.path) ? 'page' : undefined}
      class={[
        'border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
        tabIsActive(tab.path)
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-surface-500 hover:border-surface-300 hover:text-surface-800',
      ].join(' ')}
    >
      {t(tab.labelKey)}
    </a>
  {/each}
</nav>
