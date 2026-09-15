import { describe, expect, it } from 'bun:test';
import { canonicalizeOpenApiReferences } from '../scripts/openapi-schema-references.js';
import { JsonValueSchema } from '../packages/shared/src/schema.js';

function document(schema: unknown) {
  return { paths: { '/probe': { get: { responses: { 200: { content: { 'application/json': { schema } } } } } } } };
}

describe('portable OpenAPI schema references', () => {
  it('canonicalizes hidden Elysia response status maps as well as direct bindings', () => {
    const { spec, inventory } = canonicalizeOpenApiReferences({ paths: {} }, [{
      operation: { 'x-supauth-bindings': { response: { 200: JsonValueSchema, 400: { $ref: 'SupAuthJsonValue' } } } },
    }]);
    expect(JSON.stringify(spec)).toContain('"SupAuthJsonValue":');
    expect(JSON.stringify(inventory)).not.toContain('"$id"');
    expect(JSON.stringify(inventory)).not.toContain('"$ref":"SupAuthJsonValue"');
    expect(() => canonicalizeOpenApiReferences({ paths: {} }, [{
      operation: { 'x-supauth-bindings': { response: { 200: { $ref: 'Missing' } } } },
    }])).toThrow('reference');
  });

  it('hoists recursive schema IDs without mutating runtime schemas', () => {
    const { spec, inventory } = canonicalizeOpenApiReferences(document(JsonValueSchema), [{
      operation: { 'x-supauth-bindings': { body: JsonValueSchema } },
    }]);
    expect(JSON.stringify(spec)).toContain('"$ref":"#/components/schemas/SupAuthJsonValue"');
    expect(JSON.stringify(inventory)).toContain('"$ref":"#/components/schemas/SupAuthJsonValue"');
    expect(JSON.stringify(spec)).not.toContain('"$id"');
    expect(JsonValueSchema.$id).toBe('SupAuthJsonValue');
  });

  it('rejects missing, external, and conflicting definitions', () => {
    for (const $ref of ['Missing', 'https://example.test/schema', '#/components/schemas/Missing']) {
      expect(() => canonicalizeOpenApiReferences(document({ $ref }), [])).toThrow();
    }
    expect(() => canonicalizeOpenApiReferences(document({ $id: 'Same', type: 'string' }), [
      { operation: { schema: { $id: 'Same', type: 'number' } } },
    ])).toThrow('Conflicting');
  });

  it('preserves example data and properties named after schema keywords', () => {
    const example = { $id: 'payload-id', $ref: 'not-a-reference' };
    const { spec } = canonicalizeOpenApiReferences(document({
      type: 'object', properties: {
        enum: { $id: 'Named', type: 'string', example },
        value: { $ref: 'Named' },
      }, example,
    }), []);
    expect(JSON.stringify(spec)).toContain('"$ref":"#/components/schemas/Named"');
    expect(JSON.stringify(spec)).toContain(JSON.stringify(example));
  });

  it('accepts valid existing local component references', () => {
    const input = { ...document({ $ref: '#/components/schemas/Name' }), components: { schemas: { Name: { type: 'string' } } } };
    expect(canonicalizeOpenApiReferences(input, []).spec).toEqual(input);
  });

  it('validates schema dependencies while preserving property dependency arrays', () => {
    expect(() => canonicalizeOpenApiReferences(document({
      type: 'object', dependencies: { id: { $ref: 'Missing' } },
    }), [])).toThrow('reference');
    const { spec, inventory } = canonicalizeOpenApiReferences(document({
      type: 'object',
      dependencies: {
        id: { $id: 'Dependency', type: 'object', properties: { name: { type: 'string' } } },
        alias: { $ref: 'Dependency' },
        name: ['$ref', '$id'],
      },
    }), [{ operation: { schema: { dependencies: { id: { $ref: 'Dependency' } } } } }]);
    expect(JSON.stringify(spec)).toContain('"$ref":"#/components/schemas/Dependency"');
    expect(JSON.stringify(inventory)).toContain('"$ref":"#/components/schemas/Dependency"');
    expect(JSON.stringify(spec)).toContain('"name":["$ref","$id"]');
    expect(JSON.stringify(spec)).not.toContain('"$id":"Dependency"');
  });
});
