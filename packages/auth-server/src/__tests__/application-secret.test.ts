import { describe, it, expect } from 'bun:test';
import { createHash } from 'node:crypto';

describe('Application secret — hash computation', () => {
  it('SHA-256 produces 64-char hex string', () => {
    const hash = createHash('sha256').update('so_test_secret_value').digest('hex');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash is deterministic for same input', () => {
    const h1 = createHash('sha256').update('so_secret').digest('hex');
    const h2 = createHash('sha256').update('so_secret').digest('hex');
    expect(h1).toBe(h2);
  });

  it('different inputs produce different hashes', () => {
    const h1 = createHash('sha256').update('secret_a').digest('hex');
    const h2 = createHash('sha256').update('secret_b').digest('hex');
    expect(h1).not.toBe(h2);
  });
});

describe('Application secret — module structure', () => {
  it('exports all expected functions including verifyApplicationSecret', async () => {
    const appControl = await import('../repositories/application-control.js');
    const expectedFns = [
      'listApplicationSecrets',
      'createApplicationSecret',
      'disableApplicationSecret',
      'deleteApplicationSecret',
      'getApplicationConsentSettings',
      'upsertApplicationConsentSettings',
      'verifyApplicationSecret',
    ];
    for (const fn of expectedFns) {
      expect(typeof (appControl as any)[fn]).toBe('function');
    }
  });
});

// Verify the secret-hash leak fix: disable/delete must not return secretHash.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __appSecretDir = dirname(fileURLToPath(import.meta.url));
const appControlSrc = readFileSync(join(__appSecretDir, '../repositories/application-control.ts'), 'utf-8');

describe('Application secret — no secretHash leakage', () => {
  it('has a shared sanitizeSecret helper', () => {
    expect(appControlSrc).toContain('function sanitizeSecret');
  });

  it('disableApplicationSecret returns a sanitized row', () => {
    // The disable path must route through sanitizeSecret before returning.
    const disableBlock = appControlSrc.slice(
      appControlSrc.indexOf('export async function disableApplicationSecret'),
      appControlSrc.indexOf('export async function deleteApplicationSecret'),
    );
    expect(disableBlock).toContain('sanitizeSecret(entry)');
    // And must NOT return the raw entry.
    expect(disableBlock).not.toContain('return entry || null');
  });

  it('deleteApplicationSecret returns a sanitized row', () => {
    const deleteBlock = appControlSrc.slice(
      appControlSrc.indexOf('export async function deleteApplicationSecret'),
      appControlSrc.indexOf('export async function getApplicationConsentSettings'),
    );
    expect(deleteBlock).toContain('sanitizeSecret(entry)');
    expect(deleteBlock).not.toContain('return entry || null');
  });

  it('createApplicationSecret also sanitizes', () => {
    const createBlock = appControlSrc.slice(
      appControlSrc.indexOf('export async function createApplicationSecret'),
      appControlSrc.indexOf('export async function disableApplicationSecret'),
    );
    expect(createBlock).toContain('sanitizeSecret(entry)');
  });
});
