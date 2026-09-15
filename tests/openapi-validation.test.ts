import { describe, expect, spyOn, test } from 'bun:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {
  createOpenApiMemorySource, createOpenApiValidationSession, validateOpenApiDocument,
} from '../scripts/openapi-validation.js';

type ObjectValue = Record<string, unknown>;
function spec(schema: ObjectValue = {}, media: ObjectValue = {}) {
  return {
    openapi: '3.0.3',
    info: { title: 'Validation probe', version: '1' },
    paths: { '/probe': { post: {
      requestBody: { content: { 'application/json': { schema, ...media } } },
      responses: { 200: { description: 'Success' } },
    } } },
  };
}
const references = [
  '#/ordinary-payload-data',
  'file:///__supauth_synthetic_never_read__/data.json',
  'https://example.invalid/ordinary-payload.json',
  './__supauth_synthetic_never_read__.json',
  'supauth://openapi/other.json',
];
const invalid = 'OpenAPI document is invalid or contains an unresolved reference';

describe('inspection-local successful OpenAPI validation reuse', () => {
  test('reuses only identical successful JSON, including a separate object', async () => {
    const calls = spyOn(SwaggerParser, 'validate');
    try {
      const validate = createOpenApiValidationSession();
      const document = spec();
      await validate(document);
      await validate(structuredClone(document));
      expect(calls).toHaveBeenCalledTimes(1);
      document.info.title = 'Different valid source';
      await validate(document);
      expect(calls).toHaveBeenCalledTimes(2);
      document.openapi = 'invalid';
      await expect(validate(document)).rejects.toThrow(invalid);
      expect(calls).toHaveBeenCalledTimes(3);
      await expect(validate(document)).rejects.toThrow(invalid);
      expect(calls).toHaveBeenCalledTimes(4);
    } finally {
      calls.mockRestore();
    }
  });

  test('checks fields that serialization would discard before looking up a success', async () => {
    const validate = createOpenApiValidationSession();
    const document = spec();
    await validate(document);
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 'discarded']) {
      await expect(validate({ ...document, 'x-probe': value })).rejects.toThrow(invalid);
    }
    let accessorCalls = 0;
    await expect(validate({
      ...document, get 'x-probe'() { accessorCalls += 1; return undefined; },
    })).rejects.toThrow(invalid);
    expect(accessorCalls).toBe(0);
  });

  test('rejects newly introduced external and unresolved references after success', async () => {
    const calls = spyOn(SwaggerParser, 'validate');
    try {
      const validate = createOpenApiValidationSession();
      const document = spec();
      await validate(document);
      for (const ref of references) {
        document.paths['/probe'].post.requestBody.content['application/json'].schema = { $ref: ref };
        await expect(validate(document)).rejects.toThrow(invalid);
      }
      // 只有内部缺失引用进入标准校验；外部引用在内存源检查时拒绝。
      expect(calls).toHaveBeenCalledTimes(2);
    } finally {
      calls.mockRestore();
    }
  });

  test('does not share successful validation across sessions or standalone calls', async () => {
    const calls = spyOn(SwaggerParser, 'validate');
    try {
      const document = spec();
      await createOpenApiValidationSession()(document);
      await createOpenApiValidationSession()(document);
      await validateOpenApiDocument(document);
      await validateOpenApiDocument(document);
      expect(calls).toHaveBeenCalledTimes(4);
    } finally {
      calls.mockRestore();
    }
  });

  test('does not admit an in-flight validation as a completed success', async () => {
    const calls = spyOn(SwaggerParser, 'validate');
    try {
      const validate = createOpenApiValidationSession();
      const document = spec();
      await Promise.all([validate(document), validate(document)]);
      expect(calls).toHaveBeenCalledTimes(2);
      await validate(document);
      expect(calls).toHaveBeenCalledTimes(2);
    } finally {
      calls.mockRestore();
    }
  });
});

