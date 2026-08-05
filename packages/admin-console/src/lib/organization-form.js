const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function organizationSlugIssue(slug) {
  if (!slug) return "required";
  if (slug.length < 2 || slug.length > 120) return "length";
  return ORGANIZATION_SLUG_PATTERN.test(slug) ? null : "format";
}

export function organizationDraft(form) {
  return {
    name: form.name.trim(),
    slug: form.slug.trim(),
    description: form.description,
  };
}
