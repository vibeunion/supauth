// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { t } from "./i18n.js";
import {
  createDurableMutationLockStore,
  reconciledCreatedApplication,
  reconciledCreatedWebhook,
  settleWritesThenReadBack,
  validatedWebhookCommandAck,
} from "./mutation-reconciliation.js";

function deferredRequest() {
  let resolveRequest;
  const promise = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  return { promise, resolve: resolveRequest };
}

function memoryStorage(initialEntries = {}) {
  const storedEntries = new Map(Object.entries(initialEntries));
  return {
    getItem(storageKey) {
      return storedEntries.has(storageKey) ? storedEntries.get(storageKey) : null;
    },
    setItem(storageKey, serializedValue) {
      storedEntries.set(storageKey, serializedValue);
    },
  };
}

function webhookFixture(overrides = {}) {
  return {
    id: "webhook-new",
    url: "https://hooks.example.test/events",
    events: ["user.created", "user.updated"],
    secret_configured: true,
    enabled: true,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function applicationFixture(overrides = {}) {
  return {
    client_id: "application-new",
    client_name: "New Application",
    redirect_uris: ["https://app.example.test/callback"],
    client_type: "confidential",
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "client_secret_basic",
    ...overrides,
  };
}

describe("mutation reconciliation", () => {
  test("stages strict durable locks before reload and clears only the exact action", () => {
    const storageKey = "test.mutation-locks";
    const storage = memoryStorage();
    const store = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["delete-scope", "revoke-assignment"],
      storageProvider: () => storage,
    });
    const descriptor = {
      action: "delete-scope",
      ownerId: "resource-one",
      targetId: "scope-one",
    };

    const stagedLocks = store.stage(store.restore(), descriptor);
    expect(store.isLocked(stagedLocks, descriptor)).toBe(true);
    expect(JSON.stringify(stagedLocks)).not.toMatch(/secret|payload/i);

    const reloadedStore = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["delete-scope", "revoke-assignment"],
      storageProvider: () => storage,
    });
    const reloadedLocks = reloadedStore.restore();
    expect(reloadedStore.isLocked(reloadedLocks, descriptor)).toBe(true);
    expect(reloadedStore.isLocked(reloadedLocks, {
      ...descriptor,
      targetId: "scope-two",
    })).toBe(false);
    expect(reloadedStore.isLocked(
      reloadedStore.clear(reloadedLocks, descriptor),
      descriptor,
    )).toBe(false);
  });

  test("fails closed on unavailable, corrupt, or non-durable lock storage", () => {
    const storageKey = "test.mutation-locks";
    const descriptor = {
      action: "remove-member",
      ownerId: "organization-one",
      targetId: "user-one",
    };
    const unavailableStore = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["remove-member"],
      storageProvider: () => undefined,
    });
    expect(() => unavailableStore.restore()).toThrow("unavailable");

    const corruptStorage = memoryStorage({ [storageKey]: "{broken" });
    const corruptStore = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["remove-member"],
      storageProvider: () => corruptStorage,
    });
    expect(() => corruptStore.restore()).toThrow(SyntaxError);

    const droppingStorage = {
      getItem: () => null,
      setItem: () => {},
    };
    const droppingStore = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["remove-member"],
      storageProvider: () => droppingStorage,
    });
    expect(() => droppingStore.stage({}, descriptor)).toThrow("mismatch");

    const wrongShape = memoryStorage({
      [storageKey]: JSON.stringify({
        unexpected: { ...descriptor, recordedAt: 1, payload: "unsafe" },
      }),
    });
    const strictStore = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["remove-member"],
      storageProvider: () => wrongShape,
    });
    expect(() => strictStore.restore()).toThrow("Invalid mutation lock storage");
  });

  test("merges stale tab snapshots and rejects an already staged identity", () => {
    const storageKey = "test.concurrent-mutation-locks";
    const storage = memoryStorage();
    const firstTab = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["delete", "rotate"],
      storageProvider: () => storage,
    });
    const secondTab = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["delete", "rotate"],
      storageProvider: () => storage,
    });
    const deletion = {
      action: "delete",
      ownerId: "applications",
      targetId: "application-one",
    };
    const rotation = { ...deletion, action: "rotate" };

    const deletionLocks = firstTab.stage({}, deletion);
    const mergedLocks = secondTab.stage({}, rotation);
    expect(firstTab.isLocked(mergedLocks, deletion)).toBe(true);
    expect(secondTab.isLocked(mergedLocks, rotation)).toBe(true);
    expect(() => secondTab.stage({}, deletion)).toThrow("already staged");

    const remainingLocks = firstTab.clear(deletionLocks, deletion);
    expect(firstTab.isLocked(remainingLocks, deletion)).toBe(false);
    expect(firstTab.isLocked(remainingLocks, rotation)).toBe(true);
  });

  test("rejects empty, mismatched, extra, and unsafe persisted lock fields", () => {
    const storageKey = "test.strict-mutation-locks";
    const descriptor = {
      action: "delete",
      ownerId: "applications",
      targetId: "application-one",
      recordedAt: 42,
    };
    const validKey = JSON.stringify([
      descriptor.action,
      descriptor.ownerId,
      descriptor.targetId,
    ]);
    for (const persistedLocks of [
      { [validKey]: { ...descriptor, ownerId: "" } },
      { [validKey]: { ...descriptor, targetId: "" } },
      { [validKey]: { ...descriptor, recordedAt: 1.5 } },
      { [validKey]: { ...descriptor, unexpected: true } },
      { unexpected: descriptor },
    ]) {
      const store = createDurableMutationLockStore({
        storageKey,
        allowedActions: ["delete"],
        storageProvider: () =>
          memoryStorage({ [storageKey]: JSON.stringify(persistedLocks) }),
      });
      expect(() => store.restore()).toThrow("Invalid mutation lock storage");
    }
  });

  test("fails closed when a legacy v1 lock record is still present", () => {
    const storageKey = "test.mutation-locks.v2";
    const legacyStorageKey = "test.mutation-locks.v1";
    const storage = memoryStorage({
      [legacyStorageKey]: JSON.stringify({
        "delete:application-one": {
          action: "delete",
          recordedAt: 42,
        },
      }),
    });
    const store = createDurableMutationLockStore({
      storageKey,
      allowedActions: ["delete"],
      storageProvider: () => storage,
      legacyStorageKeys: [legacyStorageKey],
    });
    expect(() => store.restore()).toThrow("Legacy mutation lock storage");
    expect(() => store.stage({}, {
      action: "delete",
      ownerId: "applications",
      targetId: "application-one",
    })).toThrow("Legacy mutation lock storage");
  });

  test("accepts application create only for one canonical new identity", () => {
    const existing = applicationFixture({ client_id: "application-existing" });
    const created = applicationFixture();
    const draft = {
      client_name: ` ${created.client_name} `,
      redirect_uris: [` ${created.redirect_uris[0]} `],
      client_type: created.client_type,
      grant_types: [...created.grant_types].reverse(),
      token_endpoint_auth_method: created.token_endpoint_auth_method,
    };
    const matchingResponse = {
      ...created,
      redirect_uris: [...created.redirect_uris].reverse(),
      grant_types: [...created.grant_types].reverse(),
      client_secret: "shown-once",
    };

    expect(reconciledCreatedApplication({
      beforeApplications: [existing],
      afterApplications: [existing, created],
      createResponse: matchingResponse,
      draft,
    })).toEqual(created);
    for (const reconciliation of [
      {
        beforeApplications: [existing],
        afterApplications: [existing, created],
        createResponse: existing,
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [
          existing,
          created,
          applicationFixture({ client_id: "application-concurrent" }),
        ],
        createResponse: matchingResponse,
        draft,
      },
      {
        beforeApplications: [existing, existing],
        afterApplications: [existing, created],
        createResponse: matchingResponse,
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [existing, existing, created],
        createResponse: matchingResponse,
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [existing, created, { ...created }],
        createResponse: matchingResponse,
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [
          existing,
          { ...created, client_id: undefined },
        ],
        createResponse: matchingResponse,
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [existing, { ...created, client_id: 42 }],
        createResponse: matchingResponse,
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [existing, created],
        createResponse: { ...matchingResponse, client_name: "Other" },
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [existing, { client_id: created.client_id }],
        createResponse: matchingResponse,
        draft,
      },
      {
        beforeApplications: [existing],
        afterApplications: [existing, created],
        createResponse: matchingResponse,
        draft: { ...draft, redirect_uris: ["https://other.example.test/cb"] },
      },
    ]) {
      expect(reconciledCreatedApplication(reconciliation)).toBeNull();
    }
  });

  test("accepts webhook create only for one new identity matching draft and response", () => {
    const existing = webhookFixture({ id: "webhook-existing" });
    const created = webhookFixture();
    const draft = {
      url: created.url,
      events: [...created.events].reverse(),
      enabled: created.enabled,
    };

    expect(reconciledCreatedWebhook({
      beforeWebhooks: [existing],
      afterWebhooks: [existing, created],
      createResponse: created,
      draft,
    })).toEqual(created);
    const platformCreated = {
      ...created,
      has_secret: true,
      secret_configured: undefined,
      signing_key_id: "v1",
    };
    expect(reconciledCreatedWebhook({
      beforeWebhooks: [existing],
      afterWebhooks: [existing, platformCreated],
      createResponse: platformCreated,
      draft,
    })).toEqual({
      ...created,
      secret_configured: true,
      signing_key_id: "v1",
    });
    expect(reconciledCreatedWebhook({
      beforeWebhooks: [existing],
      afterWebhooks: [existing, created],
      createResponse: existing,
      draft,
    })).toBeNull();
    expect(reconciledCreatedWebhook({
      beforeWebhooks: [existing],
      afterWebhooks: [existing, created],
      createResponse: { id: created.id },
      draft,
    })).toBeNull();
    expect(reconciledCreatedWebhook({
      beforeWebhooks: [existing],
      afterWebhooks: [existing, created, webhookFixture({ id: "concurrent" })],
      createResponse: created,
      draft,
    })).toBeNull();
    expect(reconciledCreatedWebhook({
      beforeWebhooks: [existing],
      afterWebhooks: [existing, created],
      createResponse: created,
      draft: { ...draft, url: "https://other.example.test/events" },
    })).toBeNull();
    for (const authorityCollections of [
      {
        beforeWebhooks: [existing, existing],
        afterWebhooks: [existing, created],
      },
      {
        beforeWebhooks: [existing],
        afterWebhooks: [existing, existing, created],
      },
      {
        beforeWebhooks: [existing],
        afterWebhooks: [existing, created, { ...created }],
      },
      {
        beforeWebhooks: [existing],
        afterWebhooks: [existing, { ...created, id: undefined }],
      },
      {
        beforeWebhooks: [existing],
        afterWebhooks: [existing, { ...created, id: 42 }],
      },
      {
        beforeWebhooks: [existing],
        afterWebhooks: [
          existing,
          { ...created, has_secret: false },
        ],
      },
      {
        beforeWebhooks: [existing],
        afterWebhooks: [
          existing,
          { ...existing, url: "" },
          created,
        ],
      },
    ]) {
      expect(reconciledCreatedWebhook({
        ...authorityCollections,
        createResponse: created,
        draft,
      })).toBeNull();
    }
  });

  test("uses only a complete matching webhook response as rotation command ack", () => {
    const rotated = webhookFixture({ updated_at: "2026-08-01T00:01:00.000Z" });
    expect(validatedWebhookCommandAck(rotated, rotated.id)).toEqual(rotated);
    expect(validatedWebhookCommandAck({ id: rotated.id }, rotated.id)).toBeNull();
    expect(validatedWebhookCommandAck(rotated, "other-webhook")).toBeNull();
    expect(validatedWebhookCommandAck({
      ...rotated,
      events: ["user.created", null],
    }, rotated.id)).toBeNull();
  });

  test("reports success only after every write and the read-back succeed", async () => {
    const events = [];

    const reconciliation = await settleWritesThenReadBack(
      [
        async () => events.push("auth-write"),
        async () => events.push("overlay-write"),
      ],
      async () => {
        events.push("read-back");
        return { enabled: true };
      },
    );

    expect(reconciliation.status).toBe("success");
    expect(reconciliation.readBackValue).toEqual({ enabled: true });
    expect(reconciliation.writeErrors).toEqual([]);
    expect(events.at(-1)).toBe("read-back");
  });

  test("waits for a late success and keeps the earlier failure authoritative", async () => {
    const lateWrite = deferredRequest();
    const earlyFailure = new Error("first write failed");
    let readBackCount = 0;
    const reconciliationPromise = settleWritesThenReadBack(
      [() => Promise.reject(earlyFailure), () => lateWrite.promise],
      async () => {
        readBackCount += 1;
        return { enabled: false };
      },
    );

    await Promise.resolve();
    expect(readBackCount).toBe(0);
    lateWrite.resolve("applied late");
    const reconciliation = await reconciliationPromise;

    expect(readBackCount).toBe(1);
    expect(reconciliation.status).toBe("partial_failure");
    expect(reconciliation.writeErrors).toEqual([earlyFailure]);
    expect(reconciliation.readBackValue).toEqual({ enabled: false });
  });

  test("runs the authoritative read-back when every write fails", async () => {
    let readBackCount = 0;

    const reconciliation = await settleWritesThenReadBack(
      [
        () => Promise.reject(new Error("auth failed")),
        () => Promise.reject(new Error("security failed")),
      ],
      async () => {
        readBackCount += 1;
        return { jwtExpiry: 3600 };
      },
    );

    expect(readBackCount).toBe(1);
    expect(reconciliation.status).toBe("write_failure");
    expect(reconciliation.writeErrors).toHaveLength(2);
    expect(reconciliation.readBackValue).toEqual({ jwtExpiry: 3600 });
  });

  test("reports an unverifiable save when the read-back fails", async () => {
    const readBackFailure = new Error("read-back unavailable");

    const reconciliation = await settleWritesThenReadBack(
      [async () => "applied"],
      () => Promise.reject(readBackFailure),
    );

    expect(reconciliation.status).toBe("readback_failure");
    expect(reconciliation.writeStatus).toBe("success");
    expect(reconciliation.readBackError).toBe(readBackFailure);
  });

  test("wires affected editors to reconciliation and removes the Sessions ghost setting", async () => {
    const [methodsEditor, securityPage, organizationPage, accountCenterPage] =
      await Promise.all([
        Bun.file(
          new URL(
            "./components/sign-in-experience/SignInMethodsEditor.svelte",
            import.meta.url,
          ),
        ).text(),
        Bun.file(
          new URL("../routes/security/+page.svelte", import.meta.url),
        ).text(),
        Bun.file(
          new URL(
            "../routes/organizations/[orgId]/+page.svelte",
            import.meta.url,
          ),
        ).text(),
        Bun.file(
          new URL("./components/AccountCenterPage.svelte", import.meta.url),
        ).text(),
      ]);

    expect(methodsEditor).toContain("settleAuthoritativeSettingsMutation({");
    expect(methodsEditor).toContain("readSnapshot: readMethodsSnapshot");
    expect(methodsEditor).toContain(
      "authorityFromSnapshot: signInMethodsSettingsAuthority",
    );
    expect(methodsEditor).toContain('from "./signup-authority.js"');
    expect(methodsEditor).toContain(
      "signUpEnabled = resolveAuthoritativeSignupEnabled(authConfig)",
    );
    expect(methodsEditor).not.toContain("experienceSignUpEnabled");
    expect(methodsEditor).toContain(
      'if (reconciliation.status === "success")',
    );
    expect(securityPage).toContain("settleAuthoritativeSettingsMutation({");
    expect(securityPage).toContain("readSnapshot: fetchSecuritySnapshot");
    expect(organizationPage).toContain("settleAuthoritativeSettingsMutation({");
    expect(organizationPage).toContain("readOrganizationSettings(");
    expect(organizationPage).toContain(
      "authorityFromSnapshot: organizationSettingsAuthority",
    );
    expect(accountCenterPage).not.toContain("form.sessions");
    expect(accountCenterPage).not.toMatch(/\bsessions\s*:/);
    expect(accountCenterPage).toContain(
      'data-capability-status="capability_unavailable"',
    );
    expect(accountCenterPage).toContain("settleAuthoritativeSettingsMutation({");
    expect(accountCenterPage).toContain('from "./account-center-settings.js"');
    expect(accountCenterPage).toContain(
      "authorityFromSnapshot: accountCenterSettingsAuthority",
    );
    expect(accountCenterPage).toContain(
      "readAccountCenterConfig(listTenantConfigs)",
    );
    expect(accountCenterPage).toContain(
      'if (reconciliation.status === "success")',
    );
    expect(accountCenterPage).not.toContain("await load();");
    expect(accountCenterPage).toContain(
      't(`save.${reconciliationStatus}.title`)',
    );
    expect(accountCenterPage).not.toContain("requestError.message");
    expect(accountCenterPage).not.toContain("readBackError");
  });

  test("describes the scoped sign-out boundary without denying revocation support", () => {
    expect(t("accountCenter.sessionsUnavailableTitle")).toBe(
      "Per-session management unavailable",
    );
    expect(t("accountCenter.sessionsUnavailableDescription")).toBe(
      "GoTrue supports current-device, other-device, and all-device sign-out. " +
        "This console does not provide a per-session list, revoke-by-ID action, or Sessions setting to save.",
    );

    const previousLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => "zh-CN",
    };
    try {
      expect(t("accountCenter.sessionsUnavailableTitle")).toBe(
        "逐会话管理不可用",
      );
      expect(t("accountCenter.sessionsUnavailableDescription")).toBe(
        "GoTrue 支持退出当前设备、其他设备和全部设备；" +
          "当前控制台不提供逐会话列表、按会话 ID 撤销操作或可保存的 Sessions 开关。",
      );
    } finally {
      if (previousLocalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousLocalStorage;
    }
  });

  test("falls back to the browser locale when storage access is blocked", () => {
    const previousLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    try {
      expect(() => t("dashboard.title")).not.toThrow();
      expect(t("dashboard.title")).toBe("Dashboard");
    } finally {
      if (previousLocalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousLocalStorage;
    }
  });

  test("does not hide unexpected locale storage failures", () => {
    const previousLocalStorage = globalThis.localStorage;
    const storageFailure = new Error("storage unavailable");
    globalThis.localStorage = {
      getItem: () => {
        throw storageFailure;
      },
    };
    try {
      expect(() => t("dashboard.title")).toThrow(storageFailure);
    } finally {
      if (previousLocalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousLocalStorage;
    }
  });
});
