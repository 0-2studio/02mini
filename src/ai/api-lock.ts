/**
 * API Call Lock
 * Ensures single-threaded API calls across the entire application
 * Prevents parallel API calls that could cause rate limiting issues
 */

class APICallLock {
  private currentLock: Promise<void> = Promise.resolve();
  private isLocked: boolean = false;

  /**
   * Acquire the API call lock
   * Waits if another call is in progress
   */
  async acquire(): Promise<() => void> {
    // Wait for current lock to release
    while (this.isLocked) {
      await this.currentLock;
    }

    // Acquire lock
    this.isLocked = true;
    let release: () => void;
    this.currentLock = new Promise<void>((resolve) => {
      release = () => {
        this.isLocked = false;
        resolve();
      };
    });

    return release!;
  }

  /**
   * Check if an API call is currently in progress
   */
  isInProgress(): boolean {
    return this.isLocked;
  }

  /**
   * Execute a function with the API lock
   * Automatically acquires and releases the lock
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
export const globalApiLock = new APICallLock();
