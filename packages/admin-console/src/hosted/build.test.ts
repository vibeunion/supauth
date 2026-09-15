import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hostedPageNames, materializeHostedHtml, renderHostedPage } from './build.js';

describe('checked hosted page compilation', () => {
  test.each([...hostedPageNames])('%s retains script placement and original resource URLs', async (name) => {
    const source = await readFile(new URL(`../../static/${name}.html`, import.meta.url), 'utf8');
    const html = await renderHostedPage(name);
    const sourceScripts = [...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(sourceScripts.length);
    expect(html).not.toContain('data-hosted-entry');
    expect([...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]))
      .toEqual([...source.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]));
    const skeleton = (value: string) => value.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '<script></script>');
    expect(skeleton(html)).toBe(skeleton(source));
    for (const script of scripts) {
      expect(() => new Script(script[2] ?? '')).not.toThrow();
    }
    if (source.includes('data-hosted-entry="public-api-base"')) {
      expect(html).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = null;');
    }
    if (name === 'logout') expect(html).toContain('window.__SUPAOAUTH_POST_LOGOUT_REDIRECT__ = null;');
  });

  test('rejects missing or unregistered script entries', async () => {
    await expect(materializeHostedHtml('<html></html>')).rejects.toThrow('no checked script entry');
    await expect(materializeHostedHtml('<script data-hosted-entry="../../private"></script>'))
      .rejects.toThrow('Unknown hosted entry');
  });

  test.each(['', '../../private'])('isolated Bun entry rejects invalid input: %s', async (name) => {
    const runtime = fileURLToPath(new URL('./build-runtime.ts', import.meta.url));
    await expect(promisify(execFile)('bun', ['--no-env-file', '--no-install', runtime, name]))
      .rejects.toThrow('Unknown hosted entry');
  });

  test('covers all eight previously inline script blocks with a single checked source', async () => {
    let count = 0;
    for (const name of hostedPageNames) {
      const html = await readFile(new URL(`../../static/${name}.html`, import.meta.url), 'utf8');
      count += [...html.matchAll(/data-hosted-entry=/g)].length;
      expect(html).not.toMatch(/<script>(?!\s*<\/script>)/);
    }
    expect(count).toBe(8);
  });
});
