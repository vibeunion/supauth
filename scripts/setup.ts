import { existsSync, copyFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const shouldMigrate = Bun.argv.includes('--migrate');

function run(command: string[], options: { allowFailure?: boolean } = {}) {
  const result = Bun.spawnSync(command, {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  if (result.exitCode !== 0 && !options.allowFailure) {
    process.exit(result.exitCode);
  }
}

console.log('Installing workspace dependencies...');
run(['bun', 'install']);

const envPath = `${root}.env`;
const envExamplePath = `${root}.env.example`;
if (!existsSync(envPath)) {
  copyFileSync(envExamplePath, envPath);
  console.log('Created .env from .env.example');
} else {
  console.log('.env already exists, leaving it unchanged');
}

if (shouldMigrate) {
  console.error('Direct DB migration is removed. Run `bun run install:supacloud` so SupaCloud Management API applies hosted migrations.');
  process.exit(1);
} else {
  console.log('Skipping migration. SupAuth migrations are applied by `bun run install:supacloud` through SupaCloud Management API.');
}

console.log('Setup complete. Start development with `bun run dev`.');
