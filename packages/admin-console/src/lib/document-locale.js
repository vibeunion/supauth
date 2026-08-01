function normalizeLocale(locale) {
  if (!locale) return null;
  const normalized = locale.replace("_", "-").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

export function resolveDocumentLocale(candidates) {
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return "en";
}

export function syncDocumentLocale(documentElement, locale) {
  if (documentElement) documentElement.lang = locale;
}
