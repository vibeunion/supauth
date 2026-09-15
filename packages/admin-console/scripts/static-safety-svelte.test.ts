import { describe, expect, test } from 'bun:test';
import { extractSvelteSafetyRegions } from './static-safety-svelte.js';

describe('Svelte static safety source regions', () => {
  test('extracts both scripts without including tags or interpreting script-like text', () => {
    const source = `<script module lang="ts">export const label = '<script fake>';</script>
<script lang="ts">let value: unknown = null;</script>
<p>any ! as unknown as string</p>`;
    const result = extractSvelteSafetyRegions(source, 'example.svelte');
    expect(result.scripts.map((script) => [script.kind, script.text])).toEqual([
      ['module', "export const label = '<script fake>';"],
      ['instance', 'let value: unknown = null;'],
    ]);
    expect(result.templateExpressions).toEqual([]);
    for (const region of result.scripts) expect(source.slice(region.start, region.end)).toBe(region.text);
  });

  test('preserves nested assertions and non-null expressions in template code', () => {
    const source = `<script lang="ts">let value: unknown = null;</script>
{value as unknown as string}
{value!}
{@const unsafe = value as any}
<button onclick={(event: MouseEvent) => String(event)}>test</button>`;
    const result = extractSvelteSafetyRegions(source, 'expressions.svelte');
    expect(result.templateExpressions.map((region) => [region.kind, region.text])).toEqual([
      ['expression', 'value as unknown as string'],
      ['expression', 'value!'],
      ['statement', 'const unsafe = value as any'],
      ['expression', '(event: MouseEvent) => String(event)'],
    ]);
    for (const region of result.templateExpressions) expect(source.slice(region.start, region.end)).toBe(region.text);
  });

  test('handles absent and empty scripts and retains JSDoc in JavaScript script bodies', () => {
    expect(extractSvelteSafetyRegions('<p>plain</p>', 'empty.svelte')).toEqual({
      scripts: [], templateExpressions: [],
    });
    expect(extractSvelteSafetyRegions('<script></script>', 'empty-script.svelte').scripts).toEqual([
      { kind: 'instance', start: 8, end: 8, text: '' },
    ]);
    const source = '<script>const value = /** @type {string} */ (external);</script>';
    expect(extractSvelteSafetyRegions(source, 'js.svelte').scripts[0]?.text)
      .toBe('const value = /** @type {string} */ (external);');
  });

  test('extracts each, key, attribute, spread and snippet code while excluding CSS and text', () => {
    const source = `<script lang="ts">let items: string[] = [];</script>
{#each items as item, index (item)}<span title={item} {...{id: String(index)}}>{item}</span>{/each}
{#snippet label(value)}{value}{/snippet}
{@render label(items)}
<style>span::after { content: "any!"; }</style>`;
    const texts = extractSvelteSafetyRegions(source, 'blocks.svelte').templateExpressions.map((region) => region.text);
    expect(texts).toContain('items');
    expect(texts).toContain('item');
    expect(texts).toContain('{id: String(index)}');
    expect(texts).toContain('label(items)');
    expect(texts).not.toContain('any!');
  });

  test('preserves UTF-16 offsets and fails closed on parser errors', () => {
    const source = '<script lang="ts">let value = 1;</script><p>\u{1f600}</p>{value as const}';
    const region = extractSvelteSafetyRegions(source, 'unicode.svelte').templateExpressions[0];
    expect(region?.start).toBe(source.lastIndexOf('value'));
    expect(region?.text).toBe('value as const');
    expect(() => extractSvelteSafetyRegions('<script lang="ts">let = ;', 'invalid.svelte')).toThrow();
  });

  test('includes custom-element option expressions without duplicating derived parser metadata', () => {
    const source = `<script lang="ts">let value: unknown;</script>
<svelte:options customElement={{tag: "x-item", extend: (base: any) => base}}/>`;
    const regions = extractSvelteSafetyRegions(source, 'options.svelte').templateExpressions;
    expect(regions.map((region) => region.text)).toEqual([
      '{tag: "x-item", extend: (base: any) => base}',
    ]);
  });

  test('classifies typed, optional, default and rest snippet parameters as patterns', () => {
    const source = `<script lang="ts">let fallback = "default";</script>
{#snippet label(value: string, optional?: number, prefix = fallback, ...rest: unknown[])}
  {value}
{/snippet}`;
    const patterns = extractSvelteSafetyRegions(source, 'parameters.svelte').templateExpressions
      .filter((region) => region.kind === 'pattern')
      .map((region) => region.text);
    expect(patterns).toContain('value: string');
    expect(patterns).toContain('optional?: number');
    expect(patterns).toContain('prefix = fallback');
    expect(patterns).toContain('...rest: unknown[]');
  });

  test('retains forbidden types and nested assertions in snippet parameter patterns', () => {
    const source = `<script lang="ts">let fallback: unknown;</script>
{#snippet unsafe(value: any, prefix = fallback as unknown as string, {name}: {name: any})}
  {value}
{/snippet}`;
    const regions = extractSvelteSafetyRegions(source, 'unsafe-parameters.svelte').templateExpressions;
    for (const text of ['value: any', 'prefix = fallback as unknown as string', '{name}: {name: any}']) {
      expect(regions.some((region) => region.kind === 'pattern' && region.text === text)).toBe(true);
    }
  });
});
