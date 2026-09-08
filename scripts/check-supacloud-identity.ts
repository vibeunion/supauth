import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageDirectory = process.argv[2];
if (!packageDirectory) {
  throw new Error('Usage: bun scripts/check-supacloud-identity.ts <built-supacloud-elysia-directory>');
}
const entry = resolve(packageDirectory, 'dist/index.js');
if (!existsSync(entry)) throw new Error('Build the candidate @supacloud/elysia package before running this gate');

// 只传入本地工具链环境，不继承线上认证、数据库或部署凭据。
const environment = Object.fromEntries(
  ['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []),
);
const child = Bun.spawn([
  process.execPath, '--no-env-file', 'test', '--isolate',
  'tests/integration/supacloud-identity.test.ts',
], {
  cwd: resolve(import.meta.dir, '..'),
  env: {
    ...environment,
    RUN_SUPACLOUD_IDENTITY_CONTRACTS: '1',
    SUPACLOUD_ELYSIA_ENTRY: pathToFileURL(entry).href,
  },
  stdout: 'inherit',
  stderr: 'inherit',
});
const timer = setTimeout(() => child.kill(), 60_000);
try {
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`SupaCloud identity contract gate failed (${exitCode})`);
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) { child.kill(); await child.exited; }
}
