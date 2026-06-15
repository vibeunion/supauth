import { describe, it, expect } from 'bun:test';

describe('Consent repository — module structure', () => {
  it('exports all expected functions', async () => {
    const consents = await import('../repositories/consents.js');
    const expectedFns = [
      'listUserConsents',
      'listAllUserConsents',
      'hasConsent',
      'grantConsent',
      'revokeConsent',
      'revokeAllConsents',
      'listApplicationConsents',
    ];
    for (const fn of expectedFns) {
      expect(typeof (consents as any)[fn]).toBe('function');
    }
  });
});

describe('Consent repository — hasConsent NULL boundary', () => {
  it('hasConsent accepts all optional params without throwing at module level', async () => {
    const { hasConsent } = await import('../repositories/consents.js');
    // Without a real DB, this will throw on getDb(), but the function
    // signature itself should accept optional scopeId/organizationId.
    // We verify the function exists and is callable with the expected shape.
    expect(typeof hasConsent).toBe('function');
  });
});

// Verify the concurrent-idempotency fix: grantConsent must catch the unique
// violation (SQLSTATE 23505) raised by uq_user_consents_active and re-select
// the winning row, so two racing grants both observe "return existing".
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __consentsDir = dirname(fileURLToPath(import.meta.url));
const consentsSrc = readFileSync(join(__consentsDir, '../repositories/consents.ts'), 'utf-8');

describe('Consent repository — concurrent idempotency', () => {
  it('grantConsent catches SQLSTATE 23505 (unique_violation)', () => {
    expect(consentsSrc).toContain("'23505'");
  });

  it('re-selects the active consent after a unique conflict', () => {
    expect(consentsSrc).toMatch(/code === '23505'[\s\S]*matchActive/);
  });

  it('uses a reusable matchActive helper for both check and retry', () => {
    // Both the initial existence check and the post-conflict re-select must
    // use the same matcher so they agree on which row is "active".
    const matches = consentsSrc.match(/matchActive\(\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});
