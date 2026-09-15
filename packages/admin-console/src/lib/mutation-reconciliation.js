// @ts-check

/**
 * @typedef {"success" | "write_failure" | "partial_failure"} WriteStatus
 * @typedef {() => unknown | PromiseLike<unknown>} WriteCommand
 * @typedef {{getItem(key: string): string | null, setItem(key: string, value: string): void}} MutationLockStorage
 * @typedef {() => MutationLockStorage | null | undefined} MutationStorageProvider
 * @typedef {{id: string, url: string, events: string[], secret_configured: boolean, enabled: boolean, created_at: string, updated_at: string, signing_key_id?: string}} WebhookCommandAck
 * @typedef {{url: string, enabled: boolean, events: readonly string[]}} WebhookDraft
 * @typedef {{client_name: string, redirect_uris: readonly string[], client_type: string, grant_types: readonly string[], token_endpoint_auth_method: string}} ApplicationDraft
 * @typedef {{identity: string, client_name: string, redirect_uris: string[], client_type: "public" | "confidential", grant_types: string[], token_endpoint_auth_method: "none" | "client_secret_basic" | "client_secret_post"}} NormalizedApplication
 */
/**
 * @template Snapshot
 * @typedef {{[Status in WriteStatus]: {status: Status, writeStatus: Status, writeErrors: unknown[], readBackValue: Snapshot}}[WriteStatus] | {status: "readback_failure", writeStatus: WriteStatus, writeErrors: unknown[], readBackError: unknown}} MutationReconciliation
 */
/**
 * @template {string} [Action=string]
 * @typedef {{action: Action, ownerId: string, targetId: string}} MutationLockDescriptor
 */
/**
 * @template {string} [Action=string]
 * @typedef {MutationLockDescriptor<Action> & {recordedAt: number}} DurableMutationLock
 */
/**
 * @template {string} [Action=string]
 * @typedef {Record<string, DurableMutationLock<Action>>} DurableMutationLocks
 */

/** @param {readonly PromiseSettledResult<unknown>[]} writeOutcomes @returns {WriteStatus} */
function settledWriteStatus(writeOutcomes) {
  const completedWrites = writeOutcomes.filter(
    (writeOutcome) => writeOutcome.status === "fulfilled",
  ).length;
  if (completedWrites === writeOutcomes.length) return "success";
  if (completedWrites === 0) return "write_failure";
  return "partial_failure";
}

/** @param {readonly PromiseSettledResult<unknown>[]} writeOutcomes @returns {unknown[]} */
function rejectedWriteReasons(writeOutcomes) {
  return writeOutcomes
    .filter((writeOutcome) => writeOutcome.status === "rejected")
    .map(/** @returns {unknown} */ (writeOutcome) => writeOutcome.reason);
}

const DURABLE_LOCK_FIELDS = new Set([
  "action",
  "ownerId",
  "recordedAt",
  "targetId",
]);

