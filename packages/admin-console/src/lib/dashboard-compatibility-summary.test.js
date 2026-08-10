import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const dashboardPage = readFileSync(
  new URL("../routes/dashboard/+page.svelte", import.meta.url),
  "utf8",
);

describe("dashboard compatibility summary", () => {
  test("links to the authoritative localized compatibility details", () => {
    expect(dashboardPage).toContain('resolve("/customize-jwt")');
    expect(dashboardPage).toContain("dashboard.viewCompatibilityDetails");
    expect(dashboardPage).not.toContain("{check.message}");
  });
});
