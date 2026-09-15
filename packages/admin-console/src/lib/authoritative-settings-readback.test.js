import { readFile } from 'node:fs/promises';
// @ts-check
import { describe, expect, test } from "bun:test";
import {
  accountCenterSettingsAuthority,
  assertAuthoritativeSettingsReadBack,
  blocklistSettingsAuthority,
  brandingSettingsAuthority,
  canonicalOrderedStrings,
  canonicalStringSet,
  canonicalTrimmedStringSet,
  captchaSettingsAuthority,
  generalSecuritySettingsAuthority,
  organizationSettingsAuthority,
  passwordPolicySettingsAuthority,
  settleAuthoritativeSettingsMutation,
  signInMethodsSettingsAuthority,
  AuthoritativeSettingsReadBackError,
  freezeSettingsDraft,
} from "./authoritative-settings-readback.js";

/** @template {object} [Overrides={}] @param {Overrides} [overrides] */
function accountCenterConfig(overrides) {
  return fixtureWithOverrides({
    enabled: true,
    value: {
      enabled: true,
      profile: { edit_mode: "editable", fields: ["name", "email"] },
      security: {
        password_change: true,
        mfa: true,
        email_change: false,
        phone_change: false,
      },
      grants: { enabled: true },
      identities: { enabled: false },
      delete_account: {
        enabled: true,
        url: "https://example.test/account/delete",
      },
      delete_account_url: "https://example.test/account/delete",
    },
  }, overrides);
}

/** @template {object} [Overrides={}] @param {Overrides} [overrides] */
function signInSnapshot(overrides) {
  return fixtureWithOverrides({
    signInExperience: {
      sign_in_methods: ["password", "magic_link"],
      sign_up_enabled: true,
    },
    authConfig: { enable_signup: true, disable_signup: false },
  }, overrides);
}

/** @template {object} [Overrides={}] @param {Overrides} [overrides] */
function brandingSnapshot(overrides) {
  return {
    branding: fixtureWithOverrides({
      page_title: "Example",
      primary_color: "#2563eb",
      background_url: "https://example.test/background.png",
    }, overrides),
  };
}

/** @template {object} [Overrides={}] @param {Overrides} [overrides] */
function captchaConfig(overrides) {
  return fixtureWithOverrides({
    enabled: true,
    value: {
      provider: "hcaptcha",
      secret_configured: true,
    },
  }, overrides);
}

/** @template {object} [Overrides={}] @param {Overrides} [overrides] */
function blocklistConfig(overrides) {
  return fixtureWithOverrides({
    enabled: true,
    value: {
      allowed_email_domains: ["example.test", "staff.example.test"],
      blocked_email_domains: ["blocked.example.test"],
      blocked_oauth_providers: ["github"],
      allowed_oauth_providers: ["google", "azure"],
      invite_only: true,
    },
  }, overrides);
}

/** @template {object} [Overrides={}] @param {Overrides} [overrides] */
function generalSecuritySnapshot(overrides) {
  return fixtureWithOverrides({
    authConfig: {
      jwt_expiry: 3600,
      enable_confirmations: true,
      external_anonymous_users_enabled: false,
    },
    securityConfig: {
      bruteForceProtection: true,
      maxLoginAttempts: 8,
      lockoutDurationSec: 900,
    },
  }, overrides);
}

/** @template {object} [Overrides={}] @param {Overrides} [overrides] */
function organizationSnapshot(overrides) {
  return fixtureWithOverrides({
    organizationResponse: {
      id: "org-one",
      name: "Example Org",
      description: "Example description",
    },
    jitEnabled: true,
    jitResponse: {
      enabled: true,
      domains: ["example.test", "staff.example.test"],
    },
  }, overrides);
}

/** @template {object} Base @template {object} Overrides @overload @param {Base} base @param {Overrides | undefined} overrides @returns {Omit<Base, keyof Overrides> & Overrides} */
/** @param {object} base @param {object | undefined} overrides */
function fixtureWithOverrides(base, overrides) {
  return { ...base, ...overrides };
}

/**
 * @template Command, Authority
 * @param {import("./authoritative-settings-readback.js").SettingsMutationDraft<Command, Authority> & {readSnapshot: () => unknown | PromiseLike<unknown>, writeCommands?: () => readonly import("./mutation-reconciliation.js").WriteCommand[]}} options
 */
