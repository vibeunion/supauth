<script>
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  let { children } = $props();

  const navItems = [
    { path: '/dashboard', label: 'Overview', icon: '◉' },
    { path: '/applications', label: 'Applications', icon: '⬡' },
    { path: '/connectors', label: 'Connectors', icon: '⊕' },
    { path: '/resources', label: 'API Resources', icon: '◆' },
    { path: '/roles', label: 'Roles & Permissions', icon: '★' },
    { path: '/users', label: 'Users', icon: '⊙' },
    { path: '/organizations', label: 'Organizations', icon: '⬢' },
    { path: '/org-templates', label: 'Org Templates', icon: '▦' },
    { path: '/consents', label: 'Consents', icon: '✓' },
    { path: '/enterprise-sso', label: 'Enterprise SSO', icon: '⇄' },
    { path: '/tenant-config', label: 'Tenant Config', icon: '◧' },
    { path: '/security', label: 'Security Policy', icon: '◇' },
    { path: '/operations', label: 'Operations', icon: '⌁' },
    { path: '/settings', label: 'Settings', icon: '⚙' },
    { path: '/webhooks', label: 'Webhooks', icon: '↗' },
    { path: '/audit', label: 'Audit Logs', icon: '≡' },
  ];
</script>

<div class="flex h-screen bg-surface-50 font-sans">
  <nav class="w-64 shrink-0 bg-white border-r border-surface-200/80 flex flex-col shadow-xs">
    <div class="px-6 py-5 border-b border-surface-100 flex flex-col justify-center">
      <div class="flex items-center gap-2">
        <span class="text-xl text-brand-600 font-bold leading-none select-none">✦</span>
        <h1 class="text-lg font-bold tracking-tight text-surface-900 leading-none">SupaOAuth</h1>
      </div>
      <p class="text-[11px] font-semibold tracking-wider uppercase text-surface-400 mt-1.5 pl-4">
        Identity Provider
      </p>
    </div>

    <div class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {#each navItems as item (item.path)}
        {@const isActive = page.url.pathname === `${resolve('')}${item.path}` || page.url.pathname === `${resolve('')}${item.path}/`}
        <a
          href={resolve(item.path)}
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
            {item.icon}
          </span>
          {item.label}
        </a>
      {/each}
    </div>

    <div class="px-6 py-4 border-t border-surface-100 text-xs text-surface-400 font-medium bg-surface-50/50">
      SupaOAuth
    </div>
  </nav>

  <main class="flex-1 overflow-auto bg-surface-50">
    <div class="max-w-5xl mx-auto px-8 py-8 md:py-10">
      {@render children()}
    </div>
  </main>
</div>
