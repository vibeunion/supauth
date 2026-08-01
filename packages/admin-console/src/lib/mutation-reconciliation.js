function settledWriteStatus(writeOutcomes) {
  const completedWrites = writeOutcomes.filter(
    (writeOutcome) => writeOutcome.status === "fulfilled",
  ).length;
  if (completedWrites === writeOutcomes.length) return "success";
  if (completedWrites === 0) return "write_failure";
  return "partial_failure";
}

function rejectedWriteReasons(writeOutcomes) {
  return writeOutcomes
    .filter((writeOutcome) => writeOutcome.status === "rejected")
    .map((writeOutcome) => writeOutcome.reason);
}

const DURABLE_LOCK_FIELDS = new Set([
  "action",
  "ownerId",
  "recordedAt",
  "targetId",
]);

function plainRecord(candidate) {
  return candidate && typeof candidate === "object" && !Array.isArray(candidate);
}

function mutationLockKey(descriptor) {
  return JSON.stringify([
    descriptor.action,
    descriptor.ownerId,
    descriptor.targetId,
  ]);
}

function validLockDescriptor(descriptor, allowedActions) {
  return (
    plainRecord(descriptor) &&
    allowedActions.has(descriptor.action) &&
    typeof descriptor.ownerId === "string" &&
    descriptor.ownerId.length > 0 &&
    typeof descriptor.targetId === "string" &&
    descriptor.targetId.length > 0
  );
}

function validPersistedLock(lockKey, lock, allowedActions) {
  if (!validLockDescriptor(lock, allowedActions)) return false;
  const fields = Object.keys(lock);
  return (
    fields.length === DURABLE_LOCK_FIELDS.size &&
    fields.every((field) => DURABLE_LOCK_FIELDS.has(field)) &&
    Number.isSafeInteger(lock.recordedAt) &&
    lock.recordedAt > 0 &&
    lockKey === mutationLockKey(lock)
  );
}

function parseDurableLocks(serializedLocks, allowedActions) {
  if (serializedLocks === null) return {};
  const parsedLocks = JSON.parse(serializedLocks);
  if (!plainRecord(parsedLocks)) throw new Error("Invalid mutation lock storage");
  const valid = Object.entries(parsedLocks).every(([lockKey, lock]) =>
    validPersistedLock(lockKey, lock, allowedActions),
  );
  if (!valid) throw new Error("Invalid mutation lock storage");
  return parsedLocks;
}

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

function persistDurableLocks(storage, storageKey, locks, allowedActions) {
  const serializedLocks = JSON.stringify(locks);
  storage.setItem(storageKey, serializedLocks);
  const persistedLocks = parseDurableLocks(storage.getItem(storageKey), allowedActions);
  if (JSON.stringify(persistedLocks) !== serializedLocks) {
    throw new Error("Mutation lock storage read-back mismatch");
  }
  return persistedLocks;
}

function latestDurableLocks(storage, storageKey, allowedActions) {
  return parseDurableLocks(storage.getItem(storageKey), allowedActions);
}

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
      (legacyStorageKey) =>
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

  function clear(currentLocks, descriptor) {
    const lockDescriptor = validatedDescriptor(descriptor);
    parseDurableLocks(JSON.stringify(currentLocks), actionSet);
    const storage = getStorage();
    const nextLocks = latestDurableLocks(storage, storageKey, actionSet);
    delete nextLocks[mutationLockKey(lockDescriptor)];
    return persistDurableLocks(storage, storageKey, nextLocks, actionSet);
  }

  function isLocked(currentLocks, descriptor) {
    const lockDescriptor = validatedDescriptor(descriptor);
    return Boolean(currentLocks[mutationLockKey(lockDescriptor)]);
  }

  return { restore, stage, clear, isLocked };
}

function webhookRecord(candidate, expectedId) {
  if (
    !plainRecord(candidate) ||
    typeof expectedId !== "string" ||
    expectedId.length === 0 ||
    candidate.id !== expectedId ||
    typeof candidate.url !== "string" ||
    candidate.url.length === 0 ||
    !Array.isArray(candidate.events) ||
    !candidate.events.every((eventName) => typeof eventName === "string") ||
    typeof candidate.secret_configured !== "boolean" ||
    typeof candidate.enabled !== "boolean" ||
    typeof candidate.created_at !== "string" ||
    typeof candidate.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    url: candidate.url,
    events: [...candidate.events],
    secret_configured: candidate.secret_configured,
    enabled: candidate.enabled,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
  };
}

