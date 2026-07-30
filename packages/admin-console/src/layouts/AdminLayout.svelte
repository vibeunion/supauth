<script>
  import { base, resolve } from '$app/paths';
  import { page } from '$app/state';
  import { t } from '$lib/i18n.js';
  import { createAdminLogoutController } from '$lib/admin-logout.js';
  import { brand, loadBrand } from '$lib/brand.svelte.js';
  import { navigationSections, isNavigationEntryActive } from '$lib/navigation.js';
  import { initializeAdminAuthProvider, supaoauthAuthProvider } from '$lib/providers/auth.js';
  let { children } = $props();
  let loggingOut = $state(false);
  let logoutError = $state('');

  // 启动时拉取系统品牌名（sign-in-experience.page_title）
  loadBrand();

  const logoutController = createAdminLogoutController({
    initializeProvider: initializeAdminAuthProvider,
    logout: () => supaoauthAuthProvider.logout({}),
    browserOrigin: () => window.location.origin,
    navigate: (url) => window.location.assign(url),
    failureMessage: () => t('auth.logoutFailed'),
    unsafeRedirectMessage: () => t('auth.logoutUnsafeRedirect'),
    onStateChange: (state) => {
      loggingOut = state.pending;
      logoutError = state.error;
    },
  });

  function handleLogout() {
    return logoutController.run();
  }
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

    <div class="px-4 py-4 border-t border-surface-100 bg-surface-50/50">
      <p class="px-2 text-xs text-surface-400 font-medium">{brand.systemName}</p>
      <button
        type="button"
        onclick={handleLogout}
        disabled={loggingOut}
        aria-busy={loggingOut}
        class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm font-semibold text-surface-600 shadow-xs transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-surface-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 7V5.75A1.75 1.75 0 0 1 11.75 4h6.5A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20h-6.5A1.75 1.75 0 0 1 10 18.25V17M14 12H3m0 0 3.5-3.5M3 12l3.5 3.5" />
        </svg>
        {loggingOut ? t('auth.loggingOut') : t('auth.logout')}
      </button>
      {#if logoutError}
        <p class="mt-2 px-2 text-xs leading-5 text-red-600" role="alert">{logoutError}</p>
      {/if}
    </div>
  </nav>

  <main class="flex-1 overflow-auto bg-surface-50">
    <div class="max-w-5xl mx-auto px-8 py-8 md:py-10">
      {@render children()}
    </div>
  </main>
</div>
