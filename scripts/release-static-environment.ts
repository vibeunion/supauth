import { readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

type Environment = Record<string, string | undefined>;

/** 静态检查不继承任何 live 开关、认证材料或数据库目标。 */
export function releaseStaticEnvironment(source: Environment): Environment {
  const environment: Environment = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'LANG', 'LC_ALL', 'TZ']) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

/** 嵌套 package 脚本可重新启动 Bun，不能假定父进程的 --no-env-file 会被继承。 */
export function assertStaticCheckoutDoesNotLoadEnv(root: string): void {
  const excluded = new Set(['node_modules', '.git', '.agents', 'artifacts', 'output', 'dist', 'build', '.svelte-kit']);
  const boundary = realpathSync(root);
  const visited = new Set<string>();
  function inspect(directory: string): void {
    const canonical = realpathSync(directory);
    const location = relative(boundary, canonical);
    if (isAbsolute(location) || location === '..' || location.startsWith('../')) {
      throw new Error('RELEASE_STATIC_SYMLINK_OUTSIDE_CHECKOUT');
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (/^\.env(?:\.(?:local|development|production|test)(?:\.local)?)?$/.test(entry.name)) {
        throw new Error('RELEASE_STATIC_DOTENV_CHECKOUT_FORBIDDEN');
      }
      if (excluded.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = realpathSync(path);
        const target = relative(boundary, resolved);
        if (isAbsolute(target) || target === '..' || target.startsWith('../')) {
          throw new Error('RELEASE_STATIC_SYMLINK_OUTSIDE_CHECKOUT');
        }
        if (statSync(resolved).isDirectory()) inspect(resolved);
      } else if (entry.isDirectory()) inspect(path);
    }
  }
  inspect(root);
}