describe('OpenAPI validation distinguishes data from references', () => {
  test.each([undefined, null, true, 7, 'https://example.invalid/openapi.json', [], {}].map(value => ({ value })))(
    'rejects invalid top-level documents instead of treating input as a path %#', async ({ value }) => {
      await expect(validateOpenApiDocument(value)).rejects.toThrow(invalid);
    },
  );

  test('only exposes a checked immutable JSON snapshot at the fixed memory URL', () => {
    const document = spec();
    const original = JSON.stringify(document);
    const source = createOpenApiMemorySource(document);
    document.info.title = 'Changed after snapshot';
    expect(source.url).toBe('supauth://openapi/document.json');
    expect(source.resolver.canRead({ url: source.url })).toBe(true);
    expect(source.resolver.read({ url: source.url })).toBe(original);
    for (const url of [
      'supauth://openapi/other.json',
      `${source.url}?redirect=other`,
      `${source.url}#/paths`,
      'file:///__supauth_synthetic_never_read__/data.json',
      'https://example.invalid/openapi.json',
      './document.json',
    ]) {
      expect(source.resolver.canRead({ url })).toBe(false);
      expect(() => source.resolver.read({ url })).toThrow('fixed in-memory OpenAPI URL');
    }
  });

  test('rejects values that JSON serialization would silently change', async () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 'discarded']) {
      await expect(validateOpenApiDocument(spec({ example: value }))).rejects.toThrow(invalid);
    }
    let accessorCalls = 0;
    const document = { ...spec(), get 'x-probe'() { accessorCalls += 1; return 'not JSON data'; } };
    await expect(validateOpenApiDocument(document)).rejects.toThrow(invalid);
    expect(accessorCalls).toBe(0);
  });

  test('does not rewrite relative server URLs or mutate the input document', async () => {
    const document = { ...spec(), servers: [{ url: '/auth/v1' }] };
    const before = structuredClone(document);
    await validateOpenApiDocument(document);
    expect(document).toEqual(before);
  });

  test('accepts an OAuth flow scope named $ref without exempting SecurityScheme references', async () => {
    const document = {
      ...spec(),
      components: { securitySchemes: { OAuth: {
        type: 'oauth2',
        flows: { implicit: { authorizationUrl: 'https://example.invalid/authorize', scopes: { $ref: 'Read access' } } },
      } } },
    };
    await validateOpenApiDocument(document);
    await expect(validateOpenApiDocument({
      ...spec(), components: { securitySchemes: { OAuth: { $ref: '#/components/securitySchemes/Missing' } } },
    })).rejects.toThrow(invalid);
    await expect(validateOpenApiDocument({
      ...spec(), components: { securitySchemes: { OAuth: {
        type: 'oauth2', flows: { implicit: {
          authorizationUrl: 'https://example.invalid/authorize', scopes: { $ref: { invalid: 'not a string' } },
        } },
      } } },
    })).rejects.toThrow(invalid);
  });

  test.each(references)('preserves literal $ref data: %s', async ref => {
    const literal = { $ref: ref, nested: [{ $ref: ref }] };
    const document = spec(
      { type: 'object', example: literal, default: literal, enum: [literal] },
      { example: literal },
    );
    const before = structuredClone(document);
    await validateOpenApiDocument(document);
    await validateOpenApiDocument(spec({}, { examples: { payload: { value: literal } } }));
    expect(document).toEqual(before);
  });

  test.each(references)('rejects actual Schema and Example ReferenceObjects: %s', async ref => {
    await expect(validateOpenApiDocument(spec({ $ref: ref }))).rejects.toThrow(invalid);
    await expect(validateOpenApiDocument(spec({}, { examples: { payload: { $ref: ref } } })))
      .rejects.toThrow(invalid);
  });

  test.each(['example', 'examples', 'default', 'value', 'enum', 'x-probe', '$ref', '__proto__'])(
    'does not exempt a schema property named %s', async name => {
      await expect(validateOpenApiDocument(spec({
        type: 'object', properties: { [name]: { $ref: '#/components/schemas/Missing' } },
      }))).rejects.toThrow(invalid);
    },
  );

  test.each(['example', 'value', 'x-probe', '__proto__'])(
    'does not exempt an ExampleObject named %s', async name => {
      await expect(validateOpenApiDocument(spec({}, {
        examples: { [name]: { $ref: '#/components/examples/Missing' } },
      }))).rejects.toThrow(invalid);
    },
  );

  test('handles data reached through reusable components and real recursive schemas', async () => {
    const document = {
      ...spec({ $ref: '#/components/schemas/Node' }, {
        examples: { payload: { $ref: '#/components/examples/Payload' } },
      }),
      components: {
        schemas: { Node: {
          type: 'object',
          properties: { next: { $ref: '#/components/schemas/Node' } },
          example: { $ref: '#/ordinary-payload-data' },
        } },
        examples: { Payload: { value: { $ref: 'file:///__supauth_synthetic_never_read__/data.json' } } },
      },
    };
    await validateOpenApiDocument(document);
    expect(document.paths['/probe'].post.requestBody.content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/Node' });
  });

  test.each(references)('does not allow Schema references to launder ordinary-data references: %s', ref => {
    const document = {
      ...spec({ $ref: '#/components/examples/Payload/value' }),
      components: { examples: { Payload: { value: { $ref: ref } } } },
    };
    return expect(validateOpenApiDocument(document)).rejects.toThrow(invalid);
  });

  test('also rejects percent-encoded reference targets inside literal data', async () => {
    const document = {
      ...spec({ $ref: '#/components/schemas/Node/%65xample' }),
      components: { schemas: { Node: { example: { $ref: 'https://example.invalid/data.json' } } } },
    };
    await expect(validateOpenApiDocument(document)).rejects.toThrow(invalid);
  });

  test('validates parameter/header data but not their genuine schema references', async () => {
    const document = spec();
    Object.assign(document.paths['/probe'].post, {
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'object' }, example: { $ref: '#/data' } },
        { name: 'r', in: 'query', schema: { type: 'object' },
          examples: { payload: { value: { $ref: '#/data' } } } },
      ],
      responses: { 200: { description: 'Success', headers: {
        'X-Probe': { schema: { type: 'object' }, example: { $ref: '#/data' } },
      } } },
    });
    await validateOpenApiDocument(document);
    Object.assign(document.paths['/probe'].post, {
      parameters: [{ name: 'q', in: 'query', schema: { $ref: '#/Missing' } }],
    });
    await expect(validateOpenApiDocument(document)).rejects.toThrow(invalid);
  });

  test('keeps unknown structural shapes and missing references fail-closed', async () => {
    await expect(validateOpenApiDocument(spec({ properties: { example: { type: 'invalid' } } })))
      .rejects.toThrow(invalid);
    await expect(validateOpenApiDocument(spec({}, { examples: { value: { value: 1, externalValue: 42 } } })))
      .rejects.toThrow(invalid);
    await expect(validateOpenApiDocument(spec({ allOf: [{ $ref: '#/Missing' }], example: { $ref: '#/data' } })))
      .rejects.toThrow(invalid);
  });

  test('does not ignore references under escaped path and property tokens', async () => {
    const document = spec({ properties: { 'a/b~example': { $ref: '#/Missing' } } });
    document.paths = { '/probe': document.paths['/probe'] };
    await expect(validateOpenApiDocument(document)).rejects.toThrow(invalid);
  });

  test('never attempts file or network access for genuine or ordinary-data references', async () => {
    const blocked = () => { throw new Error('Unexpected external access'); };
    const guards = [
      spyOn(fs, 'readFile').mockImplementation(Object.assign(blocked, { __promisify__: blocked })),
      spyOn(fs, 'readFileSync').mockImplementation(blocked),
      spyOn(fs.promises, 'readFile').mockImplementation(blocked),
      spyOn(http, 'get').mockImplementation(blocked),
      spyOn(http, 'request').mockImplementation(blocked),
      spyOn(https, 'get').mockImplementation(blocked),
      spyOn(https, 'request').mockImplementation(blocked),
      spyOn(globalThis, 'fetch').mockImplementation(Object.assign(blocked, { preconnect: blocked })),
    ];
    try {
      for (const ref of references) {
        await validateOpenApiDocument(spec({ example: { $ref: ref } }));
        await expect(validateOpenApiDocument(spec({ $ref: ref }))).rejects.toThrow(invalid);
      }
      for (const guard of guards) expect(guard).not.toHaveBeenCalled();
    } finally {
      for (const guard of guards) guard.mockRestore();
    }
  });
});