/** @param {unknown} candidate @returns {candidate is Record<string, unknown>} */
function plainRecord(candidate) {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

/** @param {unknown} candidate @returns {candidate is unknown[]} */
function unknownArray(candidate) {
  return Array.isArray(candidate);
}

/** @param {MutationLockDescriptor} descriptor */
function mutationLockKey(descriptor) {
  return JSON.stringify([
    descriptor.action,
    descriptor.ownerId,
    descriptor.targetId,
  ]);
}

/** @template {string} Action @param {unknown} descriptor @param {ReadonlySet<Action>} allowedActions @returns {descriptor is MutationLockDescriptor<Action>} */
function validLockDescriptor(descriptor, allowedActions) {
  /** @type {ReadonlySet<unknown>} */
  const actionValues = allowedActions;
  return (
    plainRecord(descriptor) &&
    actionValues.has(descriptor["action"]) &&
    typeof descriptor["ownerId"] === "string" &&
    descriptor["ownerId"].length > 0 &&
    typeof descriptor["targetId"] === "string" &&
    descriptor["targetId"].length > 0
  );
}

/** @template {string} Action @param {string} lockKey @param {unknown} lock @param {ReadonlySet<Action>} allowedActions @returns {lock is DurableMutationLock<Action>} */
function validPersistedLock(lockKey, lock, allowedActions) {
  if (!validLockDescriptor(lock, allowedActions)) return false;
  if (!("recordedAt" in lock) || typeof lock.recordedAt !== "number") return false;
  const fields = Object.keys(lock);
  return (
    fields.length === DURABLE_LOCK_FIELDS.size &&
    fields.every((field) => DURABLE_LOCK_FIELDS.has(field)) &&
    Number.isSafeInteger(lock.recordedAt) &&
    lock.recordedAt > 0 &&
    lockKey === mutationLockKey(lock)
  );
}

/** @template {string} Action @param {string | null} serializedLocks @param {ReadonlySet<Action>} allowedActions @returns {DurableMutationLocks<Action>} */
function parseDurableLocks(serializedLocks, allowedActions) {
  if (serializedLocks === null) return {};
  /** @type {unknown} */
  const parsedLocks = JSON.parse(serializedLocks);
  if (!plainRecord(parsedLocks)) throw new Error("Invalid mutation lock storage");
  /** @type {DurableMutationLocks<Action>} */
  const validLocks = {};
  for (const [lockKey, lock] of Object.entries(parsedLocks)) {
    if (!validPersistedLock(lockKey, lock, allowedActions)) {
      throw new Error("Invalid mutation lock storage");
    }
    validLocks[lockKey] = lock;
  }
  return validLocks;
}

/** @param {MutationStorageProvider} storageProvider @param {readonly string[]} legacyStorageKeys */
function mutationStorage(storageProvider, legacyStorageKeys) {
  const storage = storageProvider();
  if (!storage?.getItem || !storage?.setItem) {
    throw new Error("Mutation lock storage is unavailable");
  }
  for (const legacyStorageKey of legacyStorageKeys) {
    if (storage.getItem(legacyStorageKey) !== null) {
      throw new Error("Legacy mutation lock storage requires reconciliation");
    }
  }
  return storage;
}

/** @template {string} Action @param {MutationLockStorage} storage @param {string} storageKey @param {DurableMutationLocks<Action>} locks @param {ReadonlySet<Action>} allowedActions */
function persistDurableLocks(storage, storageKey, locks, allowedActions) {
  const serializedLocks = JSON.stringify(locks);
  storage.setItem(storageKey, serializedLocks);
  const persistedLocks = parseDurableLocks(storage.getItem(storageKey), allowedActions);
  if (JSON.stringify(persistedLocks) !== serializedLocks) {
    throw new Error("Mutation lock storage read-back mismatch");
  }
  return persistedLocks;
}

/** @template {string} Action @param {MutationLockStorage} storage @param {string} storageKey @param {ReadonlySet<Action>} allowedActions */
function latestDurableLocks(storage, storageKey, allowedActions) {
  return parseDurableLocks(storage.getItem(storageKey), allowedActions);
}

/**
 * @template {string} [Action=string]
 * @param {{storageKey: string, allowedActions: readonly Action[], storageProvider: MutationStorageProvider, legacyStorageKeys?: readonly string[]}} options
 */
export function createDurableMutationLockStore({
  storageKey,
  allowedActions,
  storageProvider,
  legacyStorageKeys = [],
}) {
  const actionSet = new Set(allowedActions);
  const legacyKeySet = Array.isArray(legacyStorageKeys)
    ? new Set(legacyStorageKeys)
    : null;
  if (
    !storageKey ||
    actionSet.size === 0 ||
    typeof storageProvider !== "function" ||
    !Array.isArray(legacyStorageKeys) ||
    !legacyKeySet ||
    legacyKeySet.size !== legacyStorageKeys.length ||
    legacyStorageKeys.some(
      (/** @type {unknown} */ legacyStorageKey) =>
        typeof legacyStorageKey !== "string" ||
        legacyStorageKey.length === 0 ||
        legacyStorageKey === storageKey,
    )
  ) {
    throw new Error("Invalid durable mutation lock configuration");
  }

  function getStorage() {
    return mutationStorage(storageProvider, legacyStorageKeys);
  }

  /** @param {MutationLockDescriptor<Action>} descriptor */
  function validatedDescriptor(descriptor) {
    if (!validLockDescriptor(descriptor, actionSet)) {
      throw new Error("Invalid mutation lock descriptor");
    }
    return descriptor;
  }

  function restore() {
    const storage = getStorage();
    return parseDurableLocks(storage.getItem(storageKey), actionSet);
  }

  /** @param {DurableMutationLocks<Action>} currentLocks @param {MutationLockDescriptor<Action>} descriptor */
  function stage(currentLocks, descriptor) {
    const lockDescriptor = validatedDescriptor(descriptor);
    parseDurableLocks(JSON.stringify(currentLocks), actionSet);
    const storage = getStorage();
    const existingLocks = latestDurableLocks(storage, storageKey, actionSet);
    const lockKey = mutationLockKey(lockDescriptor);
    if (existingLocks[lockKey]) {
      throw new Error("Mutation lock already staged");
    }
    const nextLocks = {
      ...existingLocks,
      [lockKey]: {
        ...lockDescriptor,
        recordedAt: Date.now(),
      },
    };
    return persistDurableLocks(storage, storageKey, nextLocks, actionSet);
  }

  /** @param {DurableMutationLocks<Action>} currentLocks @param {MutationLockDescriptor<Action>} descriptor */
  function clear(currentLocks, descriptor) {
    const lockDescriptor = validatedDescriptor(descriptor);
    parseDurableLocks(JSON.stringify(currentLocks), actionSet);
    const storage = getStorage();
    const nextLocks = latestDurableLocks(storage, storageKey, actionSet);
    delete nextLocks[mutationLockKey(lockDescriptor)];
    return persistDurableLocks(storage, storageKey, nextLocks, actionSet);
  }

  /** @param {DurableMutationLocks<Action>} currentLocks @param {MutationLockDescriptor<Action>} descriptor */
  function isLocked(currentLocks, descriptor) {
    const lockDescriptor = validatedDescriptor(descriptor);
    return Boolean(currentLocks[mutationLockKey(lockDescriptor)]);
  }

  return { restore, stage, clear, isLocked };
}

/** @param {unknown} candidate @param {unknown} expectedId @returns {WebhookCommandAck | null} */
function webhookRecord(candidate, expectedId) {
  if (!plainRecord(candidate)) return null;
  const secretConfigured = webhookSecretConfigured(candidate);
  const signingKeyId = webhookSigningKeyId(candidate);
  if (
    typeof expectedId !== "string" ||
    expectedId.length === 0 ||
    candidate["id"] !== expectedId ||
    typeof candidate["url"] !== "string" ||
    candidate["url"].length === 0 ||
    !unknownArray(candidate["events"]) ||
    !candidate["events"].every((eventName) => typeof eventName === "string") ||
    secretConfigured === null ||
    signingKeyId === null ||
    typeof candidate["enabled"] !== "boolean" ||
    typeof candidate["created_at"] !== "string" ||
    typeof candidate["updated_at"] !== "string"
  ) {
    return null;
  }
  return {
    id: candidate["id"],
    url: candidate["url"],
    events: [...candidate["events"]],
    secret_configured: secretConfigured,
    enabled: candidate["enabled"],
    created_at: candidate["created_at"],
    updated_at: candidate["updated_at"],
    ...(signingKeyId ? { signing_key_id: signingKeyId } : {}),
  };
}

/** @param {Record<string, unknown>} webhook @returns {boolean | null} */
function webhookSecretConfigured(webhook) {
  const facadeState = webhook["secret_configured"];
  const platformState = webhook["has_secret"];
  if (facadeState !== undefined && typeof facadeState !== "boolean") return null;
  if (platformState !== undefined && typeof platformState !== "boolean") return null;
  if (facadeState !== undefined && platformState !== undefined && facadeState !== platformState) {
    return null;
  }
  return facadeState ?? platformState ?? null;
}

/** @param {Record<string, unknown>} webhook @returns {string | null | undefined} */
function webhookSigningKeyId(webhook) {
  const signingKeyId = webhook["signing_key_id"] ?? webhook["signingKeyId"];
  if (signingKeyId === undefined) return undefined;
  return typeof signingKeyId === "string" && signingKeyId.trim()
    ? signingKeyId
    : null;
}

/** @param {readonly unknown[]} webhooks */
function uniqueWebhookCollection(webhooks) {
  const normalizedWebhooks = webhooks.map((webhook) =>
    webhookRecord(webhook, plainRecord(webhook) ? webhook["id"] : undefined),
  );
  if (!normalizedWebhooks.every((webhook) => webhook !== null)) return null;
  const identities = new Set(normalizedWebhooks.map((webhook) => webhook.id));
  return identities.size === normalizedWebhooks.length
    ? { webhooks: normalizedWebhooks, identities }
    : null;
}

/** @param {readonly string[]} firstList @param {readonly string[]} secondList */
function matchingStringLists(firstList, secondList) {
  if (firstList.length !== secondList.length) return false;
  const firstSorted = [...firstList].sort();
  const secondSorted = [...secondList].sort();
  return firstSorted.every((entry, index) => entry === secondSorted[index]);
}

/** @param {WebhookCommandAck} webhook @param {WebhookDraft} draft */
function webhookMatchesDraft(webhook, draft) {
  return (
    webhook.url === draft.url &&
    webhook.enabled === draft.enabled &&
    matchingStringLists(webhook.events, draft.events)
  );
}

/** @param {unknown} candidate @returns {string[] | null} */
function normalizedStringList(candidate) {
  if (!unknownArray(candidate)) return null;
  const normalized = candidate.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") return null;
    return entry.trim();
  });
  if (normalized.length === 0 || !normalized.every((entry) => entry !== null)) {
    return null;
  }
  if (new Set(normalized).size !== normalized.length) return null;
  return normalized.sort();
}

