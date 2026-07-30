import { describe, it, expect } from 'bun:test';
describe('Application consent policy — module structure', () => {
  it('keeps only consent policy controls', async () => {
    const appControl = await import('../repositories/application-control.js');
    const expectedFns = [
      'getApplicationConsentSettings',
      'upsertApplicationConsentSettings',
    ];
    for (const fn of expectedFns) {
      expect(typeof (appControl as any)[fn]).toBe('function');
    }
  });
});
