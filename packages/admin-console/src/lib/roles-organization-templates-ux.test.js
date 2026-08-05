import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const rolesPage = readFileSync(
  new URL("../routes/roles/+page.svelte", import.meta.url),
  "utf8",
);
const organizationTemplatesPage = readFileSync(
  new URL("./components/OrganizationTemplatePage.svelte", import.meta.url),
  "utf8",
);

describe("Roles and organization templates UX", () => {
  test("keeps role assignment controls responsive and localizes identifiers", () => {
    expect(rolesPage).toContain('class="mt-4 grid gap-4 border-0 p-0 md:grid-cols-2"');
    expect(rolesPage).toContain('t("roles.userIdPlaceholder")');
    expect(rolesPage).toContain('t("roles.applicationIdPlaceholder")');
    expect(rolesPage).toContain('t("roles.organizationIdPlaceholder")');
    expect(rolesPage).not.toContain('placeholder="organization uuid"');
    expect(rolesPage).not.toContain('placeholder="role assignment id"');
  });

  test("renders assignment read failures through the shared request state", () => {
    expect(rolesPage).toContain("assignments = collectionPage(assignmentResponse).items");
    expect(rolesPage).toContain("assignmentError = requestError");
    expect(rolesPage).toContain("error={assignmentError}");
    expect(rolesPage).not.toMatch(/>\s*\{assignmentError\}\s*</);
  });

  test("marks role template status and risk with honest action labels", () => {
    expect(rolesPage).toContain('riskLevel: "high"');
    expect(rolesPage).toContain('t("roles.templateStatusCreated")');
    expect(rolesPage).toContain('t("roles.createFromTemplate")');
    expect(rolesPage).toContain('t("roles.viewTemplateRole")');
  });

  test("places role search inside the role-list container", () => {
    const listContainer = rolesPage.indexOf(
      'class="overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-sm"',
    );
    const searchField = rolesPage.indexOf('id="role-search"', listContainer);
    const roleList = rolesPage.indexOf("{#each filteredRoles", searchField);
    const containerEnd = rolesPage.indexOf("</aside>", roleList);

    expect(listContainer).toBeGreaterThanOrEqual(0);
    expect(searchField).toBeGreaterThan(listContainer);
    expect(roleList).toBeGreaterThan(searchField);
    expect(containerEnd).toBeGreaterThan(roleList);
  });

  test("protects default templates and exposes localized details", () => {
    expect(organizationTemplatesPage).toContain("if (isDefaultTemplate(template))");
    expect(organizationTemplatesPage).toContain("orgTemplates.deleteProtected");
    expect(organizationTemplatesPage).toContain("{#if defaultTemplate}");
    expect(organizationTemplatesPage).toContain("toggleDetails(template.id)");
    expect(organizationTemplatesPage).toContain("orgTemplates.defaultDescription");
    expect(organizationTemplatesPage).toContain("orgTemplates.scopes");
    expect(organizationTemplatesPage).toContain("response.items.every(validOrganizationTemplate)");
    expect(organizationTemplatesPage).not.toContain("response.items || []");
    expect(organizationTemplatesPage).toContain("!templateRoles.every(validTemplateRole)");
    expect(organizationTemplatesPage).toContain("!templateScopes.every(validTemplateScope)");
    expect(organizationTemplatesPage).toContain('t("orgTemplates.invalidInput")');
  });

  test("rejects overlong names and blank permissions before template creation", () => {
    expect(organizationTemplatesPage).toContain(
      "const ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH = 255;",
    );
    expect(organizationTemplatesPage).toContain(
      "maxlength={ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH}",
    );
    expect(organizationTemplatesPage).toContain(
      "name.length > ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH",
    );
    expect(organizationTemplatesPage).toContain(
      'typeof permission === "string" && permission.trim().length > 0',
    );
  });
});
