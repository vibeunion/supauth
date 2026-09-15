import { describe, expect, spyOn, test } from 'bun:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import {
  documentNode, inspectReviewedOpenApi, nodeFingerprint, sha256,
} from '../scripts/openapi-document-corrections.js';

const legacy = {
  openapi: '3.0.3',
  info: { title: 'Contract probe', version: '1.0.0' },
  paths: {
    '/probe': {
      post: { operationId: 'probe', responses: { 200: { description: 'Success' } } },
    },
  },
};
const body = {
  required: true,
  content: { 'application/json': {
    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  } },
};
const reviewed = {
  ...legacy,
  paths: { '/probe': { post: { ...legacy.paths['/probe'].post, requestBody: body } } },
};
const pointer = '/paths/~1probe/post/requestBody';
const legacySource = JSON.stringify(legacy);
const reviewedSource = JSON.stringify(reviewed);
const entry = {
  pointer,
  kind: 'request-body-documentation',
  before: nodeFingerprint(documentNode(legacy, pointer)),
  after: nodeFingerprint(documentNode(reviewed, pointer)),
  reason: 'The historical handler already required the same name before mutation.',
  evidence: ['packages/auth-server/src/routes/probe.ts', 'tests/probe-contract.test.ts'],
};
const ledger = {
  version: 1,
  legacySha256: sha256(legacySource),
  reviewedSha256: sha256(reviewedSource),
  runtimeCommit: '7e753ed0b0dee57d39e19157b926cdd85c0ebc3f',
  corrections: [entry],
};

