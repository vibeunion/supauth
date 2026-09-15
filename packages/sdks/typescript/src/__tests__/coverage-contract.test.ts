import { expect, test } from 'bun:test';
import { decodeCoverageDocument } from '../../scripts/coverage-contract.js';

test('coverage baselines reject malformed paths and operations instead of skipping them', () => {
  for (const value of [null, {}, { paths: [] }, { paths: { '/health': null } },
    { paths: { '/health': { get: null } } }, { paths: { '/health': { post: [] } } }]) {
    expect(() => decodeCoverageDocument(value)).toThrow();
  }
  const baseline = { paths: { '/health': { get: { operationId: 'health' }, parameters: [] } } };
  expect(decodeCoverageDocument(baseline)).toEqual(baseline);
});
