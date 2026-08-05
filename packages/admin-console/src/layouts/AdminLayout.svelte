<script>
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  import { base, resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { t } from '$lib/i18n.js';
  import { createAdminLogoutController } from '$lib/admin-logout.js';
  import { brand, loadBrand } from '$lib/brand.svelte.js';
  import { navigationSections, isNavigationEntryActive } from '$lib/navigation.js';
  import { initializeAdminAuthProvider, supaoauthAuthProvider } from '$lib/providers/auth.js';

  let { children } = $props();
  let loggingOut = $state(false);
  let logoutError = $state('');
  let mobileNavigationOpen = $state(false);
  let mobileNavigationTrigger = $state();
  let mobileNavigationCloseButton = $state();
  let restoreFocusAfterNavigation = false;

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

  async function openMobileNavigation() {
    mobileNavigationOpen = true;
    await tick();
    mobileNavigationCloseButton?.focus();
  }

  async function closeMobileNavigation() {
    if (!mobileNavigationOpen) return;
    mobileNavigationOpen = false;
    await tick();
    mobileNavigationTrigger?.focus();
  }

  function mobileNavigationFocusTargets() {
    const navigation = document.getElementById('mobile-admin-navigation');
    if (!navigation) return [];
    return Array.from(navigation.querySelectorAll('a[href], button:not([disabled])'))
      .filter((target) => target instanceof HTMLElement);
  }

  function handleMobileNavigationKeydown(event) {
    if (!mobileNavigationOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void closeMobileNavigation();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusTargets = mobileNavigationFocusTargets();
    const firstTarget = focusTargets[0];
    const lastTarget = focusTargets.at(-1);
    if (!firstTarget || !lastTarget) return;
    if (!focusTargets.includes(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? lastTarget : firstTarget).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === firstTarget) {
      event.preventDefault();
      lastTarget.focus();
    } else if (!event.shiftKey && document.activeElement === lastTarget) {
      event.preventDefault();
      firstTarget.focus();
    }
  }

  async function closeMobileNavigationForDesktop() {
    if (!mobileNavigationOpen) return;
    mobileNavigationOpen = false;
    restoreFocusAfterNavigation = false;
    await tick();
    document.getElementById('admin-main-content')?.focus();
  }

  beforeNavigate(() => {
    if (!mobileNavigationOpen) return;
    mobileNavigationOpen = false;
    restoreFocusAfterNavigation = true;
  });

  afterNavigate(async () => {
    if (!restoreFocusAfterNavigation) return;
    restoreFocusAfterNavigation = false;
    await tick();
    mobileNavigationTrigger?.focus();
  });

  onMount(() => {
    const desktopQuery = window.matchMedia('(min-width: 768px)');
    const handleBreakpointChange = (event) => {
      if (event.matches) void closeMobileNavigationForDesktop();
    };
    desktopQuery.addEventListener('change', handleBreakpointChange);
    return () => desktopQuery.removeEventListener('change', handleBreakpointChange);
  });
</script>

<svelte:window onkeydown={handleMobileNavigationKeydown} />

{#snippet navigationPanel(sectionIdPrefix)}
  <div class="flex h-[70px] shrink-0 flex-col justify-center border-b border-surface-100 px-6">
    <div class="flex items-center gap-2">
      <span aria-hidden="true" class="select-none text-xl font-bold leading-none text-brand-600">✦</span>
      <h1 class="text-lg font-bold leading-none tracking-tight text-surface-900">{brand.systemName}</h1>
    </div>
    <p class="mt-1.5 pl-4 text-[11px] font-semibold uppercase tracking-wider text-surface-400">
      {t('layout.subtitle')}
    </p>
  </div>

  <div class="flex-1 space-y-5 overflow-y-auto px-3 py-4">
    {#each navigationSections as navigationSection (navigationSection.labelKey)}
      {@const sectionLabelId = `${sectionIdPrefix}-${navigationSection.labelKey}`}
      <section aria-labelledby={sectionLabelId}>
        <p id={sectionLabelId} class="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-surface-400">
          {t(navigationSection.labelKey)}
        </p>
        <div class="space-y-1">
          {#each navigationSection.entries as navigationEntry (navigationEntry.path)}
            {@const isActive = isNavigationEntryActive(page.url.pathname, base, navigationEntry.path)}
            <a
              href={resolve(navigationEntry.path)}
              aria-current={isActive ? 'page' : undefined}
              class={[
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors duration-150',
                isActive
                  ? 'font-semibold text-brand-600'
                  : 'text-surface-600 hover:text-surface-900',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                class={[
                  'text-[16px] transition-colors duration-150',
                  isActive ? 'text-brand-600' : 'text-surface-400 group-hover:text-surface-600',
                ].join(' ')}
              >
                {navigationEntry.icon}
              </span>
              {t(navigationEntry.labelKey)}
            </a>
          {/each}
        </div>
      </section>
    {/each}
  </div>

  <div class="border-t border-surface-100 px-4 py-4">
    <p class="px-2 text-xs font-medium text-surface-400">{brand.systemName}</p>
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
{/snippet}

<div class="flex h-screen bg-surface-50 font-sans">
  <div
    class="flex min-w-0 flex-1"
    aria-hidden={mobileNavigationOpen ? 'true' : undefined}
    inert={mobileNavigationOpen}
  >
    <a
      href="#admin-main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-brand-700 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
    >
      {t('layout.skipToContent')}
    </a>

    <header class="fixed inset-x-0 top-0 z-30 flex h-[70px] items-center justify-between border-b border-surface-100 bg-white px-4 md:hidden">
      <div class="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" class="text-xl font-bold leading-none text-brand-600">✦</span>
        <span class="truncate text-base font-bold text-surface-900">{brand.systemName}</span>
      </div>
      <button
        bind:this={mobileNavigationTrigger}
        type="button"
        aria-label={t('layout.openNavigation')}
        aria-expanded={mobileNavigationOpen}
        aria-controls="mobile-admin-navigation"
        onclick={openMobileNavigation}
        class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-surface-700 transition-colors hover:bg-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-600"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-6 w-6">
          <path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    </header>

    <nav
      aria-label={t('common.sectionNavigation')}
      class="hidden w-[252px] shrink-0 flex-col border-r border-surface-100 bg-surface-50 md:flex"
    >
      {@render navigationPanel('desktop-navigation')}
    </nav>

    <main id="admin-main-content" tabindex="-1" class="flex-1 overflow-auto bg-surface-50 pt-[70px] md:pt-0">
      <div class="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {@render children()}
      </div>
    </main>
  </div>

  {#if mobileNavigationOpen}
    <button
      type="button"
      tabindex="-1"
      aria-hidden="true"
      onclick={closeMobileNavigation}
      class="fixed inset-0 z-40 bg-surface-900/45 md:hidden"
    ></button>
    <div
      id="mobile-admin-navigation"
      role="dialog"
      aria-modal="true"
      aria-label={t('layout.mobileNavigation')}
      class="fixed inset-y-0 left-0 z-50 flex w-[252px] max-w-[calc(100vw-3rem)] flex-col bg-surface-50 shadow-xl md:hidden"
    >
      <button
        bind:this={mobileNavigationCloseButton}
        type="button"
        aria-label={t('layout.closeNavigation')}
        onclick={closeMobileNavigation}
        class="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-600"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-6 w-6">
          <path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <nav aria-label={t('common.sectionNavigation')} class="flex min-h-0 flex-1 flex-col">
        {@render navigationPanel('mobile-navigation')}
      </nav>
    </div>
  {/if}
</div>
