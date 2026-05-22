<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => goto('/dashboard'));
</script>

<p class="text-surface-400">Redirecting...</p>
