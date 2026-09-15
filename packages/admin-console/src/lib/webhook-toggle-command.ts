import { adminEndpoints, decodeSchema, type AdminEndpointResult } from "@supauth/shared";
import { executeAuthoritativeCommand } from "./authoritative-command.js";
import { completeCollectionItems } from "./resource-page.js";

function decodeToggleInput(value: unknown) {
  const input = decodeSchema(adminEndpoints.updateWebhook.input, value);
  const id = input.params.webhookId;
  const expectedEnabled = input.body.enabled;
  if (!id.trim() || typeof expectedEnabled !== "boolean") {
    throw new Error("Invalid webhook toggle target");
  }
  return { id, expectedEnabled };
}

function decodeWebhookAuthority(value: unknown) {
  const response = decodeSchema(adminEndpoints.listWebhooks.result, value);
  const webhooks = completeCollectionItems<AdminEndpointResult<"listWebhooks">["items"][number]>(response);
  if ((response.page !== undefined && response.page !== 1)
    || (response.limit !== undefined && response.limit < webhooks.length)) {
    throw new Error("Webhook authority requires a complete first page");
  }
  const identities = new Set<string>();
  for (const webhook of webhooks) {
    if (!webhook.id.trim() || identities.has(webhook.id)) {
      throw new Error("Webhook authority requires unique nonempty identities");
    }
    identities.add(webhook.id);
  }
  return webhooks;
}

export function toggleWebhookCommand(
  value: unknown,
  transport: {
    write(input: ReturnType<typeof decodeToggleInput>): Promise<unknown>;
    read(): Promise<unknown>;
  },
) {
  return executeAuthoritativeCommand(value, {
    input: decodeToggleInput,
    acknowledgement: (response) => decodeSchema(adminEndpoints.updateWebhook.result, response),
    authority: decodeWebhookAuthority,
    matches: (input, webhooks) => webhooks.some(
      (webhook) => webhook.id === input.id && webhook.enabled === input.expectedEnabled,
    ),
    // PUT 之后的 audit 也可能拒绝；任何远端错误都必须尝试权威读回。
  }, transport);
}
