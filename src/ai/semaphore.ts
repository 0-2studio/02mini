/**
 * Async Semaphore
 * Simple concurrency limiter for async operations.
 */

export class Semaphore {
  private permits: number;
  private queue: Array<(release: () => void) => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits | 0);
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push((release) => resolve(release));
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Directly hand off permit
      next(() => this.release());
      return;
    }
    this.permits++;
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
