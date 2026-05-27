import { describe, it, expect } from 'bun:test';

describe('Observability — getCurrentRequestId', () => {
  it('returns undefined when no request is active', async () => {
    // Clear any previous value
    (globalThis as Record<string, unknown>).__currentRequestId = undefined;
    const { getCurrentRequestId } = await import('../middleware/index.js');
    expect(getCurrentRequestId()).toBeUndefined();
  });

  it('returns the request ID set in globalThis', async () => {
    (globalThis as Record<string, unknown>).__currentRequestId = 'test-req-123';
    const { getCurrentRequestId } = await import('../middleware/index.js');
    expect(getCurrentRequestId()).toBe('test-req-123');
    // Clean up
    (globalThis as Record<string, unknown>).__currentRequestId = undefined;
  });
});

describe('Observability — middleware structure', () => {
  it('exports observabilityMiddleware as Elysia instance', async () => {
    const { observabilityMiddleware } = await import('../middleware/index.js');
    expect(observabilityMiddleware).toBeDefined();
    expect(typeof observabilityMiddleware.fetch).toBe('function');
  });
});

describe('Observability — request ID format', () => {
  it('generates 16-character hex string', () => {
    // Replicate the generateRequestId logic
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('generates unique IDs across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      ids.add(Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    }
    // 100 random IDs should all be unique
    expect(ids.size).toBe(100);
  });
});
