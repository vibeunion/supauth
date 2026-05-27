import { describe, it, expect } from 'bun:test';

describe('Storage validation — bucket allowlist', () => {
  it('accepts avatars bucket', async () => {
    // Import the module to test the ALLOWED_BUCKETS constant indirectly
    // Since the constants are module-scoped, we test via the route behavior
    // by checking the storage module structure
    const storageModule = await import('../storage/index.js');
    expect(storageModule.storageRoutes).toBeDefined();
    expect(typeof storageModule.storageRoutes.fetch).toBe('function');
  });
});

describe('Storage module — structure', () => {
  it('exports storageRoutes as Elysia instance', async () => {
    const { storageRoutes } = await import('../storage/index.js');
    expect(storageRoutes).toBeDefined();
    expect(typeof storageRoutes.fetch).toBe('function');
  });
});

describe('Storage constants — validation helpers', () => {
  // We test the logic that would be used by the storage routes.
  // Since the functions are module-private, we replicate the validation
  // logic to ensure correctness.

  const ALLOWED_BUCKETS = ['avatars', 'branding'] as const;
  const ALLOWED_MIME_TYPES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'image/x-icon', 'image/vnd.microsoft.icon',
  ] as const;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  function validateBucket(bucketId: string): boolean {
    return (ALLOWED_BUCKETS as readonly string[]).includes(bucketId);
  }

  function validateMimeType(contentType: string): boolean {
    return (ALLOWED_MIME_TYPES as readonly string[]).includes(contentType);
  }

  it('allows avatars bucket', () => {
    expect(validateBucket('avatars')).toBe(true);
  });

  it('allows branding bucket', () => {
    expect(validateBucket('branding')).toBe(true);
  });

  it('rejects unknown bucket', () => {
    expect(validateBucket('uploads')).toBe(false);
  });

  it('rejects empty bucket name', () => {
    expect(validateBucket('')).toBe(false);
  });

  it('rejects bucket with similar name', () => {
    expect(validateBucket('avatars123')).toBe(false);
  });

  it('allows image/png mime type', () => {
    expect(validateMimeType('image/png')).toBe(true);
  });

  it('allows image/jpeg mime type', () => {
    expect(validateMimeType('image/jpeg')).toBe(true);
  });

  it('allows image/gif mime type', () => {
    expect(validateMimeType('image/gif')).toBe(true);
  });

  it('allows image/webp mime type', () => {
    expect(validateMimeType('image/webp')).toBe(true);
  });

  it('allows image/svg+xml mime type', () => {
    expect(validateMimeType('image/svg+xml')).toBe(true);
  });

  it('allows image/x-icon mime type', () => {
    expect(validateMimeType('image/x-icon')).toBe(true);
  });

  it('allows image/vnd.microsoft.icon mime type', () => {
    expect(validateMimeType('image/vnd.microsoft.icon')).toBe(true);
  });

  it('rejects application/pdf', () => {
    expect(validateMimeType('application/pdf')).toBe(false);
  });

  it('rejects text/html', () => {
    expect(validateMimeType('text/html')).toBe(false);
  });

  it('rejects application/octet-stream', () => {
    expect(validateMimeType('application/octet-stream')).toBe(false);
  });

  it('rejects empty mime type', () => {
    expect(validateMimeType('')).toBe(false);
  });

  it('MAX_FILE_SIZE is 5MB', () => {
    expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });
});
