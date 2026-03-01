/**
 * Cron Scheduler
 * Manages scheduled job execution
 * Based on OpenClaw's cron service
 */

import { EventEmitter } from 'events';
import type {
  CronJob,
  CronSchedule,
  CronJobCreate,
  CronJobUpdate,
  CronSchedulerEvents,
  PendingSystemEvent,
} from './types.js';
import { CronStoreManager } from './store.js';

// Error backoff schedule (in ms)
const ERROR_BACKOFF_MS = [
  30_000,      // 30 seconds
  60_000,      // 1 minute
  5 * 60_000,  // 5 minutes
  15 * 60_000, // 15 minutes
  60 * 60_000, // 60 minutes
];

// Maximum timer delay (Node.js setTimeout limit workaround)
const MAX_TIMER_DELAY_MS = 2_147_483_647; // ~24.8 days

export class CronScheduler extends EventEmitter {
  private store: CronStoreManager;
  private timer: NodeJS.Timeout | null = null;
  private systemEvents: PendingSystemEvent[] = [];
  private running: boolean = false;
  private executingJobs: Set<string> = new Set(); // Track jobs currently executing

  constructor(workingDir: string) {
    super();
    this.store = new CronStoreManager(workingDir);
  }

  /**
   * Initialize the scheduler
   */
  async init(): Promise<void> {
    await this.store.init();
    this.recomputeAllNextRuns();
    console.log('[CronScheduler] Initialized');
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) return;
    
