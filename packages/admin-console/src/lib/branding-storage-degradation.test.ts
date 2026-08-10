import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const editor = readFileSync(
  new URL('./components/sign-in-experience/BrandingEditor.svelte', import.meta.url),
  'utf8',
);

describe('branding storage degradation', () => {
  test('shows an in-card warning and disables both upload inputs after a structured storage failure', () => {
    expect(editor).toContain("requestError?.code === 'branding_storage_unavailable'");
    expect(editor).toContain("t('signIn.brandingStorageDegradedTitle')");
    expect(editor.match(/disabled=\{uploading !== null \|\| storageUnavailable\}/g)).toHaveLength(2);
  });
});
