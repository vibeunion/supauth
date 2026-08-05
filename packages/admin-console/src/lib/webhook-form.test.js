import { describe, expect, test } from "bun:test";
import {
  normalizedWebhookSelection,
  webhookEventChoices,
} from "./webhook-form.js";

describe("webhook event selection", () => {
  test("accepts unique supported events in the selected order", () => {
    expect(normalizedWebhookSelection(
      ["organization.created", "user.updated"],
      ["user.updated", "organization.created"],
    )).toEqual(["organization.created", "user.updated"]);
    expect(normalizedWebhookSelection(["*"], ["*", "user.updated"]))
      .toEqual(["*"]);
  });

  test("rejects empty, duplicate, unknown, and malformed selections", () => {
    const supported = ["user.created", "user.updated"];
    for (const selected of [
      [],
      ["user.created", "user.created"],
      ["user.deleted"],
      ["user.created", null],
    ]) expect(normalizedWebhookSelection(selected, supported)).toBeNull();
  });

  test("keeps exactly one selectable wildcard before catalog events", () => {
    expect(webhookEventChoices([
      { type: "user.created", guarantee: "post_mutation" },
      { type: "*" },
      { type: "user.created", guarantee: "post_mutation" },
    ], [])).toEqual([
      { type: "*" },
      { type: "user.created", guarantee: "post_mutation" },
    ]);
    expect(webhookEventChoices([], ["user.updated", "*"]))
      .toEqual([{ type: "*" }, { type: "user.updated" }]);
  });
});
