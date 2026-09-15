import { describe, expect, test } from 'bun:test';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build, createServer, type Plugin } from 'vite';
import { hostedPageNames } from './build.js';
import { hostedPagesPlugin } from './vite-plugin.js';

describe('checked hosted Vite integration', () => {
  test('materializes hosted HTML before an earlier-listed static middleware can end the response', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'supauth-hosted-vite-dev-'));
    let staticHits = 0;
    const staticPlugin: Plugin = {
      name: 'fixture-static-middleware',
      configureServer(server) {
        server.middlewares.use((_request, response) => {
          staticHits++;
          response.setHeader('Content-Type', 'text/html');
          response.end('<script data-hosted-entry="unprocessed-static"></script>');
        });
      },
    };
    const server = await createServer({
      root, configFile: false, publicDir: false, logLevel: 'silent',
      cacheDir: resolve(root, '.vite'),
      plugins: [staticPlugin, hostedPagesPlugin()],
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, watch: null },
    });
    const http = createHttpServer(server.middlewares);
    try {
      await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('Expected an isolated TCP listener');
      const origin = `http://127.0.0.1:${address.port}`;
      for (const page of hostedPageNames) {
        for (const prefix of ['', '/admin']) {
          const response = await fetch(`${origin}${prefix}/${page}.html?probe=1`);
          const html = await response.text();
          expect(response.status).toBe(200);
          expect(response.headers.get('content-type')).toContain('text/html');
          expect(html).not.toContain('data-hosted-entry');
          expect(html).toContain('<script>');
        }
      }
      expect(staticHits).toBe(0);
      const fallback = await fetch(`${origin}/unrelated.html`);
      expect(await fallback.text()).toContain('unprocessed-static');
      expect(staticHits).toBe(1);
    } finally {
      await new Promise<void>((done, reject) => {
        http.close(error => error ? reject(error) : done());
        http.closeAllConnections();
      });
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test.each([true, false])('keeps adapter output ordering with ssr=%s', async (ssr) => {
    const root = await mkdtemp(resolve(tmpdir(), 'supauth-hosted-vite-build-'));
    const entry = resolve(root, 'entry.js');
    const output = resolve(root, 'build');
    const placeholder = '<script data-hosted-entry="fixture-adapter"></script>';
    const hosted = hostedPagesPlugin();
    const adapter: Plugin = {
      name: 'fixture-adapter-output',
      closeBundle: {
        sequential: true,
        async handler() {
          await mkdir(output, { recursive: true });
          for (const name of hostedPageNames) await writeFile(resolve(output, `${name}.html`), placeholder);
        },
      },
    };
    try {
      await writeFile(entry, 'export const fixture = true;');
      await build({
        root, configFile: false, publicDir: false, logLevel: 'silent',
        cacheDir: resolve(root, '.vite'),
        plugins: [hosted, adapter],
        build: { ssr, write: false, rollupOptions: { input: entry } },
      });
      expect(hosted.enforce).toBe('pre');
      expect(hosted.closeBundle).toMatchObject({ order: 'post', sequential: true });
      for (const name of hostedPageNames) {
        const html = await readFile(resolve(output, `${name}.html`), 'utf8');
        if (ssr) {
          expect(html).not.toContain('data-hosted-entry');
          expect(html).toContain('<!doctype html>');
        } else {
          expect(html).toBe(placeholder);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