function uniqueWebhookCollection(webhooks) {
  const normalizedWebhooks = webhooks.map((webhook) =>
    webhookRecord(webhook, webhook?.id),
  );
  if (normalizedWebhooks.some((webhook) => !webhook)) return null;
  const identities = new Set(normalizedWebhooks.map((webhook) => webhook.id));
  return identities.size === normalizedWebhooks.length
    ? { webhooks: normalizedWebhooks, identities }
    : null;
}

function matchingStringLists(firstList, secondList) {
  if (firstList.length !== secondList.length) return false;
  const firstSorted = [...firstList].sort();
  const secondSorted = [...secondList].sort();
  return firstSorted.every((entry, index) => entry === secondSorted[index]);
}

function webhookMatchesDraft(webhook, draft) {
  return (
    webhook.url === draft.url &&
    webhook.enabled === draft.enabled &&
    matchingStringLists(webhook.events, draft.events)
  );
}

function normalizedStringList(candidate) {
  if (!Array.isArray(candidate)) return null;
  const normalized = candidate.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") return null;
    return entry.trim();
  });
  if (normalized.length === 0 || normalized.some((entry) => entry === null)) {
    return null;
  }
  if (new Set(normalized).size !== normalized.length) return null;
  return normalized.sort();
}

function applicationIdentity(candidate) {
  const clientId = candidate.client_id;
  const legacyId = candidate.id;
  if (
    (clientId !== undefined && typeof clientId !== "string") ||
    (legacyId !== undefined && typeof legacyId !== "string") ||
    (clientId && legacyId && clientId !== legacyId)
  )
    return null;
  const identity = clientId || legacyId;
  return typeof identity === "string" && identity.length > 0 ? identity : null;
}

function normalizedApplication(candidate, expectedId = null) {
  if (!plainRecord(candidate)) return null;
  const identity = applicationIdentity(candidate);
  if (
    typeof identity !== "string" ||
    identity.length === 0 ||
    (expectedId !== null && identity !== expectedId) ||
    typeof candidate.client_name !== "string" ||
    candidate.client_name.trim() === ""
  )
    return null;
  const redirectUris = normalizedStringList(candidate.redirect_uris);
  const grantTypes = normalizedStringList(candidate.grant_types);
  if (!redirectUris || !grantTypes) return null;
  if (
    (candidate.client_type !== "public" && candidate.client_type !== "confidential") ||
    (candidate.token_endpoint_auth_method !== "none" &&
      candidate.token_endpoint_auth_method !== "client_secret_basic" &&
      candidate.token_endpoint_auth_method !== "client_secret_post")
  )
    return null;
  if ((candidate.client_type === "public") !==
    (candidate.token_endpoint_auth_method === "none")) return null;
  return {
    identity,
    client_name: candidate.client_name.trim(),
    redirect_uris: redirectUris,
    client_type: candidate.client_type,
    grant_types: grantTypes,
    token_endpoint_auth_method: candidate.token_endpoint_auth_method,
  };
}

function uniqueApplicationCollection(applications) {
  const normalizedApplications = applications.map((application) =>
    normalizedApplication(application),
  );
  if (normalizedApplications.some((application) => !application)) return null;
  const identities = new Set(
    normalizedApplications.map((application) => application.identity),
  );
  return identities.size === normalizedApplications.length
    ? { applications: normalizedApplications, identities }
    : null;
}

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
    newApplications[0].identity !== responseRecord.identity
  ) return null;
  if (!applicationMatchesDraft(newApplications[0], draft)) return null;
  const createdIndex = afterCollection.applications.findIndex(
    (entry) => entry.identity === responseRecord.identity,
  );
  return createdIndex >= 0 ? afterApplications[createdIndex] : null;
}

export function validatedWebhookCommandAck(response, expectedId) {
  return webhookRecord(response, expectedId);
}

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
  const responseId = typeof createResponse?.id === "string" ? createResponse.id : "";
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
  return createdWebhook.id === responseId &&
    webhookMatchesDraft(createdWebhook, draft)
    ? createdWebhook
    : null;
}

export async function settleWritesThenReadBack(writeCommands, readBack) {
  const writeOutcomes = await Promise.allSettled(
    writeCommands.map((writeCommand) => Promise.resolve().then(writeCommand)),
  );
  const writeStatus = settledWriteStatus(writeOutcomes);
  const writeErrors = rejectedWriteReasons(writeOutcomes);
  try {
    const readBackValue = await readBack();
    return { status: writeStatus, writeStatus, writeErrors, readBackValue };
  } catch (readBackError) {
    return { status: "readback_failure", writeStatus, writeErrors, readBackError };
  }
}
