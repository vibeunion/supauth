<script>
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => goto(resolve('/dashboard')));
</script>

<p class="text-surface-400">Redirecting...</p>
