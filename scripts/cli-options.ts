export function definedStringOptions<Key extends string>(
  options: Record<Key, string | undefined>,
): Partial<Record<Key, string>> {
  const result: Partial<Record<Key, string>> = {};
  for (const key in options) {
    if (!Object.hasOwn(options, key)) continue;
    const value = options[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
