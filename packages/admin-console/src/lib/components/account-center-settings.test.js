// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { AdminApiError } from "../admin-api.js";
import { settleWritesThenReadBack } from "../mutation-reconciliation.js";
import {
  readAccountCenterConfig,
  validateExternalDeleteAccountUrlDraft,
} from "./account-center-settings.js";

const INVALID_READ_BACK_MESSAGE =
  "Account Center read-back has an invalid tenant-config payload";

function validTenantConfigRow(rowOverrides = {}) {
  return {
    configType: "account_center",
    key: "default",
    enabled: true,
    value: {},
    ...rowOverrides,
  };
}

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
    let requestedType;
    const config = await readAccountCenterConfig(async (configType) => {
      requestedType = configType;
      return { items: [] };
    });

    expect(requestedType).toBe("account_center");
    expect(config).toBeNull();
  });

  test("returns the validated default row", async () => {
    const defaultRow = validTenantConfigRow({
      enabled: false,
      value: { security: { password_change: false } },
    });

    await expect(
      readAccountCenterConfig(async () => ({
        items: [validTenantConfigRow({ key: "other" }), defaultRow],
      })),
    ).resolves.toEqual(defaultRow);
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
      expect(reconciliation.writeStatus).toBe("success");
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
      expect(reconciliation.readBackError).toBe(requestFailure);
    },
  );
});
