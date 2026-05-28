import { describe, expect, it } from 'bun:test';

describe('Sign-in experience repository — module structure', () => {
  it('exports global and application-level experience functions', async () => {
    const repo = await import('../repositories/sign-in-experience.js');
    const expectedFns = [
      'getSignInExperience',
      'updateSignInExperience',
      'getApplicationSignInExperience',
      'upsertApplicationSignInExperience',
      'deleteApplicationSignInExperience',
      'resolveSignInExperience',
    ];

    for (const fn of expectedFns) {
      expect(typeof (repo as Record<string, unknown>)[fn]).toBe('function');
    }
  });
});