/** @param {Record<string, unknown>} candidate */
function applicationIdentity(candidate) {
  const clientId = candidate["client_id"];
  const legacyId = candidate["id"];
  if (
    (clientId !== undefined && typeof clientId !== "string") ||
    (legacyId !== undefined && typeof legacyId !== "string") ||
    (clientId && legacyId && clientId !== legacyId)
  )
    return null;
  const identity = clientId || legacyId;
  return typeof identity === "string" && identity.length > 0 ? identity : null;
}

/** @param {unknown} candidate @param {string | null} expectedId @returns {NormalizedApplication | null} */
function normalizedApplication(candidate, expectedId = null) {
  if (!plainRecord(candidate)) return null;
  const identity = applicationIdentity(candidate);
  if (
    typeof identity !== "string" ||
    identity.length === 0 ||
    (expectedId !== null && identity !== expectedId) ||
    typeof candidate["client_name"] !== "string" ||
    candidate["client_name"].trim() === ""
  )
    return null;
  const redirectUris = normalizedStringList(candidate["redirect_uris"]);
  const grantTypes = normalizedStringList(candidate["grant_types"]);
  if (!redirectUris || !grantTypes) return null;
  if (
    (candidate["client_type"] !== "public" && candidate["client_type"] !== "confidential") ||
    (candidate["token_endpoint_auth_method"] !== "none" &&
      candidate["token_endpoint_auth_method"] !== "client_secret_basic" &&
      candidate["token_endpoint_auth_method"] !== "client_secret_post")
  )
    return null;
  if ((candidate["client_type"] === "public") !==
    (candidate["token_endpoint_auth_method"] === "none")) return null;
  return {
    identity,
    client_name: candidate["client_name"].trim(),
    redirect_uris: redirectUris,
    client_type: candidate["client_type"],
    grant_types: grantTypes,
    token_endpoint_auth_method: candidate["token_endpoint_auth_method"],
  };
}