async function reconcile({ command, authority, readSnapshot, writeCommands }) {
  return settleAuthoritativeSettingsMutation({
    draft: { command, authority },
    writeCommands: writeCommands || (() => [async () => ({ status: 200 })]),
    readSnapshot,
    authorityFromSnapshot: (snapshot) => snapshot,
  });
}

/** @param {import("./mutation-reconciliation.js").MutationReconciliation<unknown>} reconciliation @param {string} expectedField @returns {asserts reconciliation is {status: "readback_failure", writeStatus: import("./mutation-reconciliation.js").WriteStatus, writeErrors: unknown[], readBackError: AuthoritativeSettingsReadBackError}} */
function expectMismatch(reconciliation, expectedField) {
  expect(reconciliation.status).toBe("readback_failure");
  if (reconciliation.status !== "readback_failure") throw new Error("Expected readback failure");
  if (!(reconciliation.readBackError instanceof AuthoritativeSettingsReadBackError)) {
    throw new Error("Expected authoritative mismatch");
  }
  expect(reconciliation.readBackError.code).toBe(
    "authoritative_readback_mismatch",
  );
  expect(reconciliation.readBackError.fields).toContain(expectedField);
}

describe("authoritative settings read-back", () => {
  test("rejects sparse string arrays instead of claiming a dense string result", () => {
    /** @type {unknown[]} */
    const hole = Array(1);
    /** @type {unknown[]} */
    const trailingHole = ["password"];
    trailingHole.length = 2;
    /** @type {unknown[]} */
    const inheritedIndex = Array(1);
    Object.setPrototypeOf(inheritedIndex, { 0: "password" });
    let getters = 0;
    /** @type {unknown[]} */
    const accessorIndex = Object.defineProperty([], "0", {
      enumerable: true,
      get() { getters += 1; return "password"; },
    });
    for (const canonicalize of [
      canonicalOrderedStrings, canonicalStringSet, canonicalTrimmedStringSet,
    ]) {
      for (const input of [hole, trailingHole, inheritedIndex, accessorIndex]) {
        expect(() => canonicalize(input, "methods")).toThrow(
          expect.objectContaining({ fields: ["methods"] }),
        );
      }
    }
    expect(canonicalOrderedStrings([" password ", "password"], "methods")).toEqual(["password", "password"]);
    expect(canonicalStringSet([" password ", "password"], "methods").map(value => value.trim())).toEqual(["password", "password"]);
    expect(canonicalTrimmedStringSet([" password ", "password"], "methods")).toEqual(["password"]);
    expect(getters).toBe(0);
  });

  test("rejects prototype fields, accessors and hidden data without invoking getters", () => {
    let getters = 0;
    class GetterAuthority {
      get enabled() { getters += 1; return true; }
    }
    class DataAuthority { enabled = true; }
    const hidden = Object.defineProperty({}, "enabled", { value: true });
    const accessor = {
      get enabled() { getters += 1; return true; },
    };
    /** @type {unknown[]} */
    const invalidAuthorities = [
      new GetterAuthority(), new DataAuthority(),
      Object.create({ enabled: true }), hidden, accessor,
      { [Symbol("enabled")]: true }, new Date(), new Map(), new Set(),
    ];
    for (const value of invalidAuthorities) {
      /** @type {unknown} */
      const untrusted = { authority: value };
      expect(() => freezeSettingsDraft(untrusted)).toThrow("draft.authority");
    }
    expect(getters).toBe(0);
  });

  test("rejects sparse and decorated draft arrays and cycles", () => {
    /** @type {unknown[]} */
    const sparse = Array(1);
    const decorated = Object.assign(["password"], { enabled: true });
    /** @type {unknown[]} */
    const accessor = Object.defineProperty([], "0", {
      enumerable: true,
      get() { throw new Error("must not run"); },
    });
    /** @type {{self?: unknown}} */
    const cycle = {};
    cycle.self = cycle;
    for (const value of [sparse, decorated, accessor, cycle]) {
      /** @type {unknown} */
      const untrusted = value;
      expect(() => freezeSettingsDraft(untrusted)).toThrow("Settings draft contains an unsupported value");
    }
    const shared = { enabled: true };
    expect(freezeSettingsDraft({ first: shared, second: shared })).toEqual({
      first: { enabled: true }, second: { enabled: true },
    });
  });

  test("rejects an inherited authority before writes or a false-positive read-back", async () => {
    let writes = 0;
    let reads = 0;
    class GetterAuthority {
      get enabled() { return true; }
    }
    await expect(settleAuthoritativeSettingsMutation({
      draft: { command: { enabled: true }, authority: new GetterAuthority() },
      writeCommands: () => {
        writes += 1;
        return [() => { throw new Error("must not write"); }];
      },
      readSnapshot: () => {
        reads += 1;
        return { enabled: false };
      },
      authorityFromSnapshot: snapshot => snapshot,
    })).rejects.toThrow("draft.authority");
    expect(writes).toBe(0);
    expect(reads).toBe(0);
  });

  test("rejects unsupported draft data before invoking any write or read", async () => {
    for (const invalid of [undefined, Number.NaN, Infinity, 1n, () => true]) {
      /** @type {unknown} */
      const untrustedDraft = { invalid };
      expect(() => freezeSettingsDraft(untrustedDraft)).toThrow("draft.invalid");
    }
    let writes = 0;
    let reads = 0;
    await expect(settleAuthoritativeSettingsMutation({
      draft: { command: { retryCount: Number.NaN }, authority: { enabled: true } },
      writeCommands: () => {
        writes += 1;
        return [];
      },
      readSnapshot: () => {
        reads += 1;
        return { enabled: true };
      },
      authorityFromSnapshot: (snapshot) => snapshot,
    })).rejects.toThrow("draft.command.retryCount");
    expect(writes).toBe(0);
    expect(reads).toBe(0);
  });

  test("rejects conflicting runtime aliases and preserves missing fields as undefined", () => {
    expect(() => generalSecuritySettingsAuthority({
      authConfig: {},
      securityConfig: { maxLoginAttempts: 5, max_login_attempts: 6 },
    })).toThrow(expect.objectContaining({ fields: ["security.max_login_attempts"] }));
    expect(generalSecuritySettingsAuthority({
      authConfig: {},
      securityConfig: {},
    }).max_login_attempts).toBeUndefined();
  });

  test("freezes a detached command and authority before the write starts", async () => {
    const form = {
      enabled: true,
      methods: ["password", "magic_link"],
    };
    /** @type {import("./authoritative-settings-readback.js").DeepReadonly<typeof form> | undefined} */
    let receivedCommand;
    const mutation = settleAuthoritativeSettingsMutation({
      draft: {
        command: form,
        authority: { enabled: form.enabled, methods: form.methods },
      },
      writeCommands: (command) => {
        receivedCommand = command;
        return [async () => ({ status: 200 })];
      },
      readSnapshot: async () => ({
        enabled: true,
        methods: ["password", "magic_link"],
      }),
      authorityFromSnapshot: (snapshot) => snapshot,
    });

    form.enabled = false;
    form.methods.splice(0, form.methods.length, "phone_otp");
    const reconciliation = await mutation;

    expect(reconciliation.status).toBe("success");
    expect(receivedCommand).toEqual({
      enabled: true,
      methods: ["password", "magic_link"],
    });
    expect(Object.isFrozen(receivedCommand)).toBe(true);
    if (!receivedCommand) throw new Error("Expected command");
    expect(Object.isFrozen(receivedCommand.methods)).toBe(true);
  });

  test("reports every missing, wrong-type, and mismatched managed field", () => {
    expect(() =>
      assertAuthoritativeSettingsReadBack(
        {
          enabled: true,
          policy: { retries: 3, methods: ["password"] },
          nullable_url: null,
        },
        {
          enabled: "true",
          policy: { methods: [] },
          nullable_url: "",
        },
      ),
    ).toThrow(
      expect.objectContaining({
        fields: [
          "enabled",
          "policy.retries",
          "policy.methods",
          "nullable_url",
        ],
      }),
    );
  });

  test("normalizes only the product-defined ordered and set representations", () => {
    expect(
      canonicalOrderedStrings(
        [" name ", "", "email", "name"],
        "profile.fields",
      ),
    ).toEqual(["name", "email", "name"]);
    expect(
      canonicalStringSet(
        ["password", "magic_link", "password"],
        "sign_in_methods",
      ),
    ).toEqual(["magic_link", "password"]);
    expect(
      canonicalTrimmedStringSet(
        [" staff.example.test ", "", "example.test", "example.test"],
        "domains",
      ),
    ).toEqual(["example.test", "staff.example.test"]);
  });

  test("keeps method, domain case, and trailing-dot changes observable", () => {
    expect(() =>
      assertAuthoritativeSettingsReadBack(
        { methods: ["password"], domains: ["example.test"] },
        { methods: ["Password"], domains: ["example.test."] },
      ),
    ).toThrow(
      expect.objectContaining({ fields: ["methods", "domains"] }),
    );
  });

  test("canonicalizes each complete settings field matrix", () => {
    const accountAuthority = accountCenterSettingsAuthority(
      accountCenterConfig({
        value: {
          ...accountCenterConfig().value,
          profile: { edit_mode: "editable", fields: [" name ", "email", ""] },
          delete_account: { enabled: false, url: " " },
          delete_account_url: "",
        },
      }),
    );
    expect(accountAuthority.profile.fields).toEqual(["name", "email"]);
    expect(accountAuthority.delete_account.url).toBeNull();
    expect(accountAuthority.delete_account_url).toBeNull();

    expect(
      signInMethodsSettingsAuthority(
        signInSnapshot({
          signInExperience: {
            sign_in_methods: ["magic_link", "password", "password"],
            sign_up_enabled: true,
          },
        }),
      ).sign_in_experience.sign_in_methods,
    ).toEqual(["magic_link", "password"]);
    expect(
      blocklistSettingsAuthority(
        blocklistConfig({
          value: {
            ...blocklistConfig().value,
            allowed_oauth_providers: [" azure ", "google", "azure"],
          },
        }),
      ).allowed_oauth_providers,
    ).toEqual(["azure", "google"]);
    expect(
      brandingSettingsAuthority(
        brandingSnapshot({ page_title: " Example ", background_url: " " }),
      ),
    ).toEqual({
      branding: {
        page_title: "Example",
        primary_color: "#2563eb",
        background_url: null,
      },
    });
    expect(
      organizationSettingsAuthority(
        organizationSnapshot({
          organizationResponse: {
            id: "org-one",
            name: " Example Org ",
            description: " Example description ",
          },
          jitResponse: {
            enabled: true,
            domains: [" staff.example.test ", "example.test"],
          },
        }),
      ),
    ).toEqual(organizationSettingsAuthority(organizationSnapshot()));
  });

  test("validates every managed branding field at the response boundary", () => {
    expect(
      brandingSettingsAuthority(
        brandingSnapshot({
          page_title: null,
          primary_color: " ",
          background_url: null,
        }),
      ),
    ).toEqual({
      branding: {
        page_title: null,
        primary_color: null,
        background_url: null,
      },
    });

    for (const fieldName of [
      "page_title",
      "primary_color",
      "background_url",
    ]) {
      expect(() =>
        brandingSettingsAuthority(
          brandingSnapshot({ [fieldName]: { unexpected: true } }),
        ),
      ).toThrow(
        expect.objectContaining({ fields: [`branding.${fieldName}`] }),
      );
    }

    const { page_title, ...remainingBranding } = brandingSnapshot().branding;
    const missingFieldSnapshot = { branding: remainingBranding };
    expect(() => brandingSettingsAuthority(missingFieldSnapshot)).toThrow(
      expect.objectContaining({ fields: ["branding.page_title"] }),
    );
  });

  test("keeps BrandingEditor draft failures inside the saving reset guard", async () => {
    const brandingEditorSource = await readFile(new URL(
        "./components/sign-in-experience/BrandingEditor.svelte",
        import.meta.url,
      ), 'utf8');
    const saveStart = brandingEditorSource.indexOf(
      "async function saveBranding()",
    );
    const saveEnd = brandingEditorSource.indexOf(
      "async function uploadBrandingFile",
      saveStart,
    );
    const saveSource = brandingEditorSource.slice(saveStart, saveEnd);

    expect(brandingEditorSource).toContain(
      "brandingSettingsAuthority(signInExperience).branding",
    );
    expect(saveSource).toMatch(
      /try \{\s+const mutationDraft = brandingMutationDraft\(\);/,
    );
    expect(saveSource).toMatch(/finally \{\s+saving = false;/);
  });

  test.each([
    [
      "Account Center",
      accountCenterSettingsAuthority(accountCenterConfig()),
      () => {
        const stale = accountCenterConfig();
        stale.value.security.mfa = false;
        return accountCenterSettingsAuthority(stale);
      },
      "security.mfa",
    ],
    [
      "Sign-in Methods",
      signInMethodsSettingsAuthority(signInSnapshot()),
      () =>
        signInMethodsSettingsAuthority(
          signInSnapshot({
            signInExperience: {
              sign_in_methods: ["password"],
              sign_up_enabled: true,
            },
          }),
        ),
      "sign_in_experience.sign_in_methods",
    ],
    [
      "Branding",
      brandingSettingsAuthority(brandingSnapshot()),
      () =>
        brandingSettingsAuthority(
          brandingSnapshot({ primary_color: "#000000" }),
        ),
      "branding.primary_color",
    ],
    [
      "Security",
      generalSecuritySettingsAuthority(generalSecuritySnapshot()),
      () =>
        generalSecuritySettingsAuthority(
          generalSecuritySnapshot({
            authConfig: {
              jwt_expiry: 7200,
              enable_confirmations: true,
              external_anonymous_users_enabled: false,
            },
          }),
        ),
      "jwt_expiry",
    ],
    [
      "Organization",
      organizationSettingsAuthority(organizationSnapshot()),
      () =>
        organizationSettingsAuthority(
          organizationSnapshot({
            organizationResponse: {
              id: "org-two",
              name: "Example Org",
              description: "Example description",
            },
          }),
        ),
      "resource_id",
    ],
  ])(
    "maps a 200 write with stale %s authority to readback_failure",
    async (_surface, expectedAuthority, staleAuthority, expectedField) => {
      let saved = false;
      const reconciliation = await reconcile({
        command: { managed: true },
        authority: expectedAuthority,
        readSnapshot: async () => staleAuthority(),
      });
      if (reconciliation.status === "success") saved = true;

      expectMismatch(reconciliation, expectedField);
      expect(saved).toBe(false);
    },
  );

  test.each([
    [
      "Account Center profile",
      accountCenterSettingsAuthority(accountCenterConfig()),
      () => {
        const original = accountCenterConfig();
        const { edit_mode, ...profile } = original.value.profile;
        const dropped = { ...original, value: { ...original.value, profile } };
        return accountCenterSettingsAuthority(dropped);
      },
      "profile.edit_mode",
    ],
    [
      "Sign-in GoTrue disable flag",
      signInMethodsSettingsAuthority(signInSnapshot()),
      () => {
        const original = signInSnapshot();
        const { disable_signup, ...authConfig } = original.authConfig;
        const dropped = { ...original, authConfig };
        return signInMethodsSettingsAuthority(dropped);
      },
      "gotrue.disable_signup",
    ],
    [
      "Security confirmation flag",
      generalSecuritySettingsAuthority(generalSecuritySnapshot()),
      () => {
        const original = generalSecuritySnapshot();
        const { enable_confirmations, ...authConfig } = original.authConfig;
        const dropped = { ...original, authConfig };
        return generalSecuritySettingsAuthority(dropped);
      },
      "enable_confirmations",
    ],
    [
      "Admin login lockout duration",
      generalSecuritySettingsAuthority(generalSecuritySnapshot()),
      () => {
        const original = generalSecuritySnapshot();
        const { lockoutDurationSec, ...securityConfig } = original.securityConfig;
        const dropped = { ...original, securityConfig };
        return generalSecuritySettingsAuthority(dropped);
      },
      "lockout_duration_sec",
    ],
    [
      "Organization description",
      organizationSettingsAuthority(organizationSnapshot()),
      () => {
        const original = organizationSnapshot();
        const { description, ...organizationResponse } = original.organizationResponse;
        const dropped = { ...original, organizationResponse };
        return organizationSettingsAuthority(dropped);
      },
      "organization.description",
    ],
  ])(
    "rejects a dropped %s field",
    async (_surface, expectedAuthority, droppedAuthority, expectedField) => {
      const reconciliation = await reconcile({
        command: { managed: true },
        authority: expectedAuthority,
        readSnapshot: async () => droppedAuthority(),
      });

      expectMismatch(reconciliation, expectedField);
    },
  );

  test("compares password policy numbers and the complete character policy", () => {
    const expected = passwordPolicySettingsAuthority({
      authConfig: {
        password_min_length: 12,
        password_required_characters: "lower:upper:number:symbol",
      },
    });
    expect(() =>
      assertAuthoritativeSettingsReadBack(
        expected,
        passwordPolicySettingsAuthority({
          authConfig: {
            password_min_length: "12",
            password_required_characters: "lower:upper:number",
          },
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        fields: ["password_min_length", "password_required_characters"],
      }),
    );
  });

  test("accepts a write-only CAPTCHA secret only when configured state is observable", async () => {
    const captchaCommand = captchaConfig({
      value: {
        provider: "hcaptcha",
        secret: "test-captcha-secret",
        secret_configured: true,
      },
    });
    /** @type {import("./authoritative-settings-readback.js").DeepReadonly<typeof captchaCommand> | undefined} */
    let receivedCommand;
    const success = await settleAuthoritativeSettingsMutation({
      draft: {
        command: captchaCommand,
        authority: captchaSettingsAuthority(captchaCommand),
      },
      writeCommands: (command) => {
        receivedCommand = command;
        return [async () => ({ status: 200 })];
      },
      readSnapshot: async () => captchaConfig(),
      authorityFromSnapshot: captchaSettingsAuthority,
    });

    expect(success.status).toBe("success");
    if (success.status !== "success" || !receivedCommand) throw new Error("Expected successful command");
    expect(receivedCommand.value.secret).toBe("test-captcha-secret");
    expect("secret" in success.readBackValue.value).toBe(false);

    const missingSecret = await settleAuthoritativeSettingsMutation({
      draft: {
        command: captchaCommand,
        authority: captchaSettingsAuthority(captchaCommand),
      },
      writeCommands: () => [async () => ({ status: 200 })],
      readSnapshot: async () =>
        captchaConfig({
          value: { provider: "hcaptcha", secret_configured: false },
        }),
      authorityFromSnapshot: captchaSettingsAuthority,
    });
    expectMismatch(missingSecret, "secret_configured");
  });

  test("rejects JIT capability and domain changes after the write", async () => {
    const expected = organizationSettingsAuthority(organizationSnapshot());
    const capabilityChanged = organizationSettingsAuthority(
      organizationSnapshot({
        jitEnabled: false,
        jitResponse: { enabled: false, domains: [] },
      }),
    );
    const capabilityFailure = await reconcile({
      command: { managed: true },
      authority: expected,
      readSnapshot: async () => capabilityChanged,
    });
    expectMismatch(capabilityFailure, "jit_capability");

    const droppedDomain = organizationSettingsAuthority(
      organizationSnapshot({
        jitResponse: { enabled: true, domains: ["example.test"] },
      }),
    );
    const domainFailure = await reconcile({
      command: { managed: true },
      authority: expected,
      readSnapshot: async () => droppedDomain,
    });
    expectMismatch(domainFailure, "jit.domains");
  });

  test("returns readback_failure when a partial write also reads back stale state", async () => {
    const requestFailure = new Error("second write rejected");
    const reconciliation = await reconcile({
      command: { primary: true, secondary: true },
      authority: { primary: true, secondary: true },
      writeCommands: () => [
        async () => ({ status: 200 }),
        () => Promise.reject(requestFailure),
      ],
      readSnapshot: async () => ({ primary: true, secondary: false }),
    });

    expectMismatch(reconciliation, "secondary");
    expect(reconciliation.writeStatus).toBe("partial_failure");
    expect(reconciliation.writeErrors).toEqual([requestFailure]);
  });

  test("rejects two fulfilled writes when one authority source stayed old", async () => {
    const expected = signInMethodsSettingsAuthority(signInSnapshot());
    const stale = signInMethodsSettingsAuthority(
      signInSnapshot({
        authConfig: { enable_signup: false, disable_signup: true },
      }),
    );
    const reconciliation = await reconcile({
      command: { experience: true, gotrue: true },
      authority: expected,
      writeCommands: () => [
        async () => ({ status: 200 }),
        async () => ({ status: 200 }),
      ],
      readSnapshot: async () => stale,
    });

    expectMismatch(reconciliation, "gotrue.enable_signup");
    expect(reconciliation.readBackError.fields).toContain(
      "gotrue.disable_signup",
    );
    expect(reconciliation.writeStatus).toBe("success");
  });

  test("requires every CAPTCHA and blocklist field with its exact type", () => {
    expect(() =>
      assertAuthoritativeSettingsReadBack(
        captchaSettingsAuthority(captchaConfig()),
        captchaSettingsAuthority({
          enabled: "true",
          value: { provider: "hcaptcha", secret_configured: true },
        }),
      ),
    ).toThrow(expect.objectContaining({ fields: ["enabled"] }));

    const originalBlocklist = blocklistConfig();
    const wrongBlocklist = {
      ...originalBlocklist,
      value: { ...originalBlocklist.value, invite_only: "true" },
    };
    expect(() =>
      assertAuthoritativeSettingsReadBack(
        blocklistSettingsAuthority(blocklistConfig()),
        blocklistSettingsAuthority(wrongBlocklist),
      ),
    ).toThrow(expect.objectContaining({ fields: ["invite_only"] }));
  });
});
