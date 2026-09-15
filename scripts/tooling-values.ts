export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireRecord(value: unknown, label = 'value'): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function requireArray(value: unknown, label = 'value'): unknown[] {
  if (!isUnknownArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function requireRecordArray(value: unknown, label = 'value'): Record<string, unknown>[] {
  const items = requireArray(value, label);
  if (!items.every(isRecord)) throw new Error(`${label} must contain objects`);
  return items;
}

export function requireString(value: unknown, label = 'value'): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

export function requireNumber(value: unknown, label = 'value'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

export function requireDefined<T>(value: T | null | undefined, label = 'value'): T {
  if (value === undefined || value === null) throw new Error(`${label} is required`);
  return value;
}

export function parseJson(source: string): unknown {
  const value: unknown = JSON.parse(source);
  return value;
}

export function parseJsonRecord(source: string): Record<string, unknown> {
  return requireRecord(parseJson(source), 'JSON document');
}

export function positiveIntegerFromEnv(
  value: string | undefined,
  fallback: number,
  label: string,
  maximum = 2_147_483_647,
): number {
  const candidate = value === undefined ? String(fallback) : value;
  if (!/^[1-9]\d*$/.test(candidate)) throw new Error(`${label} must be a positive integer`);
  const result = Number(candidate);
  if (!Number.isSafeInteger(result) || result > maximum) {
    throw new Error(`${label} must not exceed ${maximum}`);
  }
  return result;
}
