import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const diagnosticsPage = readFileSync(
  new URL("./components/DiagnosticsPage.svelte", import.meta.url),
  "utf8",
);

describe("diagnostics provisioning failures", () => {
  test("renders structured failure classification and persistence state", () => {
    expect(diagnosticsPage).toContain("provisioningFailureLabel(result)");
    expect(diagnosticsPage).toContain("result?.details?.migration");
    expect(diagnosticsPage).toContain("result?.details?.state_persistence === 'unavailable'");
    expect(diagnosticsPage).not.toContain("{result.details.error}");
  });
});
