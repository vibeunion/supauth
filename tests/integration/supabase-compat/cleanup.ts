type CleanupAction = () => Promise<void>;

interface CleanupEntry {
  label: string;
  action: CleanupAction;
}

export class CleanupStack {
  readonly #entries: CleanupEntry[] = [];

  register(label: string, action: CleanupAction): void {
    this.#entries.push({ label, action });
  }

  async run(): Promise<void> {
    const failures: Error[] = [];
    const pendingEntries = this.#entries.splice(0).reverse();
    for (const entry of pendingEntries) {
      try {
        await entry.action();
      } catch (error) {
        failures.push(labeledCleanupError(entry.label, error));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `Compatibility cleanup failed for ${failures.length} resource(s)`);
    }
  }
}

function labeledCleanupError(label: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${label}: ${message}`, { cause: error });
}
