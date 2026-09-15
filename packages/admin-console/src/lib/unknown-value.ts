export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUnknownFunction(value: unknown): value is (...arguments_: unknown[]) => unknown {
  return typeof value === 'function';
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
