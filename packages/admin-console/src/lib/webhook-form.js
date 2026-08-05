export function normalizedWebhookSelection(selectedEvents, availableEvents) {
  if (!Array.isArray(selectedEvents) || !Array.isArray(availableEvents)) return null;
  const supportedEvents = new Set(availableEvents);
  const normalizedEvents = selectedEvents.map((eventName) =>
    typeof eventName === "string" ? eventName.trim() : ""
  );
  if (
    normalizedEvents.length === 0 ||
    normalizedEvents.some((eventName) => !supportedEvents.has(eventName)) ||
    new Set(normalizedEvents).size !== normalizedEvents.length
  ) return null;
  return normalizedEvents;
}

export function webhookEventChoices(eventCatalog, availableEvents) {
  const catalog = Array.isArray(eventCatalog) && eventCatalog.length
    ? eventCatalog
    : (Array.isArray(availableEvents) ? availableEvents : [])
      .map((eventType) => ({ type: eventType }));
  const choices = [{ type: "*" }];
  const includedTypes = new Set(["*"]);
  for (const event of catalog) {
    if (!event || typeof event.type !== "string" || includedTypes.has(event.type)) continue;
    includedTypes.add(event.type);
    choices.push(event);
  }
  return choices;
}