/** @param {readonly unknown[]} applications */
function uniqueApplicationCollection(applications) {
  const normalizedApplications = applications.map((application) =>
    normalizedApplication(application),
  );
  if (!normalizedApplications.every((application) => application !== null)) return null;
  const identities = new Set(
    normalizedApplications.map((application) => application.identity),
  );
  return identities.size === normalizedApplications.length
    ? { applications: normalizedApplications, identities }
    : null;
}

/** @param {NormalizedApplication} application @param {ApplicationDraft} draft */
function applicationMatchesDraft(application, draft) {
  const normalizedDraft = normalizedApplication({
    ...draft,
    client_id: application.identity,
  });
  return normalizedDraft &&
    normalizedDraft.client_name === application.client_name &&
    JSON.stringify(normalizedDraft.redirect_uris) ===
      JSON.stringify(application.redirect_uris) &&
    normalizedDraft.client_type === application.client_type &&
    JSON.stringify(normalizedDraft.grant_types) ===
      JSON.stringify(application.grant_types) &&
    normalizedDraft.token_endpoint_auth_method ===
      application.token_endpoint_auth_method;
}

/**
 * @template Application
 * @param {{beforeApplications: readonly unknown[], afterApplications: readonly Application[], createResponse: unknown, draft: ApplicationDraft}} options
 * @returns {Application | null}
 */
