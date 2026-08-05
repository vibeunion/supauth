// @ts-nocheck
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
} from "./authoritative-settings-readback.js";

function accountCenterConfig(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function signInSnapshot(overrides = {}) {
  return {
    signInExperience: {
      sign_in_methods: ["password", "magic_link"],
      sign_up_enabled: true,
    },
    authConfig: { enable_signup: true, disable_signup: false },
    ...overrides,
  };
}

function brandingSnapshot(overrides = {}) {
  return {
    branding: {
      page_title: "Example",
      primary_color: "#2563eb",
      background_url: "https://example.test/background.png",
      ...overrides,
    },
  };
}

function captchaConfig(overrides = {}) {
  return {
    enabled: true,
    value: {
      provider: "hcaptcha",
      secret_configured: true,
    },
    ...overrides,
  };
}

function blocklistConfig(overrides = {}) {
  return {
    enabled: true,
    value: {
      allowed_email_domains: ["example.test", "staff.example.test"],
      blocked_email_domains: ["blocked.example.test"],
      blocked_oauth_providers: ["github"],
      allowed_oauth_providers: ["google", "azure"],
      invite_only: true,
    },
    ...overrides,
  };
}

function generalSecuritySnapshot(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function organizationSnapshot(overrides = {}) {
  return {
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
    ...overrides,
  };
}

async function reconcile({ command, authority, readSnapshot, writeCommands }) {
  return settleAuthoritativeSettingsMutation({
    draft: { command, authority },
    writeCommands: writeCommands || (() => [async () => ({ status: 200 })]),
    readSnapshot,
    authorityFromSnapshot: (snapshot) => snapshot,
  });
}

function expectMismatch(reconciliation, expectedField) {
  expect(reconciliation.status).toBe("readback_failure");
  expect(reconciliation.readBackError.code).toBe(
    "authoritative_readback_mismatch",
  );
  expect(reconciliation.readBackError.fields).toContain(expectedField);
}

describe("authoritative settings read-back", () => {
  test("freezes a detached command and authority before the write starts", async () => {
    const form = {
      enabled: true,
      methods: ["password", "magic_link"],
    };
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

    const missingFieldSnapshot = brandingSnapshot();
    delete missingFieldSnapshot.branding.page_title;
    expect(() => brandingSettingsAuthority(missingFieldSnapshot)).toThrow(
      expect.objectContaining({ fields: ["branding.page_title"] }),
    );
  });

  test("keeps BrandingEditor draft failures inside the saving reset guard", async () => {
    const brandingEditorSource = await Bun.file(
      new URL(
        "./components/sign-in-experience/BrandingEditor.svelte",
        import.meta.url,
      ),
    ).text();
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
        const dropped = accountCenterConfig();
        delete dropped.value.profile.edit_mode;
        return accountCenterSettingsAuthority(dropped);
      },
      "profile.edit_mode",
    ],
    [
      "Sign-in GoTrue disable flag",
      signInMethodsSettingsAuthority(signInSnapshot()),
      () => {
        const dropped = signInSnapshot();
        delete dropped.authConfig.disable_signup;
        return signInMethodsSettingsAuthority(dropped);
      },
      "gotrue.disable_signup",
    ],
    [
      "Security confirmation flag",
      generalSecuritySettingsAuthority(generalSecuritySnapshot()),
      () => {
        const dropped = generalSecuritySnapshot();
        delete dropped.authConfig.enable_confirmations;
        return generalSecuritySettingsAuthority(dropped);
      },
      "enable_confirmations",
    ],
    [
      "Admin login lockout duration",
      generalSecuritySettingsAuthority(generalSecuritySnapshot()),
      () => {
        const dropped = generalSecuritySnapshot();
        delete dropped.securityConfig.lockoutDurationSec;
        return generalSecuritySettingsAuthority(dropped);
      },
      "lockout_duration_sec",
    ],
    [
      "Organization description",
      organizationSettingsAuthority(organizationSnapshot()),
      () => {
        const dropped = organizationSnapshot();
        delete dropped.organizationResponse.description;
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
    expect(receivedCommand.value.secret).toBe("test-captcha-secret");
    expect(success.readBackValue.value.secret).toBeUndefined();

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

    const wrongBlocklist = blocklistConfig();
    wrongBlocklist.value.invite_only = "true";
    expect(() =>
      assertAuthoritativeSettingsReadBack(
        blocklistSettingsAuthority(blocklistConfig()),
        blocklistSettingsAuthority(wrongBlocklist),
      ),
    ).toThrow(expect.objectContaining({ fields: ["invite_only"] }));
  });
});
