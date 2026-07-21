import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CleanupStack } from './integration/supabase-compat/cleanup.js';

describe('full-stack compatibility cleanup', () => {
  it('is safe when setup fails before any fixture is initialized', async () => {
    await expect(new CleanupStack().run()).resolves.toBeUndefined();
  });

  it('cleans registered resources in reverse creation order', async () => {
    const cleaned: string[] = [];
    const cleanup = new CleanupStack();
    cleanup.register('primary user', async () => { cleaned.push('primary user'); });
    cleanup.register('secondary user', async () => { cleaned.push('secondary user'); });

    await cleanup.run();

    expect(cleaned).toEqual(['secondary user', 'primary user']);
  });

  it('runs every cleanup and aggregates labeled errors', async () => {
    const cleaned: string[] = [];
    const cleanup = new CleanupStack();
    cleanup.register('primary user', async () => { throw new Error('delete failed'); });
    cleanup.register('storage object', async () => { cleaned.push('storage object'); });
    cleanup.register('realtime channel', async () => { throw new Error('unsubscribe failed'); });

    const failure = await cleanup.run().catch((error: unknown) => error);

    expect(cleaned).toEqual(['storage object']);
    expect(failure).toBeInstanceOf(AggregateError);
    const errors = (failure as AggregateError).errors as Error[];
    expect(errors.map((error) => error.message)).toEqual([
      'realtime channel: unsubscribe failed',
      'primary user: delete failed',
    ]);
  });

  it('registers a created user before authentication and keeps afterAll fixture-free', () => {
    const fullStackTest = readFileSync('tests/integration/supabase-compat/full-stack.test.ts', 'utf8');
    const fixtureCreation = fullStackTest.indexOf('await createCompatibilityUser(adminClient, label, cleanup)');
    const userRegistration = fullStackTest.indexOf('registerUserCleanup(adminClient, userId, cleanup)');
    const registeredUserReturn = fullStackTest.indexOf('return { email, userId }', userRegistration);
    const signIn = fullStackTest.indexOf('client.auth.signInWithPassword');
    const afterAllBody = fullStackTest.slice(fullStackTest.indexOf('afterAll(async () =>'), fullStackTest.indexOf('function supabaseClient'));

    expect(userRegistration).toBeGreaterThan(-1);
    expect(userRegistration).toBeLessThan(registeredUserReturn);
    expect(fixtureCreation).toBeLessThan(signIn);
    expect(afterAllBody).toContain('await cleanup.run()');
    expect(afterAllBody).not.toContain('primary.');
    expect(afterAllBody).not.toContain('secondary.');
  });
});
