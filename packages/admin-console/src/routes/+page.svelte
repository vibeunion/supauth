<script>
  import { resolve } from '$app/paths';
  import { t } from '$lib/i18n.js';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => goto(resolve('/dashboard')));
</script>

<p class="text-surface-400">{t('Redirecting...')}</p>
