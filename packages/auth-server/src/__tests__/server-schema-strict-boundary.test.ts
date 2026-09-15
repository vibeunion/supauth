import { describe, expect, it } from 'bun:test';
import { Type, type TSchema } from '../../../shared/src/schema.js';
import { serverContract } from '../utils/server-contract.js';

function options(input: TSchema) {
  return serverContract('strict:schema-metadata', {
    contract: { request: 'validated', input, responses: { 204: { kind: 'empty' } } },
  });
}

describe('server schema metadata boundaries', () => {
  it('rejects invalid property containers and non-TypeBox property schemas', () => {
    for (const properties of [null, [], 1, { body: {} }, { body: { type: 'string' } }]) {
      expect(() => options(Type.Unknown({ properties }))).toThrow();
    }
  });

  it('rejects invalid and sparse branch arrays before projecting fields', () => {
    const sparse: unknown[] = [];
    sparse.length = 1;
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      for (const branches of [null, {}, 'invalid', [null], [{}], [{ type: 'string' }], sparse]) {
        expect(() => options(Type.Unknown({ [keyword]: branches }))).toThrow();
      }
    }
  });

  it('rejects invalid required lists without treating arbitrary values as field names', () => {
    const sparse: unknown[] = [];
    sparse.length = 1;
    for (const required of [null, 'body', {}, [1], ['body', null], sparse]) {
      expect(() => options(Type.Unknown({
        properties: { body: Type.Object({}) }, required,
      }))).toThrow();
    }
  });

  it('preserves union, oneOf, and intersection required-field rules', () => {
    const requiredBody = Type.Object({ body: Type.Object({ name: Type.String() }) });
    const optionalBody = Type.Object({ body: Type.Optional(Type.Object({ count: Type.Number() })) });
    expect(options(Type.Union([requiredBody, optionalBody])).detail.requestBody?.required).toBe(false);
    expect(options(Type.Union([requiredBody, requiredBody])).detail.requestBody?.required).toBe(true);
    expect(options(Type.Intersect([requiredBody, optionalBody])).detail.requestBody?.required).toBe(true);
    expect(options(Type.Unknown({ oneOf: [requiredBody, optionalBody] })).detail.requestBody?.required).toBe(false);
    expect(options(Type.Unknown({ oneOf: [requiredBody, requiredBody] })).detail.requestBody?.required).toBe(true);
  });

  it('keeps numeric-query validation and the original request values', async () => {
    const route = options(Type.Object({
      query: Type.Object({ limit: Type.Integer({ minimum: 1 }) }),
    }));
    const query = { limit: '3' };
    await route.beforeHandle({ query, request: new Request('https://strict.invalid'), set: {} });
    expect(query.limit).toBe('3');
    await expect(route.beforeHandle({
      query: { limit: 'invalid' }, request: new Request('https://strict.invalid'), set: {},
    })).rejects.toMatchObject({ status: 400, code: 'invalid_request_body' });
    expect(route.detail.parameters).toMatchObject([{ name: 'limit', in: 'query', required: true }]);
  });

  it('does not read inherited Object keys as projected schema variants', () => {
    const toString = Type.String();
    const proto = Type.Number();
    const input = Type.Union([
      Type.Object({ query: Type.Object({ toString }) }),
      Type.Object({ query: Type.Object({ ['__proto__']: proto }) }),
    ]);
    const route = options(input);
    expect(route.detail.parameters).toEqual([
      { name: 'toString', in: 'query', required: false, schema: toString },
      { name: '__proto__', in: 'query', required: false, schema: proto },
    ]);
  });
});
