// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GOTRUE_OAUTH_GRANT_TYPES,
  supportedOAuthGrantTypes,
} from "./oauth-grant-types.js";

describe("GoTrue OAuth client grant controls", () => {
  test("offers exactly the stock GoTrue grant type allowlist", () => {
    expect(GOTRUE_OAUTH_GRANT_TYPES).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(
      supportedOAuthGrantTypes([
        "authorization_code",
        "urn:ietf:params:oauth:grant-type:token-exchange",
        "token-exchange",
        "client_credentials",
        "refresh_token",
      ]),
    ).toEqual(["authorization_code", "refresh_token"]);
  });

  test("keeps application forms controlled and removes the unsupported M2M grant", () => {
    const createPage = readFileSync(
      "src/routes/applications/+page.svelte",
      "utf8",
    );
    const detailPage = readFileSync(
      "src/routes/applications/[appId]/+page.svelte",
      "utf8",
    );

    expect(createPage).not.toContain("client_credentials");
    expect(createPage).not.toContain('value="m2m"');
    expect(detailPage).toContain(
      "bind:group={applicationForm.grant_types}",
    );
    expect(detailPage).not.toContain(
      "bind:value={applicationForm.grant_types}",
    );
    expect(detailPage).not.toContain("Grant Types (comma-separated)");
  });
});
