import { describe, expect, test } from 'bun:test';
import { buildSupAuthOpenApi, type DocumentedOperation } from '../packages/auth-server/src/http/documentation.js';
import { requireArray, requireDefined, requireRecord, parseJsonRecord } from '../scripts/tooling-values.js';

function render(options: DocumentedOperation['options'] = {}) {
  const document = buildSupAuthOpenApi([{ method: 'POST', path: '/v1/invitations', options }]);
  return requireDefined(requireDefined(document.paths['/v1/invitations'])['post']);
}

describe('Swagger 1.3.1 document compatibility', () => {
  test.each([
    ['GET', '/', '/', 'getIndex'],
    ['GET', '/v1/health', '/v1/health', 'getV1Health'],
    ['POST', '/v1/auth/login', '/v1/auth/login', 'postV1AuthLogin'],
    ['GET', '/v1/organizations/:orgId/', '/v1/organizations/{orgId}/', 'getV1OrganizationsByOrgId'],
    ['POST', '/v1/organizations/:orgId/invitations/:invitationId/accept',
      '/v1/organizations/{orgId}/invitations/{invitationId}/accept',
      'postV1OrganizationsByOrgIdInvitationsByInvitationIdAccept'],
    ['GET', '/v1/users/:userId?', '/v1/users/{userId}', 'getV1UsersByUserId'],
    ['GET', '/v1/sign-in/custom_ui/*', '/v1/sign-in/custom_ui/*', 'getV1Sign-inCustom_ui*'],
  ])('keeps the legacy operationId for %s %s', (method, path, expectedPath, expectedId) => {
    const document = buildSupAuthOpenApi([{ method, path, options: {} }]);
    expect(requireDefined(requireDefined(document.paths[expectedPath])[method.toLowerCase()])['operationId'])
      .toBe(expectedId);
  });

  test('preserves explicit operationId and detail without modifying the source', () => {
    const detail = {
      operationId: 'acceptInvitation', summary: 'Accept invitation',
      security: [{ bearerAuth: ['invitations:accept'] }],
      responses: { '204': { description: 'Accepted' } },
    };
    const before = JSON.stringify(detail);
    const operation = render({ detail });
    expect(operation).toMatchObject(detail);
    expect(operation['requestBody']).toBeUndefined();
    expect(JSON.stringify(detail)).toBe(before);
  });

  test('bound body replaces the entire detail requestBody and retains exact runtime constraints', () => {
    const body = {
      type: 'object', additionalProperties: false, required: ['token'],
      properties: { token: { type: 'string', minLength: 1 }, ttl_hours: { type: 'integer', minimum: 1, maximum: 168 } },
    };
    const detail = {
      requestBody: {
        required: false, description: 'Wider documentation',
        content: {
          'application/json': { schema: { type: 'object', additionalProperties: true } },
          'application/custom': { schema: { type: 'string' } },
        },
      },
      responses: { '200': { description: 'Accepted' } },
    };
    const before = JSON.stringify({ body, detail });
    const operation = render({ body, detail });
    expect(operation['requestBody']).toEqual({
      required: true,
      content: {
        'application/json': { schema: body },
        'multipart/form-data': { schema: body },
        'text/plain': { schema: body },
      },
    });
    expect(operation['responses']).toBe(detail.responses);
    const content = requireRecord(requireRecord(operation['requestBody'])['content']);
    for (const media of Object.values(content)) expect(requireRecord(media)['schema']).toBe(body);
    expect(JSON.stringify({ body, detail })).toBe(before);
  });

  test('uses legacy default media for a bound body even without requestBody detail', () => {
    const body = { type: 'object', properties: {}, additionalProperties: false };
    const request = requireRecord(render({ body })['requestBody']);
    expect(request['required']).toBe(true);
    const content = requireRecord(request['content']);
    expect(Object.keys(content)).toEqual(['application/json', 'multipart/form-data', 'text/plain']);
    for (const media of Object.values(content)) expect(requireRecord(media)['schema']).toEqual(body);
  });

  test('preserves domain-only requestBody and does not infer new body or response schemas', () => {
    const requestBody = {
      required: false,
      content: { 'application/custom': { schema: { type: 'string', minLength: 1 } } },
    };
    expect(render({ detail: { requestBody } })['requestBody']).toBe(requestBody);
    const empty = render();
    expect(empty['requestBody']).toBeUndefined();
    expect(empty['responses']).toBeUndefined();
    const opaque = {};
    const content = requireRecord(requireRecord(render({ body: opaque })['requestBody'])['content']);
    for (const media of Object.values(content)) expect(requireRecord(media)['schema']).toBe(opaque);
  });

  test('retains hidden exclusion, unsupported-method rejection and duplicate-route checks', () => {
    expect(buildSupAuthOpenApi([{ method: 'GET', path: '/hidden', options: { detail: { hide: true } } }]).paths)
      .toEqual({});
    expect(() => buildSupAuthOpenApi([{ method: 'CONNECT', path: '/', options: {} }]))
      .toThrow('Unsupported OpenAPI method');
    expect(() => buildSupAuthOpenApi([
      { method: 'GET', path: '/:id', options: {} },
      { method: 'GET', path: '/{id}', options: {} },
    ])).toThrow('Duplicate OpenAPI operation');
  });

  test('real organization body bindings override wider domain documentation without external requests', () => {
    const probe = Bun.spawnSync([process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', `
      globalThis.fetch = Object.assign(async () => { throw new Error("Network forbidden during documentation test"); }, { preconnect() {} });
      const { httpOperations } = await import("./packages/auth-server/src/http/operations.ts");
      const { buildSupAuthOpenApi } = await import("./packages/auth-server/src/http/documentation.ts");
      const document = buildSupAuthOpenApi(httpOperations);
      const bound = httpOperations.filter(operation => operation.options.body !== undefined);
      const results = bound.map(operation => {
        const path = operation.path.replace(/:([^/]+)/g, "{$1}");
        const rendered = document.paths[path][operation.method.toLowerCase()];
        return { method: operation.method, path,
          body: operation.options.body, requestBody: rendered.requestBody };
      });
      console.log(JSON.stringify({ results }));
    `], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        PATH: process.env['PATH'] ?? '', BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
        SUPACLOUD_API_URL: 'http://localhost:9090', SUPACLOUD_MASTER_TOKEN: 'documentation-placeholder',
        PROJECT_REF: 'documentation-placeholder', DATABASE_URL: 'postgres://placeholder',
      },
      timeout: 20_000, stdout: 'pipe', stderr: 'pipe',
    });
    expect(probe.exitCode).toBe(0);
    const result = parseJsonRecord(new TextDecoder().decode(probe.stdout));
    const results = requireArray(result['results']);
    expect(results).toHaveLength(4);
    for (const value of results) {
      const entry = requireRecord(value);
      const body = requireRecord(entry['body']);
      expect(body['additionalProperties']).toBe(false);
      const requestBody = requireRecord(entry['requestBody']);
      expect(requestBody['required']).toBe(true);
      const content = requireRecord(requestBody['content']);
      expect(Object.keys(content)).toEqual(['application/json', 'multipart/form-data', 'text/plain']);
      for (const media of Object.values(content)) expect(requireRecord(media)['schema']).toEqual(body);
      if (String(entry['path']).endsWith('/accept')) {
        expect(requireRecord(requireRecord(body['properties'])['token'])['minLength']).toBe(1);
      }
    }
  });
});
