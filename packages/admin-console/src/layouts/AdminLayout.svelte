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

<div class="flex h-screen bg-surface-50">
  <!-- Sidebar -->
  <nav class="w-64 shrink-0 bg-surface-900 text-white flex flex-col">
    <div class="px-6 py-5 border-b border-surface-700">
      <h1 class="text-lg font-bold tracking-tight">SupaOAuth</h1>
      <p class="text-xs text-surface-400 mt-1">Identity Provider</p>
    </div>

    <div class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {#each navItems as item (item.path)}
        <a
          href={resolve(item.path)}
          class={[
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[15px] transition-colors',
            page.url.pathname === `${resolve('')}${item.path}` || page.url.pathname === `${resolve('')}${item.path}/`
              ? 'bg-brand-600 text-white'
              : 'text-surface-300 hover:bg-surface-800 hover:text-white',
          ].join(' ')}
        >
          <span class="text-lg">{item.icon}</span>
          {item.label}
        </a>
      {/each}
    </div>

    <div class="px-6 py-4 border-t border-surface-700 text-xs text-surface-500">
      SupaOAuth
    </div>
  </nav>

  <!-- Main content -->
  <main class="flex-1 overflow-auto">
    <div class="max-w-5xl mx-auto px-8 py-8">
      {@render children()}
    </div>
  </main>
</div>
