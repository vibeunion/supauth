import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const webhookPage = readFileSync(
  new URL("../routes/webhooks/+page.svelte", import.meta.url),
  "utf8",
);

describe("webhook replay lock rendering", () => {
  test("does not validate a replay lock descriptor before a delivery exists", () => {
    expect(webhookPage).toContain("function replayLastLocked(whId)");
    expect(webhookPage).toContain(
      'return resourceId ? webhookMutationLocked("replay", resourceId) : false;',
    );
    expect(webhookPage).toContain("replayLastLocked(wh.id)");
  });

  test("renders list failures through the localized request state", () => {
    expect(webhookPage).toContain(
      'import RequestState from "$lib/components/RequestState.svelte";',
    );
    expect(webhookPage).toContain("let loadError = $state(null);");
    expect(webhookPage).toContain("loadError = requestError;");
    expect(webhookPage).not.toContain("loadError = requestError.message;");
    expect(webhookPage).toContain("error={loadError}");
    expect(webhookPage).toContain("onRetry={load}");
  });
});
