// @ts-check
/** @typedef {{type: string, guarantee?: unknown}} WebhookEventChoice */
/** @param {unknown} candidate @returns {candidate is unknown[]} */
function isArray(candidate) {
  return Array.isArray(candidate);
}

/** @param {unknown} candidate @returns {candidate is WebhookEventChoice} */
function isEventChoice(candidate) {
  return candidate !== null && typeof candidate === "object"
    && "type" in candidate && typeof candidate.type === "string";
}

/** @param {unknown} selectedEvents @param {unknown} availableEvents @returns {string[] | null} */
export function normalizedWebhookSelection(selectedEvents, availableEvents) {
  if (!isArray(selectedEvents) || !isArray(availableEvents)) return null;
  const supportedEvents = new Set(availableEvents);
  const entries = Array.from(selectedEvents);
  if (!entries.every((eventName) => typeof eventName === "string")) return null;
  const normalizedEvents = entries.map((eventName) => eventName.trim());
  if (
    normalizedEvents.length === 0 ||
    normalizedEvents.some((eventName) => !supportedEvents.has(eventName)) ||
    new Set(normalizedEvents).size !== normalizedEvents.length
  ) return null;
  return normalizedEvents;
}

/** @param {unknown} eventCatalog @param {unknown} availableEvents @returns {WebhookEventChoice[]} */
export function webhookEventChoices(eventCatalog, availableEvents) {
  const catalog = isArray(eventCatalog) && eventCatalog.length
    ? eventCatalog
    : (isArray(availableEvents) ? availableEvents : [])
      .map((eventType) => ({ type: eventType }));
  /** @type {WebhookEventChoice[]} */
  const choices = [{ type: "*" }];
  const includedTypes = new Set(["*"]);
  for (const event of catalog) {
    if (!isEventChoice(event) || includedTypes.has(event.type)) continue;
    includedTypes.add(event.type);
    choices.push(event);
  }
  return choices;
}
