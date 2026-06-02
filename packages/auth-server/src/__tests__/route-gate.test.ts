// P0-29: Route/domain integration gate tests

import { describe, it, expect, mock } from 'bun:test';

describe('P0-29: Route Gate', () => {
  it('runIntegrationGate returns expected structure', async () => {
    // Mock fetch to simulate healthy responses
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/auth/v1/health')) {
        return Promise.resolve(new Response('{"code":200,"status":"ok"}', { status: 200 }));
      }
      if (url.includes('/rest/v1/')) {
        return Promise.resolve(new Response('[]', { status: 200 }));
      }
      if (url.includes('/storage/v1/bucket')) {
        return Promise.resolve(new Response('[]', { status: 200 }));
      }
      if (url.includes('/realtime/v1/websocket')) {
        return Promise.resolve(new Response('ok', { status: 426 }));
      }
      if (url.includes('/functions/v1/')) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      if (url.includes('/api/v1/health')) {
        return Promise.resolve(new Response('{"status":"ok"}', { status: 200 }));
      }
      if (url.includes('/swagger')) {
        return Promise.resolve(new Response('<html></html>', { status: 200 }));
      }
      if (url.includes('/admin')) {
        return Promise.resolve(new Response('ok', { status: 200 }));
      }
      if (url.includes('/api/v1/applications')) {
        return Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as unknown as typeof fetch;

    // Dynamically import to use mocked fetch
    const { runIntegrationGate } = await import('../routes/route-gate.js');

    const result = await runIntegrationGate(
      'test-project-12345',
      'http://admin.test',
      'http://runtime.test',
      ['https://business.test'],
    );

    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('projectRef');
    expect(result).toHaveProperty('routes');
    expect(result).toHaveProperty('domainAudit');
    expect(result).toHaveProperty('envAudit');
    expect(result).toHaveProperty('allPassed');
    expect(result).toHaveProperty('conflicts');
    expect(result.projectRef).toBe('test-project-12345');
    expect(Array.isArray(result.routes)).toBe(true);
    expect(Array.isArray(result.domainAudit)).toBe(true);
    expect(Array.isArray(result.conflicts)).toBe(true);
    expect(result.envAudit.adminUrl).toBe('http://admin.test');
    expect(result.envAudit.runtimeUrl).toBe('http://runtime.test');
    expect(result.envAudit.extraDomains).toEqual(['https://business.test']);
    expect(result.domainAudit.some(domain => domain.domain === 'business.test')).toBe(true);

    globalThis.fetch = originalFetch;
  });

  it('detects upstream failures as conflicts', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/auth/v1/health')) {
        return Promise.resolve(new Response('ok', { status: 200 }));
      }
      if (url.includes('/rest/v1/')) {
        return Promise.resolve(new Response('upstream error', { status: 502 }));
      }
      if (url.includes('/storage/v1/bucket')) {
        return Promise.resolve(new Response('[]', { status: 200 }));
      }
      if (url.includes('/api/v1/health')) {
        return Promise.resolve(new Response('ok', { status: 200 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as unknown as typeof fetch;

    const { runIntegrationGate } = await import('../routes/route-gate.js');

    const result = await runIntegrationGate(
      'test-project-conflict',
      'http://admin.test',
      'http://runtime.test',
    );

    expect(result.allPassed).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts.some(c => c.includes('upstream error') || c.includes('502'))).toBe(true);

    globalThis.fetch = originalFetch;
  });

  it('normalizes trailing slashes in target URLs', async () => {
    const originalFetch = globalThis.fetch;
    const seenUrls: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      seenUrls.push(url);
      return Promise.resolve(new Response('ok', { status: url.includes('/api/v1/applications') ? 401 : 200 }));
    }) as unknown as typeof fetch;

    const { runIntegrationGate } = await import('../routes/route-gate.js');
    const result = await runIntegrationGate(
      'test-project-normalized',
      'http://admin.test/',
      'http://runtime.test/',
    );

    expect(result.envAudit.adminUrl).toBe('http://admin.test');
    expect(result.envAudit.runtimeUrl).toBe('http://runtime.test');
    expect(seenUrls.every(url => !url.includes('test//'))).toBe(true);
    expect(seenUrls.some(url => url.includes('/oauth/authorize'))).toBe(true);
    expect(seenUrls.some(url => url.includes('/v1/oauth/authorize'))).toBe(false);

    globalThis.fetch = originalFetch;
  });
});
