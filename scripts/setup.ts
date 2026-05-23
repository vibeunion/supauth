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
  console.log('Running database migration...');
  run(['bun', 'run', 'migrate']);
} else {
  console.log('Skipping migration. Run `bun run setup -- --migrate` when DATABASE_URL is ready.');
}

console.log('Setup complete. Start development with `bun run dev`.');
