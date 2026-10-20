export const CURRENT_COMPAT_VERSION = 'v2.197.0';
export const SUPPORTED_COMPAT_VERSIONS = ['v2.192.0', 'v2.196.0', CURRENT_COMPAT_VERSION] as const;

export function assertExpectedRuntimeVersion(runtimeVersion: string, expectedVersion: string): void {
  if (!SUPPORTED_COMPAT_VERSIONS.some(version => version === expectedVersion)) {
    throw new Error(`Unsupported GoTrue compatibility matrix version: ${expectedVersion}`);
  }
  if (runtimeVersion !== expectedVersion) {
    throw new Error(`Expected GoTrue ${expectedVersion} but runtime health reports ${runtimeVersion}`);
  }
}

export function requiresOfflineAccess(runtimeVersion: string): boolean {
  assertExpectedRuntimeVersion(runtimeVersion, runtimeVersion);
  return runtimeVersion !== 'v2.192.0';
}

export function compatibilityScopes(runtimeVersion: string): string[] {
  return requiresOfflineAccess(runtimeVersion)
    ? ['openid', 'email', 'profile', 'offline_access']
    : ['openid', 'email', 'profile'];
}