export function reconciledCreatedApplication({
  beforeApplications,
  afterApplications,
  createResponse,
  draft,
}) {
  if (
    !Array.isArray(beforeApplications) ||
    !Array.isArray(afterApplications)
  ) return null;
  const beforeCollection = uniqueApplicationCollection(beforeApplications);
  const afterCollection = uniqueApplicationCollection(afterApplications);
  if (!beforeCollection || !afterCollection) return null;
  const responseRecord = normalizedApplication(createResponse);
  if (
    !responseRecord ||
    beforeCollection.identities.has(responseRecord.identity) ||
    !applicationMatchesDraft(responseRecord, draft)
  ) return null;
  const newApplications = afterCollection.applications.filter(
    (application) => !beforeCollection.identities.has(application.identity),
  );
  if (
    newApplications.length !== 1 ||
    newApplications[0]?.identity !== responseRecord.identity
  ) return null;
  if (!applicationMatchesDraft(newApplications[0], draft)) return null;
  const createdIndex = afterCollection.applications.findIndex(
    (entry) => entry.identity === responseRecord.identity,
  );
  return createdIndex >= 0 ? afterApplications[createdIndex] ?? null : null;
}

/** @param {unknown} response @param {string} expectedId @returns {WebhookCommandAck | null} */
export function validatedWebhookCommandAck(response, expectedId) {
  return webhookRecord(response, expectedId);
}

/** @param {{beforeWebhooks: readonly unknown[], afterWebhooks: readonly unknown[], createResponse: unknown, draft: WebhookDraft}} options @returns {WebhookCommandAck | null} */
export function reconciledCreatedWebhook({
  beforeWebhooks,
  afterWebhooks,
  createResponse,
  draft,
}) {
  if (
    !Array.isArray(beforeWebhooks) ||
    !Array.isArray(afterWebhooks)
  ) return null;
  const responseId = plainRecord(createResponse) && typeof createResponse["id"] === "string" ? createResponse["id"] : "";
  const responseAck = webhookRecord(createResponse, responseId);
  if (!responseAck || !webhookMatchesDraft(responseAck, draft)) return null;

  const beforeCollection = uniqueWebhookCollection(beforeWebhooks);
  const afterCollection = uniqueWebhookCollection(afterWebhooks);
  if (!beforeCollection || !afterCollection) return null;
  if (beforeCollection.identities.has(responseId)) return null;
  const newWebhooks = afterCollection.webhooks.filter(
    (webhook) => !beforeCollection.identities.has(webhook.id),
  );
  if (newWebhooks.length !== 1) return null;
  const createdWebhook = newWebhooks[0];
  if (!createdWebhook) return null;
  return createdWebhook.id === responseId &&
    webhookMatchesDraft(createdWebhook, draft)
    ? createdWebhook
    : null;
}

/**
 * @template Snapshot
 * @param {readonly WriteCommand[]} writeCommands
 * @param {() => Snapshot | PromiseLike<Snapshot>} readBack
 * @returns {Promise<MutationReconciliation<Snapshot>>}
 */
export async function settleWritesThenReadBack(writeCommands, readBack) {
  const writeOutcomes = await Promise.allSettled(
    writeCommands.map((writeCommand) => Promise.resolve().then(writeCommand)),
  );
  const writeStatus = settledWriteStatus(writeOutcomes);
  const writeErrors = rejectedWriteReasons(writeOutcomes);
  try {
    const readBackValue = await readBack();
    // 分支保持 status 与 writeStatus 的关联，不能把部分写入当作已确认成功。
    switch (writeStatus) {
      case "success":
        return { status: writeStatus, writeStatus, writeErrors, readBackValue };
      case "write_failure":
        return { status: writeStatus, writeStatus, writeErrors, readBackValue };
      case "partial_failure":
        return { status: writeStatus, writeStatus, writeErrors, readBackValue };
    }
  } catch (readBackError) {
    return { status: "readback_failure", writeStatus, writeErrors, readBackError };
  }
}
