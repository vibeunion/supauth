// @ts-check
import { describe, expect, test } from "bun:test";
import { AdminApiError } from "../admin-api.js";
import { settleWritesThenReadBack } from "../mutation-reconciliation.js";
import {
  readAccountCenterConfig,
  validateExternalDeleteAccountUrlDraft,
} from "./account-center-settings.js";

const INVALID_READ_BACK_MESSAGE =
  "Account Center read-back has an invalid tenant-config payload";

/** @param {Record<string, unknown>} rowOverrides */
function validTenantConfigRow(rowOverrides = {}) {
  return {
    configType: "account_center",
    key: "default",
    enabled: true,
    value: {},
    ...rowOverrides,
  };
}

/** @type {[string, unknown][]} */
const invalidEnvelopeCases = [
  ["2xx text", "accepted"],
  ["null", null],
  ["top-level array", []],
  ["missing items", {}],
  ["items is not an array", { items: "bad" }],
  ["null row", { items: [null] }],
  ["array row", { items: [[]] }],
  [
    "row without key",
    { items: [validTenantConfigRow({ key: undefined })] },
  ],
  [
    "row with invalid type",
    { items: [validTenantConfigRow({ configType: "profile_field" })] },
  ],
  [
    "row with invalid enabled",
    { items: [validTenantConfigRow({ enabled: "yes" })] },
  ],
  [
    "row with invalid value",
    { items: [validTenantConfigRow({ value: null })] },
  ],
  [
    "duplicate default rows",
    { items: [validTenantConfigRow(), validTenantConfigRow()] },
  ],
];

/** @type {[string, string, string, string | null][]} */
const acceptedDeleteUrlCases = [
  ["empty built-in flow", "", "production", null],
  [
    "production HTTPS",
    "https://example.test/account/delete",
    "production",
    "https://example.test/account/delete",
  ],
  [
    "development localhost",
    "http://localhost:3000/delete",
    "development",
    "http://localhost:3000/delete",
  ],
  [
    "test 127/8",
    "http://127.0.0.2/delete",
    "test",
    "http://127.0.0.2/delete",
  ],
  [
    "test IPv6 loopback",
    "http://[::1]:3000/delete",
    "test",
    "http://[::1]:3000/delete",
  ],
];

/** @type {[string, string, string][]} */
const rejectedDeleteUrlCases = [
  ["credentials", "https://user:secret@example.test/delete", "production"],
  ["fragment", "https://example.test/delete#confirm", "production"],
  ["relative URL", "/delete", "production"],
  ["protocol-relative URL", "//example.test/delete", "production"],
  ["external HTTP", "http://example.test/delete", "test"],
  ["production loopback HTTP", "http://localhost/delete", "production"],
  ["integer IPv4 disguise", "http://2130706433/delete", "test"],
  ["octal IPv4 disguise", "http://0177.0.0.1/delete", "test"],
  ["short IPv4 disguise", "http://127.1/delete", "test"],
  ["localhost suffix", "http://localhost.evil.test/delete", "test"],
  ["expanded IPv6 disguise", "http://[0:0:0:0:0:0:0:1]/delete", "test"],
];

describe("Account Center read-back contract", () => {
  test.each(acceptedDeleteUrlCases)(
    "accepts delete URL draft boundary: %s",
    (_caseName, urlInput, mode, expectedUrl) => {
      expect(validateExternalDeleteAccountUrlDraft(urlInput, mode)).toEqual({
        ok: true,
        url: expectedUrl,
      });
    },
  );

  test.each(rejectedDeleteUrlCases)(
    "rejects delete URL draft boundary: %s",
    (_caseName, urlInput, mode) => {
      expect(validateExternalDeleteAccountUrlDraft(urlInput, mode)).toEqual({
        ok: false,
      });
    },
  );

  test("accepts an empty strict collection envelope", async () => {
    /** @type {string[]} */
    const requestedTypes = [];
    const config = await readAccountCenterConfig(async (configType) => {
      requestedTypes.push(configType);
      return { items: [] };
    });

    expect(requestedTypes).toEqual(["account_center"]);
    expect(config).toBeNull();
  });

  test("returns the validated default row", async () => {
    /** @satisfies {import("./account-center-settings.js").AccountCenterRow} */
    const defaultRow = {
      configType: "account_center",
      key: "default",
      enabled: false,
      value: { security: { password_change: false } },
    };

    const config = await readAccountCenterConfig(async () => ({
        items: [validTenantConfigRow({ key: "other" }), defaultRow],
      }));
    expect(config).toEqual(defaultRow);
  });

  test.each(invalidEnvelopeCases)(
    "rejects %s before a form can be normalized",
    async (_caseName, payload) => {
      await expect(
        readAccountCenterConfig(async () => payload),
      ).rejects.toThrow(INVALID_READ_BACK_MESSAGE);
    },
  );

  test.each(invalidEnvelopeCases)(
    "maps %s to readback_failure after a successful write",
    async (_caseName, payload) => {
      const reconciliation = await settleWritesThenReadBack(
        [async () => "write applied"],
        () => readAccountCenterConfig(async () => payload),
      );

      expect(reconciliation.status).toBe("readback_failure");
      if (reconciliation.status !== "readback_failure") throw new Error("Expected readback failure");
      expect(reconciliation.writeStatus).toBe("success");
      if (!(reconciliation.readBackError instanceof Error)) throw new Error("Expected Error");
      expect(reconciliation.readBackError.message).toBe(
        INVALID_READ_BACK_MESSAGE,
      );
    },
  );

  test.each([
    ["network", new TypeError("upstream host should stay internal")],
    [
      "HTTP",
      new AdminApiError("upstream body should stay internal", 502, "upstream"),
    ],
  ])(
    "keeps a rejected %s request as readback_failure",
    async (_caseName, requestFailure) => {
      const reconciliation = await settleWritesThenReadBack(
        [async () => "write applied"],
        () =>
          readAccountCenterConfig(async () => Promise.reject(requestFailure)),
      );

      expect(reconciliation.status).toBe("readback_failure");
      if (reconciliation.status !== "readback_failure") throw new Error("Expected readback failure");
      expect(reconciliation.readBackError).toBe(requestFailure);
    },
  );
});
