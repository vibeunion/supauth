const root = new URL('..', import.meta.url).pathname;

const commands = [
  { name: 'supauth-function', args: ['bun', 'run', 'dev:function'] },
  { name: 'admin-console', args: ['bun', 'run', 'dev:admin'] },
];

const children = commands.map(({ name, args }) => {
  console.log(`Starting ${name}...`);
  return Bun.spawn(args, {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
});

type KillSignal = Parameters<(typeof children)[number]['kill']>[0];

async function stopAll(signal?: KillSignal) {
  for (const child of children) {
    child.kill(signal ?? 'SIGTERM');
  }
}

process.on('SIGINT', () => {
  void stopAll('SIGINT').finally(() => process.exit(130));
});

process.on('SIGTERM', () => {
  void stopAll('SIGTERM').finally(() => process.exit(143));
});

const firstExit = await Promise.race(
  children.map(async (child, index) => ({ index, exitCode: await child.exited })),
);

await stopAll();
process.exit(firstExit.exitCode ?? 0);
