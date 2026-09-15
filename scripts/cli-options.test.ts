import { describe, expect, expectTypeOf, test } from 'bun:test';
import { definedStringOptions } from './cli-options.js';

describe('defined CLI string options', () => {
  test('omits undefined values without dropping empty strings', () => {
    const result = definedStringOptions({
      manifestPath: undefined,
      baseUrl: '',
      artifactDir: '/tmp/example-artifact',
    });
    expect(result).toEqual({ baseUrl: '', artifactDir: '/tmp/example-artifact' });
    expect(Object.hasOwn(result, 'manifestPath')).toBe(false);
    expect(Object.hasOwn(result, 'baseUrl')).toBe(true);
    expectTypeOf(result).toEqualTypeOf<{
      manifestPath?: string;
      baseUrl?: string;
      artifactDir?: string;
    }>();
  });

  test('leaves the source options unchanged', () => {
    const input = Object.freeze({ outputPath: undefined, endpointPath: '/v1/settings' });
    expect(definedStringOptions(input)).toEqual({ endpointPath: '/v1/settings' });
    expect(Object.hasOwn(input, 'outputPath')).toBe(true);
    expect(input.endpointPath).toBe('/v1/settings');
  });

  test('does not copy inherited enumerable values', () => {
    const input = { artifactDir: '/tmp/example-artifact' };
    Object.setPrototypeOf(input, { token: 'inherited-placeholder' });
    expect(definedStringOptions(input)).toEqual({ artifactDir: '/tmp/example-artifact' });
    expect(Object.hasOwn(definedStringOptions(input), 'token')).toBe(false);
  });
});
