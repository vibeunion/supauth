import { describe, expect, test } from 'bun:test';
import {
  parseJsonRecord,
  positiveIntegerFromEnv,
  requireArray,
  requireDefined,
  requireString,
} from '../scripts/tooling-values.js';

describe('tooling untrusted values', () => {
  test.each(['null', '[]', '1', '"value"', '{'])('rejects non-object JSON %s', source => {
    expect(() => parseJsonRecord(source)).toThrow();
  });

  test('keeps unknown fields without asserting their types', () => {
    const document = parseJsonRecord('{"nested":{"enabled":true},"items":[1]}');
    expect(document).toEqual({ nested: { enabled: true }, items: [1] });
    expect(() => requireString(document['nested'])).toThrow();
    expect(() => requireArray(document['nested'])).toThrow();
    expect(() => requireDefined(document['missing'])).toThrow();
  });

  test.each(['', '0', '-1', '1.5', '2suffix', ' 2', 'NaN', 'Infinity', '99999999999999999999'])(
    'rejects invalid environment integers %s', value => {
      expect(() => positiveIntegerFromEnv(value, 10, 'COUNT')).toThrow();
    },
  );

  test('checks defaults and bounds as well as configured values', () => {
    expect(positiveIntegerFromEnv(undefined, 10, 'COUNT', 100)).toBe(10);
    expect(positiveIntegerFromEnv('100', 10, 'COUNT', 100)).toBe(100);
    expect(() => positiveIntegerFromEnv('101', 10, 'COUNT', 100)).toThrow();
    expect(() => positiveIntegerFromEnv(undefined, 0, 'COUNT')).toThrow();
  });
});
