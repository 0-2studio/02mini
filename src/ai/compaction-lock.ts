/**
 * Global Compaction Lock
 * Ensures single-threaded access during context compaction and memory review.
 * 
 * When compaction is running:
 * - No new messages can be added
 * - No AI calls should read the messages
 * - Memory files should not be modified
 */

class CompactionLock {
  private locked: boolean = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });

    this.locked = true;
    return () => this.release();
  }

  private release(): void {
    this.locked = false;
    const next = this.waiters.shift();
    if (next) next();
  }

  isLocked(): boolean {
    return this.locked;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// Global singleton - enforces single-threaded compaction across all sessions
export const globalCompactionLock = new CompactionLock();
