import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  findOpenApiBreakingChanges,
  type OpenApiDocument,
  type OpenApiObject,
} from '../scripts/openapi-additive-contract.js';

const baseline = JSON.parse(
  readFileSync('tests/fixtures/openapi-gotrue-only-baseline.json', 'utf8'),
) as OpenApiDocument;

function currentSpec(): OpenApiDocument {
  return structuredClone(baseline);
}

function paths(specification: OpenApiDocument): OpenApiObject {
  return specification.paths as OpenApiObject;
}

function operation(specification: OpenApiDocument, path: string, method: string): OpenApiObject {
  return (paths(specification)[path] as OpenApiObject)[method] as OpenApiObject;
}

function applicationGrantSchema(specification: OpenApiDocument): OpenApiObject {
  const requestBody = operation(specification, '/v1/applications/', 'post').requestBody as OpenApiObject;
  const content = requestBody.content as OpenApiObject;
  const mediaType = content['application/json'] as OpenApiObject;
  const schema = mediaType.schema as OpenApiObject;
  return (schema.properties as OpenApiObject).grant_types as OpenApiObject;
}

describe('GoTrue-only OpenAPI additive contract', () => {
  test('keeps legacy metadata sync routes outside the supported baseline', () => {
    expect(paths(baseline)['/v1/sync/user/{userId}']).toBeUndefined();
    expect(paths(baseline)['/v1/sync/org/{orgId}']).toBeUndefined();
  });

  test('accepts the checked-in baseline and additive paths, methods, and schemas', () => {
    const current = currentSpec();
    paths(current)['/v1/additive-probe'] = {
      get: { operationId: 'getV1AdditiveProbe', responses: { 200: {} } },
    };
    (paths(current)['/v1/health'] as OpenApiObject).options = {
      operationId: 'optionsV1Health',
      responses: { 204: {} },
    };
    const schemas = ((current.components ||= {}).schemas ||= {}) as OpenApiObject;
    schemas.AdditiveProbe = { type: 'object', properties: { id: { type: 'string' } } };

    expect(findOpenApiBreakingChanges(baseline, current)).toEqual([]);
  });

  test('rejects a removed path', () => {
    const current = currentSpec();
    delete paths(current)['/v1/health'];

    expect(findOpenApiBreakingChanges(baseline, current)).toContain('Path removed: /v1/health');
  });

  test('rejects a removed method', () => {
    const current = currentSpec();
    delete (paths(current)['/v1/applications/'] as OpenApiObject).post;

    expect(findOpenApiBreakingChanges(baseline, current)).toContain('Operation removed: POST /v1/applications/');
  });

  test('rejects a removed operation schema', () => {
    const current = currentSpec();
    delete applicationGrantSchema(current).items;

    expect(findOpenApiBreakingChanges(baseline, current)).toContain(
      'POST /v1/applications/ requestBody.content.application/json.schema.properties.grant_types.items was removed',
    );
  });

  test('rejects an incompatible grant type schema', () => {
    const current = currentSpec();
    applicationGrantSchema(current).minItems = 2;

    expect(findOpenApiBreakingChanges(baseline, current)).toContain(
      'POST /v1/applications/ requestBody.content.application/json.schema.properties.grant_types.minItems changed from 1 to 2',
    );
  });
});
