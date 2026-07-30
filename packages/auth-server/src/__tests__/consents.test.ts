import { describe, expect, it } from 'bun:test';

describe('Legacy consent repository boundary', () => {
  it('exports read-only decision history without active grant mutations', async () => {
    const repository = await import('../repositories/consents.js');

    expect(typeof repository.listLegacyUserConsentDecisions).toBe('function');
    expect(typeof repository.listLegacyApplicationConsentDecisions).toBe('function');
    expect('grantConsent' in repository).toBe(false);
    expect('revokeConsent' in repository).toBe(false);
    expect('hasConsent' in repository).toBe(false);
  });
});
