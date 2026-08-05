import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

type OutboundCall = { method: string; path: string; body: unknown };

const originalFetch = globalThis.fetch;
const outboundCalls: OutboundCall[] = [];
const logAudit = mock(async () => ({}));
const outboundFetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  outboundCalls.push({
    method: init?.method || 'GET',
    path: new URL(url).pathname,
    body: requestBody,
  });
  return Response.json({ id: 'organization-one', ...requestBody });
});

const testEnvironment = {
  SUPACLOUD_INTERNAL_API_URL: 'http://supacloud.internal',
  SUPACLOUD_INTERNAL_TOKEN: 'test-token',
  SUPACLOUD_PROJECT_REF: 'test-project',
  SUPACLOUD_RUNTIME_URL: 'http://runtime.internal',
  SUPACLOUD_DATABASE_URL: 'postgres://test',
  SUPAOAUTH_BFF_SIGNING_SECRET: 'test-bff-signing-secret-0123456789abcdef',
};
const originalEnvironment = Object.fromEntries(
  Object.keys(testEnvironment).map((name) => [name, process.env[name]]),
);
Object.assign(process.env, testEnvironment);
globalThis.fetch = outboundFetch as unknown as typeof fetch;

mock.module('../repositories/audit.js', () => ({ logAudit }));

const { loadConfig } = await import('../config/index.js');
loadConfig();
const [{ organizationRoutes }, { observabilityMiddleware }] = await Promise.all([
  import('../routes/organizations.js'),
  import('../middleware/index.js'),
]);
const app = new Elysia().use(observabilityMiddleware).use(organizationRoutes);

function organizationCreateRequest(body: unknown) {
  return new Request('http://localhost/v1/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function organizationFields() {
  return {
    slug: 'organization-one',
    description: 'Organization description',
    branding: { display_name: 'Organization One' },
    jit_enabled: true,
  };
}

describe('organization creation defaults', () => {
  beforeEach(() => {
    outboundCalls.length = 0;
    outboundFetch.mockClear();
    logAudit.mockClear();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    for (const [name, originalValue] of Object.entries(originalEnvironment)) {
      if (originalValue === undefined) delete process.env[name];
      else process.env[name] = originalValue;
    }
  });

  it.each([
    ['omitted', organizationFields(), []],
    ['explicit empty', { ...organizationFields(), jit_domains: [] }, []],
    [
      'explicit non-empty',
      { ...organizationFields(), jit_domains: ['example.test'] },
      ['example.test'],
    ],
  ] as const)('forwards %s JIT domains through the real adapter', async (
    _domainScenario,
    requestBody,
    expectedDomains,
  ) => {
    const response = await app.handle(organizationCreateRequest(requestBody));

    expect(response.status).toBe(200);
    expect(outboundCalls).toEqual([{
      method: 'POST',
      path: '/v1/projects/test-project/organizations',
      body: { ...organizationFields(), jit_domains: expectedDomains },
    }]);
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'organization'],
    ['number', 42],
    ['boolean', true],
  ] as const)(
    'rejects %s input before platform access',
    async (_inputKind, requestBody) => {
      const response = await app.handle(organizationCreateRequest(requestBody));
      const payload = await response.json() as { error?: { code?: string } };

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe('invalid_request_body');
      expect(outboundFetch).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    },
  );
});
