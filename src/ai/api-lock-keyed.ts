/*
 * API Call Lock (Per-Key)
 * Allows controlled parallelism: different keys can execute concurrently,
 * while calls sharing the same key remain serial.
 */

export class KeyedAPICallLock {
  private locks = new Map<string, Promise<void>>();
  private resolvers = new Map<string, (() => void) | null>();

  async acquire(key: string): Promise<() => void> {
    const k = key || 'default';

    // Wait for existing lock (if any)
    while (this.locks.has(k)) {
      await this.locks.get(k);
    }

    let release!: () => void;
    const p = new Promise<void>((resolve) => {
      release = () => {
        this.locks.delete(k);
        this.resolvers.delete(k);
        resolve();
      };
    });

    this.locks.set(k, p);
    this.resolvers.set(k, release);

    return release;
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** For observability */
  inProgressKeys(): string[] {
    return Array.from(this.locks.keys());
  }
}

export const globalKeyedApiLock = new KeyedAPICallLock();
