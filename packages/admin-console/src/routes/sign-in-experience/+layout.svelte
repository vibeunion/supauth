<script>
  import PageTabs from '$lib/components/PageTabs.svelte';

  let { children } = $props();

  const signInExperienceTabs = [
    { path: '/sign-in-experience/branding', labelKey: 'signIn.tab.branding' },
    { path: '/sign-in-experience/sign-up-and-sign-in', labelKey: 'signIn.tab.methods' },
    { path: '/sign-in-experience/collect-user-profile', labelKey: 'signIn.tab.profile' },
    { path: '/sign-in-experience/account-center', labelKey: 'signIn.tab.accountCenter' },
    { path: '/sign-in-experience/content', labelKey: 'signIn.tab.content' },
  ];
</script>

<PageTabs tabs={signInExperienceTabs} />
{@render children()}
