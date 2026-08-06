<script>
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import {
    listApplications,
    listConnectors,
    listOrganizations,
    listResources,
    resolvePublicSignInExperience,
  } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';

  const quickstarts = [
    {
      id: 'supabase-js',
      titleKey: 'getStarted.quickstart.supabaseJs',
      code: [
        "import { createClient } from '@supabase/supabase-js';",
        '',
        'const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);',
        "await supabase.auth.signInWithOAuth({ provider: 'github' });",
      ].join('\n'),
    },
    {
      id: 'sveltekit',
      titleKey: 'getStarted.quickstart.svelteKit',
      code: [
        '<script>',
        "  import { onMount } from 'svelte';",
        "  import { createClient } from '@supabase/supabase-js';",
        "  import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';",
        '',
        '  let session = null;',
        '  onMount(async () => {',
        '    const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY);',
        '    const { data } = await supabase.auth.getSession();',
        '    session = data.session;',
        '  });',
        '<\/script>',
        '',
        '<p>{session ? "Signed in" : "Signed out"}</p>',
      ].join('\n'),
    },
    {
      id: 'react',
      titleKey: 'getStarted.quickstart.react',
      code: [
        "import { useEffect, useState } from 'react';",
        "import { createClient } from '@supabase/supabase-js';",
        '',
        'const supabase = createClient(',
        '  import.meta.env.VITE_SUPABASE_URL,',
        '  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,',
        ');',
        '',
        'export function AuthState() {',
        '  const [session, setSession] = useState(null);',
        '  useEffect(() => {',
        '    const { data: { subscription } } = supabase.auth.onAuthStateChange(',
        '      (_event, nextSession) => setSession(nextSession),',
        '    );',
        '    return () => subscription.unsubscribe();',
        '  }, []);',
        '  return <p>{session ? "Signed in" : "Signed out"}</p>;',
        '}',
      ].join('\n'),
    },
    {
      id: 'nextjs',
      titleKey: 'getStarted.quickstart.nextJs',
      code: [
        "'use client';",
        "import { createClient } from '@supabase/supabase-js';",
        '',
        'const supabase = createClient(',
        '  process.env.NEXT_PUBLIC_SUPABASE_URL!,',
        '  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,',
        ');',
      ].join('\n'),
    },
    {
      id: 'server-api',
      titleKey: 'getStarted.quickstart.serverApi',
      code: [
        "import { createClient } from '@supabase/supabase-js';",
        '',
        'const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });',
        'const { data, error } = await supabase.auth.getUser(accessToken);',
        'if (error) throw error;',
        'const authenticatedUser = data.user;',
      ].join('\n'),
    },
  ];

  let loading = $state(true);
  let error = $state(null);
  let onboardingSteps = $state([]);

  function listEntries(response) {
    return response?.items || response?.data || (Array.isArray(response) ? response : []);
  }

  onMount(async () => {
    try {
      const [applications, resources, organizations, connectors, signInExperience] = await Promise.all([
        listApplications(),
        listResources(),
        listOrganizations(),
        listConnectors(),
        resolvePublicSignInExperience(),
      ]);
      onboardingSteps = [
        { labelKey: 'dashboard.createApplication', complete: listEntries(applications).length > 0, path: '/applications' },
        { labelKey: 'dashboard.defineResources', complete: listEntries(resources).length > 0, path: '/api-resources' },
        { labelKey: 'dashboard.createOrganization', complete: listEntries(organizations).length > 0, path: '/organizations' },
        { labelKey: 'dashboard.configureConnector', complete: listEntries(connectors).some((connector) => connector.enabled), path: '/connectors' },
        { labelKey: 'dashboard.setSecurityPolicy', complete: Boolean(signInExperience?.password_policy), path: '/security' },
      ];
    } catch (requestError) {
      error = requestError.message;
    }
    loading = false;
  });
</script>

<div class="mb-8">
  <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{t('getStarted.eyebrow')}</p>
  <h2 class="mt-2 text-3xl font-bold text-surface-950">{t('getStarted.title')}</h2>
  <p class="mt-2 max-w-2xl text-sm leading-6 text-surface-500">{t('getStarted.description')}</p>
</div>

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else if error}
  <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    {#each onboardingSteps as onboardingStep, stepIndex (onboardingStep.path)}
      <a href={resolve(onboardingStep.path)} class="console-card console-card-hover flex items-start gap-4 p-5">
        <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold {onboardingStep.complete ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-500'}">
          {stepIndex + 1}
          {#if onboardingStep.complete}
            <span class="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white" aria-label={t('getStarted.complete')}>✓</span>
          {/if}
        </span>
        <span>
          <span class="block font-semibold text-surface-900">{t(onboardingStep.labelKey)}</span>
          <span class="mt-1 block text-sm text-surface-500">{onboardingStep.complete ? t('getStarted.complete') : t('getStarted.open')}</span>
        </span>
      </a>
    {/each}
  </div>
{/if}

<div class="mt-6 rounded-xl border border-brand-200 bg-brand-50/60 p-5">
    <h3 class="font-semibold text-brand-900">{t('getStarted.supabaseTitle')}</h3>
    <p class="mt-2 text-sm leading-6 text-brand-800">{t('getStarted.supabaseDescription')}</p>
</div>

<section class="mt-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h3 class="text-xl font-semibold text-surface-900">{t('getStarted.quickstartTitle')}</h3>
        <p class="mt-1 text-sm leading-6 text-surface-500">{t('getStarted.quickstartDescription')}</p>
      </div>
      <a href="/api/swagger" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 hover:text-brand-900">
        {t('getStarted.openApi')}
        <span aria-hidden="true">↗</span>
      </a>
    </div>
    <div class="mt-5 grid gap-4 xl:grid-cols-2">
      {#each quickstarts as quickstart (quickstart.id)}
        <article class="console-card overflow-hidden">
          <h4 class="border-b border-surface-100 px-5 py-3 font-semibold text-surface-900">{t(quickstart.titleKey)}</h4>
          <pre class="overflow-x-auto bg-surface-950 p-5 text-xs leading-6 text-surface-100"><code>{quickstart.code}</code></pre>
        </article>
      {/each}
    </div>
    <p class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
      {t('getStarted.quickstartBoundary')}
    </p>
</section>
