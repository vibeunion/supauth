<script lang="ts">
  import { page } from "$app/state";
  import SystemErrorState from "@svadmin/ui/components/content/SystemErrorState.svelte";

  const status = $derived(page.status === 404 ? "404" : "500");
  const title = $derived(page.status === 404 ? "Page not found" : "Something went wrong");
  const description = $derived(
    page.status === 404
      ? "The page you requested does not exist or is no longer available."
      : "The console could not complete this request. Refresh the page or return to the dashboard.",
  );
</script>

<SystemErrorState {status} {title} {description}>
  {#snippet action()}
    <a
      href="/"
      class="inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
    >Return to dashboard</a>
  {/snippet}
</SystemErrorState>
