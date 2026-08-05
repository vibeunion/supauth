import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const quickstartSource = readFileSync(
  new URL("../routes/get-started/+page.svelte", import.meta.url),
  "utf8",
);

describe("framework quickstart snippets", () => {
  test("shows static integration guidance independently from onboarding reads", () => {
    const onboardingStart = quickstartSource.indexOf("{#if loading}");
    const staticGuidanceStart = quickstartSource.indexOf(
      '<div class="mt-6 rounded-xl border border-brand-200',
    );
    const quickstartSection = quickstartSource.indexOf('<section class="mt-8">');
    const onboardingBlock = quickstartSource.slice(onboardingStart, staticGuidanceStart);

    expect(onboardingStart).toBeGreaterThan(0);
    expect(staticGuidanceStart).toBeGreaterThan(onboardingStart);
    expect(onboardingBlock.trimEnd().endsWith("{/if}")).toBe(true);
    expect(quickstartSection).toBeGreaterThan(staticGuidanceStart);
  });

  test("includes framework environment imports and lifecycle cleanup", () => {
    expect(quickstartSource).toContain("$env/static/public");
    expect(quickstartSource).toContain("onMount(async () => {");
    expect(quickstartSource).not.toContain("export const supabase = createClient");
    expect(quickstartSource).toContain("export function AuthState()");
    expect(quickstartSource).toContain("useState(null)");
    expect(quickstartSource).toContain("subscription.unsubscribe()");
    expect(quickstartSource).toContain("NEXT_PUBLIC_SUPABASE_URL!");
  });
});