    this.running = true;
    this.armTimer();
    console.log('[CronScheduler] Started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[CronScheduler] Stopped');
  }

  /**
   * Compute next run time for a schedule
   */
  computeNextRun(schedule: CronSchedule, fromMs: number = Date.now()): number | undefined {
    switch (schedule.kind) {
      case 'at': {
        const atMs = new Date(schedule.at).getTime();
        return atMs > fromMs ? atMs : undefined;
      }

      case 'every': {
        const everyMs = Math.max(1000, schedule.everyMs); // Minimum 1 second
        const anchor = schedule.anchorMs ?? fromMs;
        const elapsed = fromMs - anchor;
        // Calculate next occurrence strictly in the future
        const nextOffset = Math.floor(elapsed / everyMs) * everyMs + everyMs;
        const nextRun = anchor + nextOffset;
        // Ensure it's strictly after fromMs (at least 1ms buffer)
        return nextRun > fromMs ? nextRun : fromMs + everyMs;
      }

      case 'cron': {
        return this.computeNextCronRun(schedule.expr, schedule.tz, fromMs);
      }
    }
  }

  /**
   * Compute next run for cron expression (simplified)
   * Supports basic cron expressions: "* * * * *" (minute hour day month weekday)
   */
  private computeNextCronRun(expr: string, tz: string = 'Asia/Shanghai', fromMs: number): number | undefined {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
      console.error(`[CronScheduler] Invalid cron expression: ${expr}`);
      return undefined;
    }

    const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;
    
    // Start from the next minute
    const now = new Date(fromMs);
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    // Search for next match (max 4 years to avoid infinite loop)
    const maxIterations = 366 * 4 * 24 * 60;
    for (let i = 0; i < maxIterations; i++) {
      if (this.matchesCron(candidate, minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr)) {
        return candidate.getTime();
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    return undefined;
  }

  /**
   * Check if a date matches cron expression parts
   */
  private matchesCron(date: Date, minuteExpr: string, hourExpr: string, dayExpr: string, monthExpr: string, weekdayExpr: string): boolean {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1; // 1-12
    const weekday = date.getDay(); // 0-6, 0 is Sunday

    return this.matchesCronPart(minute, minuteExpr, 0, 59) &&
           this.matchesCronPart(hour, hourExpr, 0, 23) &&
           this.matchesCronPart(day, dayExpr, 1, 31) &&
           this.matchesCronPart(month, monthExpr, 1, 12) &&
           this.matchesCronPart(weekday, weekdayExpr, 0, 6);
  }

  /**
   * Check if a value matches a cron part expression
   */
  private matchesCronPart(value: number, expr: string, min: number, max: number): boolean {
    // Handle wildcard
    if (expr === '*') return true;

    // Handle step values (e.g., */5)
    if (expr.startsWith('*/')) {
      const step = parseInt(expr.slice(2), 10);
      return value % step === 0;
    }

    // Handle ranges (e.g., 1-5)
    if (expr.includes('-')) {
      const [start, end] = expr.split('-').map(Number);
      return value >= start && value <= end;
    }

    // Handle lists (e.g., 1,3,5)
    if (expr.includes(',')) {
      const values = expr.split(',').map(Number);
      return values.includes(value);
    }

    // Single value
    const num = parseInt(expr, 10);
    return value === num;
  }

  /**
   * Recompute next run time for all enabled jobs
   */
  private recomputeAllNextRuns(): void {
    const now = Date.now();
    const jobs = this.store.getAllJobs();

    for (const job of jobs) {
      if (job.enabled && !job.state.nextRunAtMs) {
        const nextRun = this.computeNextRun(job.schedule, now);
        if (nextRun) {
          job.state.nextRunAtMs = nextRun;
        }
      }
    }
  }

  /**
   * Arm the timer for next job execution
   */
  private armTimer(): void {
    if (!this.running) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const now = Date.now();
    const nextAt = this.getNextWakeTime();

    if (!nextAt || nextAt > now + MAX_TIMER_DELAY_MS) {
      // No pending jobs or too far in future, check again in 1 minute
      this.timer = setTimeout(() => this.armTimer(), 60_000);
      return;
    }

    const delay = Math.max(nextAt - now, 0);
    console.log(`[CronScheduler] Next job in ${Math.round(delay / 1000)}s`);

    this.timer = setTimeout(() => {
      void this.onTimer().catch(err => {
        console.error('[CronScheduler] Timer error:', err);
      });
    }, delay);
  }

  /**
   * Get the next time we need to wake up
   */
  private getNextWakeTime(): number | undefined {
    const jobs = this.store.getAllJobs().filter(j => j.enabled);
    const now = Date.now();

    // If any enabled job is already due (or overdue), wake immediately.
    // This prevents "stuck" states where all nextRunAtMs are <= now and the
    // scheduler would otherwise sleep for 60s.
    for (const job of jobs) {
      const jobNext = job.state.nextRunAtMs;
      if (jobNext !== undefined && jobNext <= now) {
        return now;
      }
    }

    let nextTime: number | undefined;
    for (const job of jobs) {
      const jobNext = job.state.nextRunAtMs;
      if (jobNext !== undefined && jobNext > now) {
        if (!nextTime || jobNext < nextTime) {
          nextTime = jobNext;
        }
      }
    }

    return nextTime;
  }

  /**
   * Handle timer tick - check and execute due jobs
   */
  private async onTimer(): Promise<void> {
    if (!this.running) return;

    const now = Date.now();
    // Filter: enabled, has nextRunAtMs, time is due, and not currently executing
    const dueJobs = this.store.getAllJobs().filter(j =>
      j.enabled &&
      j.state.nextRunAtMs &&
      j.state.nextRunAtMs <= now &&
      !this.executingJobs.has(j.id) // Skip if already executing
    );

    for (const job of dueJobs) {
      // Mark as executing before starting
      this.executingJobs.add(job.id);
      try {
        await this.executeJob(job);
      } finally {
        // Always remove from executing set when done
        this.executingJobs.delete(job.id);
      }
    }

    // Re-arm timer for next check
    this.armTimer();
  }

  /**
   * Execute a job
   */
  private async executeJob(job: CronJob): Promise<void> {
    const executeStartTime = Date.now();
    console.log(`[CronScheduler] Executing job: ${job.name} at ${new Date(executeStartTime).toISOString()}`);

    // CRITICAL: Clear nextRunAtMs BEFORE execution to prevent re-selection
    // This ensures even if execution takes long, the job won't be picked up again
    await this.store.updateJobState(job.id, { nextRunAtMs: undefined });

    this.emit('job:triggered', job);

    try {
      // Handle different payload types
      if (job.payload.kind === 'systemEvent') {
        // Add to system events queue
        this.systemEvents.push({
          text: job.payload.text,
          timestamp: Date.now(),
          jobId: job.id,
        });
        this.emit('systemEvent', job.payload.text);
      } else if (job.payload.kind === 'agentTurn') {
        // Emit for AI to handle
        this.emit('agentTurn', job);
      }

      // Mark as run
      await this.store.markJobRun(job.id, true);

      // Delete if one-time
      if (job.deleteAfterRun) {
        await this.store.removeJob(job.id);
        console.log(`[CronScheduler] Removed one-time job: ${job.name}`);
      } else {
        // Compute next run based on execution completion time
        const afterExecuteTime = Date.now();
        const nextRun = this.computeNextRun(job.schedule, afterExecuteTime);
        if (nextRun) {
          // Ensure nextRun is strictly in the future
          const safeNextRun = Math.max(nextRun, afterExecuteTime + 1000); // At least 1 second in future
          await this.store.updateJobState(job.id, { nextRunAtMs: safeNextRun });
          console.log(`[CronScheduler] Job ${job.name} next run at ${new Date(safeNextRun).toISOString()}`);
        } else {
          // No next run (e.g., past at-schedule), disable it
          await this.store.updateJob(job.id, { enabled: false });
          console.log(`[CronScheduler] Job ${job.name} disabled (no future runs)`);
        }
      }

      this.emit('job:completed', job, true);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CronScheduler] Job ${job.name} failed:`, errorMsg);

      await this.store.markJobRun(job.id, false, errorMsg);

      // Apply error backoff
      const backoffIndex = Math.min(job.state.consecutiveErrors, ERROR_BACKOFF_MS.length - 1);
      const backoffMs = ERROR_BACKOFF_MS[backoffIndex];
      const retryAt = Date.now() + backoffMs;

      await this.store.updateJobState(job.id, { nextRunAtMs: retryAt });

      this.emit('job:completed', job, false, errorMsg);
    }
  }

  // ==================== Public API ====================

  /**
   * Add a new job
   */
  async addJob(create: CronJobCreate): Promise<CronJob> {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // Normalize schedule (e.g., set anchor for "every" to prevent drift)
    const normalizedSchedule: CronSchedule =
      create.schedule.kind === 'every'
        ? {
            ...create.schedule,
            anchorMs: create.schedule.anchorMs ?? nowMs,
          }
        : create.schedule;

    const job: CronJob = {
      id,
      name: create.name,
      description: create.description || '',
      enabled: create.enabled ?? true,
      // Default: "at" schedules are one-time and should delete after run.
      deleteAfterRun:
        create.deleteAfterRun ?? (normalizedSchedule.kind === 'at' ? true : false),
      schedule: normalizedSchedule,
      sessionTarget: create.sessionTarget || 'main',
      wakeMode: create.wakeMode || 'now',
      payload: create.payload,
      state: {
        enabled: create.enabled ?? true,
        runCount: 0,
        errorCount: 0,
        consecutiveErrors: 0,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // Compute initial next run
    const nextRun = this.computeNextRun(job.schedule);
    if (nextRun) {
      job.state.nextRunAtMs = nextRun;
    }

    await this.store.addJob(job);
    this.emit('job:added', job);
    
    // Re-arm timer to pick up new job
    this.armTimer();
    
    return job;
  }

  /**
   * Update a job
   */
  async updateJob(id: string, updates: CronJobUpdate): Promise<CronJob | null> {
    const existing = this.store.getJob(id);
    if (!existing) return null;

    // If schedule changed, recompute next run
    if (updates.schedule) {
      // Normalize schedule updates (e.g., keep/set anchor for "every")
      if (updates.schedule.kind === 'every') {
        const existingAnchor =
          existing.schedule.kind === 'every' ? existing.schedule.anchorMs : undefined;
        updates.schedule = {
          ...updates.schedule,
          anchorMs: updates.schedule.anchorMs ?? existingAnchor ?? Date.now(),
        };
      }

      const nextRun = this.computeNextRun(updates.schedule);
      updates.state = { ...existing.state, nextRunAtMs: nextRun };
    }

    const updated = await this.store.updateJob(id, updates);
    if (updated) {
      this.emit('job:updated', updated);
      this.armTimer();
    }
    return updated;
  }

  /**
   * Remove a job
   */
  async removeJob(id: string): Promise<boolean> {
    const removed = await this.store.removeJob(id);
    if (removed) {
      this.emit('job:removed', id);
      this.armTimer();
    }
    return removed;
  }

  /**
   * Get all jobs
   */
  getJobs(): CronJob[] {
    return this.store.getAllJobs();
  }

  /**
   * Get a specific job
   */
  getJob(id: string): CronJob | undefined {
    return this.store.getJob(id);
  }

  /**
   * Run a job immediately (manual trigger)
   */
  async runJobNow(id: string): Promise<boolean> {
    const job = this.store.getJob(id);
    if (!job) return false;

    await this.executeJob(job);
    return true;
  }

  /**
   * Get pending system events
   */
  getPendingSystemEvents(): PendingSystemEvent[] {
    return [...this.systemEvents];
  }

  /**
   * Clear system events
   */
  clearSystemEvents(): void {
    this.systemEvents = [];
  }

  /**
   * Get scheduler status
   */
  getStatus(): { running: boolean; jobs: number; nextRun?: number } {
    return {
      running: this.running,
      jobs: this.store.getAllJobs().length,
      nextRun: this.getNextWakeTime(),
    };
  }
}
