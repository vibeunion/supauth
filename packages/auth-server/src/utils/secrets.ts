const SENSITIVE_KEYS = new Set([
  'secret',
  'client_secret',
  'clientsecret',
  'private_key',
  'privatekey',
  'signing_key',
  'signingkey',
  'password',
  'api_key',
  'apikey',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
]);

export function withoutSecrets<T>(input: T): T {
  if (Array.isArray(input)) return input.map(withoutSecrets) as T;
  if (!input || typeof input !== 'object') return input;

  const sanitized: Record<string, unknown> = {};
  let secretConfigured = false;
  for (const [key, field] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      secretConfigured ||= field !== null && field !== undefined && field !== '';
      continue;
    }
    sanitized[key] = withoutSecrets(field);
  }
  if (secretConfigured) sanitized.secret_configured = true;
  return sanitized as T;
}

export function containsSecret(input: unknown): boolean {
  if (Array.isArray(input)) return input.some(containsSecret);
  if (!input || typeof input !== 'object') return false;
  return Object.entries(input as Record<string, unknown>).some(([key, field]) =>
    isSensitiveKey(key) || containsSecret(field),
  );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-\s]/g, '_').toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || normalized.endsWith('_secret') || normalized.endsWith('_private_key');
}
