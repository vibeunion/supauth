<script>
  import AdminLayout from '../layouts/AdminLayout.svelte';
  import '../app.css';
  let { children } = $props();
</script>

<AdminLayout>
  {@render children()}
</AdminLayout>
