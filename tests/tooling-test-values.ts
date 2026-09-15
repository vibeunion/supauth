export function requireError(value: unknown): Error {
  if (!(value instanceof Error)) throw new Error('Expected an Error');
  return value;
}

export function aggregateErrors(value: unknown): Error[] {
  if (!(value instanceof AggregateError)) throw new Error('Expected an AggregateError');
  const errors: unknown[] = value.errors;
  return errors.map(requireError);
}

export function createFetchMock(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(handler, { preconnect: fetch.preconnect });
}