describe('bounded OpenAPI document corrections', () => {
  test('reuses identical stages only inside one inspection and rechecks changed current input', async () => {
    const calls = spyOn(SwaggerParser, 'validate');
    try {
      const current = structuredClone(reviewed);
      await inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify(ledger), current);
      expect(calls).toHaveBeenCalledTimes(1);
      await inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify(ledger), current);
      expect(calls).toHaveBeenCalledTimes(2);
      current.paths['/probe'].post.operationId = 'changed';
      const changed = await inspectReviewedOpenApi(
        legacySource, reviewedSource, JSON.stringify(ledger), current,
      );
      expect(calls).toHaveBeenCalledTimes(4);
      expect(changed.reviewedChanges).toContain('POST /probe operationId changed from probe to changed');
      current.openapi = 'invalid';
      await expect(inspectReviewedOpenApi(
        legacySource, reviewedSource, JSON.stringify(ledger), current,
      )).rejects.toThrow('invalid');
      expect(calls).toHaveBeenCalledTimes(6);
    } finally {
      calls.mockRestore();
    }
  });

  test('repairs an explicitly fingerprinted legacy empty response without accepting an invalid corrected document', async () => {
    const old = structuredClone(legacy);
    Reflect.set(old.paths['/probe'].post.responses, '200', {});
    const oldSource = JSON.stringify(old);
    const responsePointer = '/paths/~1probe/post/responses/200/description';
    const responseEntry = {
      ...entry, pointer: responsePointer, kind: 'response-documentation',
      before: nodeFingerprint(documentNode(old, responsePointer)),
      after: nodeFingerprint(documentNode(legacy, responsePointer)),
    };
    const source = JSON.stringify(legacy);
    const bound = { ...ledger, legacySha256: sha256(oldSource), reviewedSha256: sha256(source) };
    await expect(inspectReviewedOpenApi(oldSource, source, JSON.stringify({
      ...bound, corrections: [],
    }), legacy)).rejects.toThrow('invalid');
    const result = await inspectReviewedOpenApi(oldSource, source, JSON.stringify({
      ...bound, corrections: [responseEntry],
    }), legacy);
    expect(result.residualChanges).toEqual([]);
    expect(result.reviewedChanges).toEqual([]);
  });

  test('retains the raw report while comparing the reviewed node and complete typed baseline', async () => {
    const result = await inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify(ledger), reviewed);
    expect(result.rawChanges).toEqual(['POST /probe added a required request body']);
    expect(result.residualChanges).toEqual([]);
    expect(result.reviewedChanges).toEqual([]);
    expect(result.corrections).toBe(1);
    expect(legacy.paths['/probe'].post).not.toHaveProperty('requestBody');
  });

  test('never approves unlisted differences', async () => {
    const current = structuredClone(reviewed);
    current.paths['/probe'].post.operationId = 'different';
    const result = await inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify(ledger), current);
    expect(result.residualChanges).toContain('POST /probe operationId changed from probe to different');
    expect(result.reviewedChanges).toContain('POST /probe operationId changed from probe to different');
  });

  test('future restrictions and root authentication cannot hide behind an approved body', async () => {
    const current = {
      ...reviewed,
      security: [{ bearerAuth: [] }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      paths: { '/probe': { post: {
        ...reviewed.paths['/probe'].post,
        requestBody: {
          ...body, content: { 'application/json': { schema: {
            ...body.content['application/json'].schema,
            allOf: [{ maxProperties: 1 }],
          } } },
        },
      } } },
    };
    const result = await inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify(ledger), current);
    expect(result.residualChanges.some(change => change.includes('security'))).toBe(true);
    expect(result.reviewedChanges.some(change => change.includes('allOf'))).toBe(true);
  });

  test('protects reference definitions through the complete typed baseline', async () => {
    const withReference = {
      ...reviewed,
      components: { schemas: { Name: { type: 'string', minLength: 1 } } },
    };
    const source = JSON.stringify(withReference);
    const current = { ...withReference, components: { schemas: { Name: { type: 'string', minLength: 3 } } } };
    const result = await inspectReviewedOpenApi(
      legacySource, source, JSON.stringify({ ...ledger, reviewedSha256: sha256(source) }), current,
    );
    expect(result.reviewedChanges.some(change => change.includes('components.schemas.Name.minLength'))).toBe(true);
  });

  test('binds both baseline byte streams and rejects stale fingerprints', async () => {
    await expect(inspectReviewedOpenApi(`${legacySource}\n`, reviewedSource, JSON.stringify(ledger), reviewed))
      .rejects.toThrow('digest mismatch');
    await expect(inspectReviewedOpenApi(legacySource, `${reviewedSource}\n`, JSON.stringify(ledger), reviewed))
      .rejects.toThrow('digest mismatch');
    await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
      ...ledger, corrections: [{ ...entry, after: { present: true, digest: '0'.repeat(64) } }],
    }), reviewed)).rejects.toThrow('fingerprint');
  });

  test('distinguishes a missing node from an explicit null node', async () => {
    expect(nodeFingerprint({ present: false })).not.toEqual(nodeFingerprint({ present: true, value: null }));
    await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
      ...ledger, corrections: [{ ...entry, before: nodeFingerprint({ present: true, value: null }) }],
    }), reviewed)).rejects.toThrow('fingerprint');
  });

  test.each(['/paths', '/paths/~1probe', '/paths/~1probe/post', '/security', '/components'])(
    'rejects broad or security-changing correction scope %s', async broadPointer => {
      await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
        ...ledger, corrections: [{ ...entry, pointer: broadPointer }],
      }), reviewed)).rejects.toThrow('scope');
    },
  );

  test('rejects duplicates, parent/child overlaps, and unchanged entries', async () => {
    await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
      ...ledger, corrections: [entry, entry],
    }), reviewed)).rejects.toThrow('overlapping');
    await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
      ...ledger, corrections: [entry, { ...entry, pointer: `${pointer}/required` }],
    }), reviewed)).rejects.toThrow('overlapping');
    const unchanged = '/paths/~1probe/post/responses/200';
    const fingerprint = nodeFingerprint(documentNode(legacy, unchanged));
    await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
      ...ledger, corrections: [{
        ...entry, pointer: unchanged, kind: 'response-documentation', before: fingerprint, after: fingerprint,
      }],
    }), reviewed)).rejects.toThrow('Unused');
  });

  test('requires both historical runtime and regression-test evidence', async () => {
    await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
      ...ledger, corrections: [{ ...entry, evidence: ['docs/review.md', 'docs/design.md'] }],
    }), reviewed)).rejects.toThrow('evidence');
    for (const path of ['packages/__tests__/only.test.ts', 'packages/example/src/only.test.ts', 'packages/example/tests/only.ts']) {
      await expect(inspectReviewedOpenApi(legacySource, reviewedSource, JSON.stringify({
        ...ledger, corrections: [{ ...entry, evidence: [path, 'docs/review.md'] }],
      }), reviewed)).rejects.toThrow('evidence');
    }
  });

  test('rejects malformed escaped pointers and array gaps', async () => {
    expect(() => documentNode(legacy, '/paths/~2probe')).toThrow('pointer');
    const withHeader = {
      ...reviewed, paths: { '/probe': { post: {
        ...reviewed.paths['/probe'].post, parameters: [
          { name: 'first', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'second', in: 'header', required: true, schema: { type: 'string' } },
        ],
      } } },
    };
    const source = JSON.stringify(withHeader);
    const secondPointer = '/paths/~1probe/post/parameters/1';
    await expect(inspectReviewedOpenApi(legacySource, source, JSON.stringify({
      ...ledger, reviewedSha256: sha256(source), corrections: [{
        ...entry, pointer: secondPointer, kind: 'parameter-documentation',
        before: nodeFingerprint(documentNode(legacy, secondPointer)),
        after: nodeFingerprint(documentNode(withHeader, secondPointer)),
      }],
    }), withHeader)).rejects.toThrow('gaps');
    const nestedPointer = `${secondPointer}/schema`;
    await expect(inspectReviewedOpenApi(legacySource, source, JSON.stringify({
      ...ledger, reviewedSha256: sha256(source), corrections: [{
        ...entry, pointer: nestedPointer, kind: 'parameter-documentation',
        before: nodeFingerprint(documentNode(legacy, nestedPointer)),
        after: nodeFingerprint(documentNode(withHeader, nestedPointer)),
      }],
    }), withHeader)).rejects.toThrow('gaps');
  });

  test('rejects malformed parameter containers before applying matching fingerprints', async () => {
    const invalid = {
      ...legacy, paths: { '/probe': { post: {
        ...legacy.paths['/probe'].post,
        parameters: { 0: { name: 'test', in: 'query', required: true, schema: { type: 'string' } } },
      } } },
    };
    const source = JSON.stringify(invalid);
    const target = '/paths/~1probe/post/parameters/0';
    await expect(inspectReviewedOpenApi(legacySource, source, JSON.stringify({
      ...ledger, reviewedSha256: sha256(source), corrections: [{
        ...entry, kind: 'parameter-documentation', pointer: target,
        before: nodeFingerprint(documentNode(legacy, target)),
        after: nodeFingerprint(documentNode(invalid, target)),
      }],
    }), invalid)).rejects.toThrow('OpenAPI document is invalid');
  });

  test.each([
    '#/components/schemas/Missing',
    'file:///tmp/supauth-must-not-be-read.json',
    'https://example.invalid/must-not-be-fetched.json',
  ])('rejects unresolved or external references: %s', async $ref => {
    const invalid = {
      ...reviewed, paths: { '/probe': { post: {
        ...reviewed.paths['/probe'].post,
        requestBody: { ...body, content: { 'application/json': { schema: { $ref } } } },
      } } },
    };
    const source = JSON.stringify(invalid);
    await expect(inspectReviewedOpenApi(legacySource, source, JSON.stringify({
      ...ledger, reviewedSha256: sha256(source), corrections: [{
        ...entry, after: nodeFingerprint(documentNode(invalid, pointer)),
      }],
    }), invalid)).rejects.toThrow('OpenAPI document is invalid');
  });

  test('also requires the corrected historical document to remain structurally valid', async () => {
    const withAccepted = {
      ...legacy, paths: { '/probe': { post: {
        ...legacy.paths['/probe'].post, responses: { 202: { description: 'Accepted' } },
      } } },
    };
    const source = JSON.stringify(withAccepted);
    const oldStatus = '/paths/~1probe/post/responses/200';
    const removeStatus = {
      ...entry, pointer: oldStatus, kind: 'response-documentation',
      before: nodeFingerprint(documentNode(legacy, oldStatus)),
      after: nodeFingerprint(documentNode(withAccepted, oldStatus)),
    };
    await expect(inspectReviewedOpenApi(legacySource, source, JSON.stringify({
      ...ledger, reviewedSha256: sha256(source), corrections: [removeStatus],
    }), withAccepted)).rejects.toThrow('OpenAPI document is invalid');
    const newStatus = '/paths/~1probe/post/responses/202';
    const result = await inspectReviewedOpenApi(legacySource, source, JSON.stringify({
      ...ledger, reviewedSha256: sha256(source), corrections: [removeStatus, {
        ...entry, pointer: newStatus, kind: 'response-documentation',
        before: nodeFingerprint(documentNode(legacy, newStatus)),
        after: nodeFingerprint(documentNode(withAccepted, newStatus)),
      }],
    }), withAccepted);
    expect(result.residualChanges).toEqual([]);
  });
});
