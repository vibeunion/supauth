/**
 * SupaCloud 会把 Function 专属变量保存为 EDGEFN_<FUNCTION>_<NAME>，以避免
 * 覆盖平台自身的运行时变量。Function 专属变量优先；常规部署和本地开发在
 * 未注入该变量时兼容读取原始变量名。
 */
const SUPAUTH_FUNCTION_ENV_PREFIX = 'EDGEFN_SUPAUTH_';

export function runtimeEnv(name: string): string | undefined {
  const functionScopedName = `${SUPAUTH_FUNCTION_ENV_PREFIX}${name}`;
  return Object.hasOwn(process.env, functionScopedName)
    ? process.env[functionScopedName]
    : process.env[name];
}

export function firstRuntimeEnv(...names: string[]): string {
  for (const name of names) {
    const value = runtimeEnv(name);
    if (value) return value;
  }
  return '';
}
