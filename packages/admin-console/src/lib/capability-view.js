const WAITING_REASON_CODES = new Set([
  "not_advertised_by_upstream",
  "capability_negotiation_unavailable",
]);

export function groupCapabilityEntries(capabilities) {
  const entries = Object.entries(capabilities);
  const waiting = entries.filter(([, capability]) =>
    capability?.available !== true &&
    WAITING_REASON_CODES.has(capability?.reason_code),
  );
  const waitingNames = new Set(waiting.map(([name]) => name));
  return {
    current: entries.filter(([name]) => !waitingNames.has(name)),
    waiting,
  };
}
