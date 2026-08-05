const LEGACY_CUSTOM_UI_SCOPE_BASE_PATHS = Object.freeze([
  '/custom-ui',
  '/v1/public/custom-ui',
]);

type CleanupFailureCode =
  | 'registration_enumeration_failed'
  | 'registration_unregistration_failed'
  | 'authority_readback_failed'
  | 'target_registration_persisted';

export type LegacyCustomUiWorkerCleanupResult =
  | { status: 'unsupported' }
  | { status: 'clean'; matchedCount: 0 }
  | { status: 'retired'; matchedCount: number }
  | { status: 'failed'; code: CleanupFailureCode; scopes: string[] };

type RegistrationsSnapshot =
  | { status: 'available'; registrations: readonly ServiceWorkerRegistration[] }
  | { status: 'failed' };

type UnregistrationAttempt = {
  scope: string;
  status: 'accepted' | 'already_absent' | 'rejected';
};

function decodeUnreservedPathCharacters(pathname: string): string {
  return pathname.replace(/%([0-9a-f]{2})/gi, (encodedCharacter, hexByte) => {
    const decodedCharacter = String.fromCharCode(Number.parseInt(hexByte, 16));
    return /^[a-z0-9._~-]$/i.test(decodedCharacter)
      ? decodedCharacter
      : encodedCharacter;
  });
}

function isPathWithinLegacyCustomUiTree(pathname: string): boolean {
  const canonicalPathname = decodeUnreservedPathCharacters(pathname);
  return LEGACY_CUSTOM_UI_SCOPE_BASE_PATHS.some(
    (basePath) => canonicalPathname === basePath
      || canonicalPathname.startsWith(`${basePath}/`),
  );
}

export function isLegacyCustomUiServiceWorkerScope(
  scope: string,
  trustedOrigin: string,
): boolean {
  const scopeUrl = new URL(scope);
  const canonicalTrustedOrigin = new URL(trustedOrigin).origin;
  return scopeUrl.origin === canonicalTrustedOrigin
    && isPathWithinLegacyCustomUiTree(scopeUrl.pathname);
}

async function registrationsSnapshot(
  serviceWorkers: ServiceWorkerContainer,
): Promise<RegistrationsSnapshot> {
  try {
    return {
      status: 'available',
      registrations: await serviceWorkers.getRegistrations(),
    };
  } catch {
    return { status: 'failed' };
  }
}

function legacyRegistrations(
  registrations: readonly ServiceWorkerRegistration[],
  trustedOrigin: string,
): ServiceWorkerRegistration[] {
  return registrations.filter((registration) =>
    isLegacyCustomUiServiceWorkerScope(registration.scope, trustedOrigin));
}

async function unregisterLegacyRegistration(
  registration: ServiceWorkerRegistration,
): Promise<UnregistrationAttempt> {
  try {
    return {
      scope: registration.scope,
      status: await registration.unregister() ? 'accepted' : 'already_absent',
    };
  } catch {
    return { scope: registration.scope, status: 'rejected' };
  }
}

async function verifyLegacyRegistrationsRetired(
  serviceWorkers: ServiceWorkerContainer,
  trustedOrigin: string,
  matchedCount: number,
): Promise<LegacyCustomUiWorkerCleanupResult> {
  const authority = await registrationsSnapshot(serviceWorkers);
  if (authority.status === 'failed') {
    return cleanupFailure('authority_readback_failed');
  }
  const persistedRegistrations = legacyRegistrations(
    authority.registrations,
    trustedOrigin,
  );
  if (persistedRegistrations.length > 0) {
    return cleanupFailure(
      'target_registration_persisted',
      persistedRegistrations.map((registration) => registration.scope),
    );
  }
  return { status: 'retired', matchedCount };
}

function cleanupFailure(
  code: CleanupFailureCode,
  scopes: string[] = [],
): LegacyCustomUiWorkerCleanupResult {
  return { status: 'failed', code, scopes };
}

export async function retireLegacyCustomUiServiceWorkers(
  serviceWorkers: ServiceWorkerContainer | undefined,
  trustedOrigin: string,
): Promise<LegacyCustomUiWorkerCleanupResult> {
  if (!serviceWorkers) return { status: 'unsupported' };
  const discovered = await registrationsSnapshot(serviceWorkers);
  if (discovered.status === 'failed') {
    return cleanupFailure('registration_enumeration_failed');
  }
  const targetRegistrations = legacyRegistrations(
    discovered.registrations,
    trustedOrigin,
  );
  if (targetRegistrations.length === 0) return { status: 'clean', matchedCount: 0 };
  const unregistrationAttempts = await Promise.all(
    targetRegistrations.map(unregisterLegacyRegistration),
  );
  const rejectedScopes = unregistrationAttempts
    .filter((attempt) => attempt.status === 'rejected')
    .map((attempt) => attempt.scope);
  if (rejectedScopes.length > 0) {
    return cleanupFailure('registration_unregistration_failed', rejectedScopes);
  }
  return verifyLegacyRegistrationsRetired(
    serviceWorkers,
    trustedOrigin,
    targetRegistrations.length,
  );
}
