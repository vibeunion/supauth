import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const hostedPageNames = ['authorize', 'claim', 'change-password', 'account', 'logout'] as const;
export type HostedPageName = typeof hostedPageNames[number];
const entryNames = new Set<string>([...hostedPageNames, 'public-api-base']);
const sourceRoot = new URL('.', import.meta.url);
const staticRoot = new URL('../../static/', import.meta.url);

export function isHostedEntryName(name: string): boolean {
  return entryNames.has(name);
}

export async function buildHostedScript(name: string): Promise<string> {
  if (!isHostedEntryName(name)) throw new Error(`Unknown hosted entry: ${name}`);
  // 用进程边界隔离 Bun 构建类型，避免污染 Kit/Vite 的浏览器类型图。
  const { stdout } = await promisify(execFile)('bun', ['--no-env-file', '--no-install', fileURLToPath(new URL('build-runtime.ts', sourceRoot)), name], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

export async function materializeHostedHtml(html: string): Promise<string> {
  const entries = [...html.matchAll(/<script data-hosted-entry="([^"]+)"><\/script>/g)];
  if (!entries.length) throw new Error('Hosted HTML has no checked script entry');
  let rendered = html;
  for (const entry of entries) {
    const name = entry[1];
    if (!name) throw new Error('Missing hosted entry name');
    const script = await buildHostedScript(name);
    rendered = rendered.replace(entry[0], () => `<script>\n${script}</script>`);
  }
  return rendered;
}

export async function renderHostedPage(name: HostedPageName): Promise<string> {
  const html = await readFile(new URL(`${name}.html`, staticRoot), 'utf8');
  return materializeHostedHtml(html);
}

export function hostedStaticPath(name: HostedPageName, directory: string): string {
  return resolve(directory, `${name}.html`);
}

if (import.meta.main) {
  const entry = process.argv[2];
  if (!entry) throw new Error('Hosted script entry is required');
  process.stdout.write(await buildHostedScript(entry));
}
