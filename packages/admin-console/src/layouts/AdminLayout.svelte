<script>
  import { base, resolve } from '$app/paths';
  import { page } from '$app/state';
  import { t } from '$lib/i18n.js';
  import { brand, loadBrand } from '$lib/brand.svelte.js';
  import { navigationSections, isNavigationEntryActive } from '$lib/navigation.js';
  let { children } = $props();

  // 启动时拉取系统品牌名（sign-in-experience.page_title）
  loadBrand();

</script>

<div class="flex h-screen bg-surface-50 font-sans">
  <nav class="w-64 shrink-0 bg-white border-r border-surface-200/80 flex flex-col shadow-xs">
    <div class="px-6 py-5 border-b border-surface-100 flex flex-col justify-center">
      <div class="flex items-center gap-2">
        <span class="text-xl text-brand-600 font-bold leading-none select-none">✦</span>
        <h1 class="text-lg font-bold tracking-tight text-surface-900 leading-none">{brand.systemName}</h1>
      </div>
      <p class="text-[11px] font-semibold tracking-wider uppercase text-surface-400 mt-1.5 pl-4">
        {t('layout.subtitle')}
      </p>
    </div>

    <div class="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
      {#each navigationSections as navigationSection (navigationSection.labelKey)}
        <section aria-labelledby={navigationSection.labelKey}>
          <p id={navigationSection.labelKey} class="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-surface-400">
            {t(navigationSection.labelKey)}
          </p>
          <div class="space-y-1">
            {#each navigationSection.entries as navigationEntry (navigationEntry.path)}
              {@const isActive = isNavigationEntryActive(page.url.pathname, base, navigationEntry.path)}
              <a
                href={resolve(navigationEntry.path)}
                aria-current={isActive ? 'page' : undefined}
                class={[
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-150 relative group',
                  isActive
                    ? 'bg-brand-50/70 text-brand-600 font-semibold'
                    : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900',
                ].join(' ')}
              >
                {#if isActive}
                  <div class="absolute left-0 top-2 bottom-2 w-[3px] bg-brand-600 rounded-r-md"></div>
                {/if}

                <span class={[
                  'text-[16px] transition-colors duration-150',
                  isActive ? 'text-brand-600' : 'text-surface-400 group-hover:text-surface-600'
                ].join(' ')}>
                  {navigationEntry.icon}
                </span>
                {t(navigationEntry.labelKey)}
              </a>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <div class="px-6 py-4 border-t border-surface-100 text-xs text-surface-400 font-medium bg-surface-50/50">
      {brand.systemName}
    </div>
  </nav>

  <main class="flex-1 overflow-auto bg-surface-50">
    <div class="max-w-5xl mx-auto px-8 py-8 md:py-10">
      {@render children()}
    </div>
  </main>
</div>
