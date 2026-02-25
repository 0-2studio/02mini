/**
 * API Call Limiter
 * Controls concurrency of upstream AI API calls.
 *
 * NOTE:
 * - Previously this was a strict global mutex (single-thread).
 * - Now it is a semaphore so multiple sessions can call the API concurrently,
 *   while still capping overall concurrency to reduce rate-limit pressure.
 */

class APICallLock {
  private readonly maxConcurrent: number;
  private active: number = 0;
  private waiters: Array<() => void> = [];

  constructor(maxConcurrent: number = 1) {
    // Safety clamp
    const n = Number.isFinite(maxConcurrent) ? Math.floor(maxConcurrent) : 1;
    this.maxConcurrent = Math.max(1, n);
  }

  /**
   * Acquire one concurrency slot.
   */
  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return () => this.release();
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });

    // Woken up -> take slot
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  /**
   * Check if any API call is currently in progress
   */
  isInProgress(): boolean {
    return this.active > 0;
  }

  /**
   * Execute a function with concurrency limiting.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// Global singleton instance
// Default concurrency = 3 (tunable via AI_MAX_CONCURRENT)
export const globalApiLock = new APICallLock(parseInt(process.env.AI_MAX_CONCURRENT || '3', 10));
