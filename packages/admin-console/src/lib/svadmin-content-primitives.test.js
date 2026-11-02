import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** @param {string} path */
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("SVAdmin content primitives", () => {
  test("RequestState keeps one shared loading, empty and error surface", () => {
    const requestState = source("./components/RequestState.svelte");
    expect(requestState).toContain("@svadmin/ui/components/content/DataState.svelte");
    expect(requestState).toContain("<DataState");
    expect(requestState).not.toContain('role="alert"');
  });

  test("dashboard and capability views use shared metric, panel and status primitives", () => {
    const dashboard = source("../routes/dashboard/+page.svelte");
    expect(dashboard).toContain("ContentPageHeader");
    expect(dashboard).toContain("DataPanel");
    expect(dashboard).toContain("MetricBlock");
    const capability = source("./components/CapabilityStatus.svelte");
    expect(capability).toContain("DescriptionList");
    expect(capability).toContain("StatusBadge");
  });

  test("application-level failures use the shared error surface", () => {
    const errorPage = source("../routes/+error.svelte");
    expect(errorPage).toContain("SystemErrorState");
  });
});
