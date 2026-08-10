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
});
