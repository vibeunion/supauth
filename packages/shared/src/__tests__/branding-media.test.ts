import { describe, expect, test } from 'bun:test';
import { adminEndpoints } from '../admin-endpoints.js';
import { BrandingImageContentTypeSchema, ImageContentTypeSchema } from '../admin-models.js';
import { hostedServerContracts } from '../server-hosted.js';
import { decodeSchema } from '../schema.js';

describe('shared branding media protocol', () => {
  test.each(ImageContentTypeSchema.anyOf.map((schema) => schema.const))(
    'shares the normalized %s allowlist across admin and hosted inputs',
    (canonical) => {
      for (const raw of [canonical, canonical.toUpperCase(), ` ${canonical.toUpperCase()} ; charset=utf-8 `]) {
        expect(decodeSchema(BrandingImageContentTypeSchema, raw)).toBe(raw);
        expect(decodeSchema(adminEndpoints.uploadBranding.input, {
          params: { assetType: 'logo' }, upload: { size: 4, type: raw }, headers: { 'Content-Type': raw },
        }).headers['Content-Type']).toBe(raw);
        expect(decodeSchema(hostedServerContracts.storageBrandingUpload.input, {
          params: { assetType: 'logo' }, headers: { 'content-type': raw },
        })).toEqual({ params: { assetType: 'logo' }, headers: { 'content-type': raw } });
        if (raw !== canonical) {
          expect(() => decodeSchema(ImageContentTypeSchema, raw)).toThrow();
          expect(() => decodeSchema(adminEndpoints.uploadAvatar.input, {
            params: { userId: 'user-1' }, upload: { size: 4, type: raw }, headers: { 'Content-Type': raw },
          })).toThrow();
          expect(() => decodeSchema(adminEndpoints.uploadFile.input, {
            params: { bucketId: 'branding', filePath: 'logo.png' },
            upload: { size: 4, type: raw }, headers: { 'Content-Type': raw },
          })).toThrow();
        }
      }
    },
  );

  test.each(['', 'application/octet-stream', 'image/png-invalid', 'image/svg+xml-invalid', 'image/png, image/jpeg'])(
    'rejects unlisted media type %s in both consumers',
    (raw) => {
      expect(() => decodeSchema(adminEndpoints.uploadBranding.input, {
        params: { assetType: 'logo' }, upload: { size: 4, type: raw }, headers: { 'Content-Type': raw },
      })).toThrow();
      expect(() => decodeSchema(hostedServerContracts.storageBrandingUpload.input, {
        params: { assetType: 'logo' }, headers: { 'content-type': raw },
      })).toThrow();
    },
  );

  test('retains the upload size limit for parameterized media', () => {
    expect(() => decodeSchema(adminEndpoints.uploadBranding.input, {
      params: { assetType: 'logo' },
      upload: { size: 5 * 1024 * 1024 + 1, type: 'IMAGE/PNG; charset=utf-8' },
      headers: { 'Content-Type': 'IMAGE/PNG; charset=utf-8' },
    })).toThrow();
  });
});
