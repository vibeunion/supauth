<script>
  import { onMount } from 'svelte';
  import {
    setDataProvider,
    setAuthProvider,
    setResources,
  } from '@svadmin/core';
  import { supaoauthDataProvider } from '$lib/providers/data.js';
  import { supaoauthAuthProvider } from '$lib/providers/auth.js';
  import { supaoauthResources } from '$lib/providers/resources.js';
  import AdminLayout from '../layouts/AdminLayout.svelte';
  import '../app.css';

  let { children } = $props();
  let initialized = $state(false);

  onMount(() => {
    setDataProvider(supaoauthDataProvider);
    setAuthProvider(supaoauthAuthProvider);
    setResources(supaoauthResources);
    initialized = true;
  });
</script>

{#if initialized}
  <AdminLayout>
    {@render children()}
  </AdminLayout>
{/if}
