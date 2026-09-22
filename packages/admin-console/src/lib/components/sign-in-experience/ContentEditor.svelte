<script lang="ts">
  import { decodeSchema, JsonValueSchema, type AdminEndpointResult, type JsonValue } from '@supauth/shared';
  import { errorMessage } from '$lib/resource-page.js';
  import { onMount } from 'svelte';
  import { getSignInExperience, updateSignInExperience } from '$lib/api/client.js';
  import { t } from '$lib/i18n.js';
  import Button from '@svadmin/ui/components/ui/button/button.svelte';
  import Input from '@svadmin/ui/components/ui/input/input.svelte';
  import Select from '@svadmin/ui/components/ui/select/select.svelte';
  import Textarea from '@svadmin/ui/components/ui/textarea/textarea.svelte';

  const illustrationOptions = [
    { value: '', labelKey: 'No Illustration' },
    { value: 'security', labelKey: 'Security Illustration' },
    { value: 'identity', labelKey: 'Identity Illustration' },
    { value: 'cloud', labelKey: 'Cloud Illustration' },
  ];

  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state(false);
  let contentDraft = $state({ description: '', button_label: '', custom_css: '', illustration: '', content: '' });

  function structuredContent(signInExperience: AdminEndpointResult<'getSignInExperience'>) {
    const currentContent = signInExperience?.branding?.content;
    if (!currentContent) return '';
    return typeof currentContent === 'string' ? currentContent : JSON.stringify(currentContent, null, 2);
  }

  function syncContent(signInExperience: AdminEndpointResult<'getSignInExperience'>) {
    const currentBranding = signInExperience?.branding || {};
    const currentContent = currentBranding.content;
    contentDraft = {
      description: currentBranding.description || '',
      button_label: currentBranding.button_label || '',
      custom_css: currentBranding.custom_css || '',
      illustration: currentContent && typeof currentContent === 'object' && !Array.isArray(currentContent) && typeof currentContent["illustration"] === 'string' ? currentContent["illustration"] : '',
      content: structuredContent(signInExperience),
    };
  }

  function parseContent(): JsonValue {
    const rawContent = contentDraft.content.trim();
    if (!rawContent) return contentDraft.illustration ? { illustration: contentDraft.illustration } : null;
    const parsedContent = decodeSchema(JsonValueSchema, JSON.parse(rawContent));
    if (Array.isArray(parsedContent)) {
      return contentDraft.illustration ? { illustration: contentDraft.illustration, items: parsedContent } : parsedContent;
    }
    if (!parsedContent || typeof parsedContent !== 'object') {
      return contentDraft.illustration ? { illustration: contentDraft.illustration } : parsedContent;
    }
    const normalizedContent = { ...parsedContent };
    if (contentDraft.illustration) normalizedContent["illustration"] = contentDraft.illustration;
    else delete normalizedContent["illustration"];
    return normalizedContent;
  }

  async function loadContent() {
    loading = true;
    error = null;
    try {
      syncContent(await getSignInExperience());
    } catch (requestError) {
      error = errorMessage(requestError);
    }
    loading = false;
  }

  async function saveContent() {
    saving = true;
    saved = false;
    error = null;
    try {
      await updateSignInExperience({ branding: {
        description: contentDraft.description.trim() || null,
        button_label: contentDraft.button_label.trim() || null,
        custom_css: contentDraft.custom_css.trim() || null,
        content: parseContent(),
      } });
      await loadContent();
      saved = true;
    } catch (requestError) {
      error = requestError instanceof SyntaxError
        ? t('Structured login content must be valid JSON.')
        : errorMessage(requestError);
    }
    saving = false;
  }

  onMount(loadContent);
</script>

<div class="mb-6 flex items-start justify-between gap-4">
  <div>
    <h2 class="text-2xl font-bold text-surface-900">{t('signIn.contentTitle')}</h2>
    <p class="mt-1 text-sm text-surface-500">{t('signIn.contentDescription')}</p>
  </div>
  <Button onclick={saveContent} disabled={loading || saving}>
    {saving ? t('Saving...') : t('Save')}
  </Button>
</div>

{#if error}<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>{/if}
{#if saved}<div class="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">{t('Saved')}</div>{/if}

{#if loading}
  <p class="text-surface-400">{t('common.loading')}</p>
{:else}
  <section class="console-card space-y-5 p-6">
    <div>
      <label for="login-description" class="mb-1 block text-sm font-medium text-surface-700">{t('Login Page Intro')}</label>
      <Textarea id="login-description" bind:value={contentDraft.description} rows={3} class="w-full" />
    </div>
    <div>
      <label for="login-button-label" class="mb-1 block text-sm font-medium text-surface-700">{t('Button Label')}</label>
      <Input id="login-button-label" bind:value={contentDraft.button_label} class="w-full" placeholder={t('Sign In')} />
    </div>
    <div>
      <label for="login-illustration" class="mb-1 block text-sm font-medium text-surface-700">{t('Illustration Theme')}</label>
      <Select id="login-illustration" bind:value={contentDraft.illustration} class="w-full">
        {#each illustrationOptions as illustrationOption (illustrationOption.value)}
          <option value={illustrationOption.value}>{t(illustrationOption.labelKey)}</option>
        {/each}
      </Select>
    </div>
    <div>
      <label for="structured-content" class="mb-1 block text-sm font-medium text-surface-700">{t('Structured Login Content')}</label>
      <Textarea id="structured-content" bind:value={contentDraft.content} rows={10} class="w-full font-mono" />
    </div>
    <div>
      <label for="custom-css" class="mb-1 block text-sm font-medium text-surface-700">{t('Custom CSS')}</label>
      <Textarea id="custom-css" bind:value={contentDraft.custom_css} rows={7} class="w-full font-mono" />
    </div>
  </section>
{/if}
