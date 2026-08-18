// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const editor = readFileSync(
  new URL('./components/sign-in-experience/BrandingEditor.svelte', import.meta.url),
  'utf8',
);
const translations = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');

describe('branding asset previews', () => {
  test('keeps the selected file as a valid local preview after upload', () => {
    const uploadStart = editor.indexOf('async function uploadBrandingFile');
    const uploadEnd = editor.indexOf('onMount(loadBranding)');
    const uploadSource = editor.slice(uploadStart, uploadEnd);

    expect(uploadSource.indexOf('await uploadBranding('))
      .toBeLessThan(uploadSource.indexOf('setLocalPreview(assetType, selectedFile)'));
    expect(uploadSource.indexOf('setLocalPreview(assetType, selectedFile)'))
      .toBeLessThan(uploadSource.indexOf('syncBranding(await getSignInExperience())'));
    expect(editor).toContain('URL.createObjectURL(previewBlob)');
    expect(editor).toContain('onDestroy(disposeLocalPreviews)');
    expect(editor).toContain('URL.revokeObjectURL(previewUrl)');
    expect(editor).toContain('if (previewsDisposed) return;');
  });

  test('reloads persisted assets through the authenticated same-origin BFF', () => {
    expect(editor).toContain('setLocalPreview(assetType, await getBrandingAsset(assetType))');
    expect(editor).toContain('await Promise.all(BRANDING_ASSET_TYPES.map(loadStoredPreview))');
    expect(editor).toContain('let logoPreviewUrl = $derived(localPreviewUrls.logo)');
    expect(editor).toContain('let faviconPreviewUrl = $derived(localPreviewUrls.favicon)');
  });

  test('removes broken images and bounds both asset preview slots', () => {
    expect(editor).not.toContain('src={branding.logo_url}');
    expect(editor).not.toContain('src={branding.favicon_url}');
    expect(editor).toContain("onerror={() => markPreviewUnavailable('logo')}");
    expect(editor).toContain("onerror={() => markPreviewUnavailable('favicon')}");
    expect(editor).toContain('h-16 w-full max-w-xs items-center overflow-hidden');
    expect(editor).toContain('h-10 w-10 items-center justify-center overflow-hidden');
    expect(editor.match(/role="status">\{t\('signIn\.brandingPreviewUnavailable'\)\}<\/p>/g)).toHaveLength(3);
  });

  test('provides English and Chinese feedback for an unavailable saved image', () => {
    expect(translations).toContain(
      '"signIn.brandingPreviewUnavailable":\n    "The saved image could not be loaded. Upload it again to refresh the preview."',
    );
    expect(translations).toContain(
      '"signIn.brandingPreviewUnavailable": "已保存的图片无法加载，请重新上传以刷新预览。"',
    );
  });
});
