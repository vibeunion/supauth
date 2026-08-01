import { isIP } from 'node:net';

export const SHARED_CLIENT_KEY = 'shared-client';
const DEFAULT_RATE_LIMIT_CAPACITY = 10_000;

interface FixedWindowEntry {
  count: number;
}

interface BoundedStoreOptions {
  maxEntries?: number;
  now?: () => number;
}

interface BoundedFixedWindowOptions extends BoundedStoreOptions {
  windowMs: number;
}

interface ExpiringEntry<EntryState> {
  state: EntryState;
  expiresAt: number;
}

export class BoundedExpiringMap<EntryState> {
  private readonly entries = new Map<string, ExpiringEntry<EntryState>>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private nextExpiry = Number.POSITIVE_INFINITY;

  constructor(options: BoundedStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_RATE_LIMIT_CAPACITY;
    this.now = options.now ?? (() => Date.now());
    if (!Number.isInteger(this.maxEntries) || this.maxEntries <= 0) {
      throw new Error('Bounded map capacity must be a positive integer');
    }
  }

  get(key: string): EntryState | undefined {
    const now = this.now();
    this.removeExpired(now);
    return this.entries.get(key)?.state;
  }

  set(key: string, state: EntryState, ttlMs: number): boolean {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Bounded map TTL must be positive');
    }
    const now = this.now();
    this.removeExpired(now);
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) return false;
    const expiresAt = now + ttlMs;
    this.entries.set(key, { state, expiresAt });
    this.nextExpiry = Math.min(this.nextExpiry, expiresAt);
    return true;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get trackedKeyCount(): number {
    return this.entries.size;
  }

  private removeExpired(now: number): void {
    if (now < this.nextExpiry) return;
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      } else {
        nextExpiry = Math.min(nextExpiry, entry.expiresAt);
      }
    }
    this.nextExpiry = nextExpiry;
  }
}

export class BoundedFixedWindowLimiter {
  private readonly entries: BoundedExpiringMap<FixedWindowEntry>;
  private readonly windowMs: number;

  constructor(options: BoundedFixedWindowOptions) {
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error('Fixed-window duration must be positive');
    }
    this.windowMs = options.windowMs;
    this.entries = new BoundedExpiringMap(options);
  }

  consume(key: string, limit: number): boolean {
    const current = this.entries.get(key);
    if (!current) return this.entries.set(key, { count: 1 }, this.windowMs);
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  get trackedKeyCount(): number {
    return this.entries.trackedKeyCount;
  }
}

function normalizedIpHeaderValue(headerValue: string | undefined): string | null {
  const forwardedIpCandidate = headerValue?.split(',')[0]?.trim() || '';
  const ipVersion = isIP(forwardedIpCandidate);
  if (ipVersion === 0) return null;
  if (ipVersion === 4) return forwardedIpCandidate;
  if (forwardedIpCandidate.includes('%')) return null;
  return new URL(`http://[${forwardedIpCandidate}]`).hostname.slice(1, -1);
}

export function resolveClientIp(
  headers: Record<string, string | undefined>,
  trustProxyHeaders: boolean,
): string {
  if (!trustProxyHeaders) return SHARED_CLIENT_KEY;
  return normalizedIpHeaderValue(headers['x-forwarded-for'])
    || normalizedIpHeaderValue(headers['x-real-ip'])
    || SHARED_CLIENT_KEY;
}
