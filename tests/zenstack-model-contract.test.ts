import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const drizzleSchema = readFileSync(resolve(root, 'packages/auth-server/src/db/schema.ts'), 'utf8');
const zenstackSchema = readFileSync(resolve(root, 'packages/auth-server/zenstack/schema.zmodel'), 'utf8');
const generatedModels = readFileSync(resolve(root, 'packages/auth-server/zenstack/generated/models.ts'), 'utf8');

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)]
    .map(match => match[1] ?? match[0])
    .sort();
}

describe('ZenStack model contract', () => {
  test('keeps the authored model mapped to every Drizzle table', () => {
    const drizzleTables = matches(drizzleSchema, /supaoauth\.table\('([^']+)'/g);
    const zenstackTables = matches(zenstackSchema, /@@map\("([^"]+)"\)/g);

    expect(drizzleTables).toHaveLength(28);
    expect(zenstackTables).toEqual(drizzleTables);
    expect(matches(generatedModels, /^export type .* = \$ModelResult/gm)).toHaveLength(28);
  });

  test('keeps every model policy explicit while only the first slice is enabled', () => {
    const models = zenstackSchema.split(/\n(?=model )/).filter(section => section.startsWith('model '));
    expect(models).toHaveLength(28);
    expect(models.every(model => model.includes('@@deny') || model.includes('@@allow'))).toBe(true);
    const apiVersionLog = models.find(model => model.startsWith('model ApiVersionLog'));
    expect(apiVersionLog).toContain('@@allow("read"');
    expect(apiVersionLog).toContain('@@allow("create"');
  });
});
