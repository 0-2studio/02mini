/**
 * Cron Store
 * Persistent storage for cron jobs
 */

import fs from 'fs/promises';
import path from 'path';
import type { CronStore, CronJob } from './types.js';

const STORE_VERSION = 1;
const STORE_FILENAME = 'cron-store.json';

export class CronStoreManager {
  private storePath: string;
  private data: CronStore;
  private initialized: boolean = false;

  constructor(workingDir: string) {
    this.storePath = path.join(workingDir, 'memory', STORE_FILENAME);
    this.data = {
      version: STORE_VERSION,
      jobs: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Initialize the store, loading existing data if present
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const content = await fs.readFile(this.storePath, 'utf-8');
      const loaded = JSON.parse(content) as CronStore;
      
      // Validate version
      if (loaded.version !== STORE_VERSION) {
        console.log(`[CronStore] Version mismatch (${loaded.version} vs ${STORE_VERSION}), resetting`);
        await this.save();
      } else {
        this.data = loaded;
        console.log(`[CronStore] Loaded ${this.data.jobs.length} jobs`);
      }
    } catch (error) {
      // File doesn't exist or is corrupt, start fresh
      console.log('[CronStore] No existing store found, creating new');
      await this.save();
    }

    this.initialized = true;
  }

  /**
   * Save current state to disk
   */
  private async save(): Promise<void> {
    this.data.lastUpdated = new Date().toISOString();
    try {
      await fs.writeFile(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[CronStore] Failed to save:', error);
    }
  }

  /**
   * Get all jobs
   */
  getAllJobs(): CronJob[] {
    return [...this.data.jobs];
  }

  /**
   * Get a specific job by ID
   */
  getJob(id: string): CronJob | undefined {
    return this.data.jobs.find(j => j.id === id);
  }

  /**
   * Add a new job
   */
  async addJob(job: CronJob): Promise<void> {
    this.data.jobs.push(job);
    await this.save();
  }

  /**
   * Update an existing job
   */
  async updateJob(id: string, updates: Partial<CronJob>): Promise<CronJob | null> {
    const index = this.data.jobs.findIndex(j => j.id === id);
    if (index === -1) return null;

    this.data.jobs[index] = {
      ...this.data.jobs[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
    return this.data.jobs[index];
  }

  /**
   * Remove a job
   */
  async removeJob(id: string): Promise<boolean> {
    const initialLength = this.data.jobs.length;
    this.data.jobs = this.data.jobs.filter(j => j.id !== id);
    
    if (this.data.jobs.length !== initialLength) {
      await this.save();
      return true;
    }
    return false;
  }

  /**
   * Update job state
   */
  async updateJobState(id: string, state: Partial<CronJob['state']>): Promise<void> {
    const job = this.getJob(id);
    if (!job) return;

    job.state = { ...job.state, ...state };
    await this.save();
  }

  /**
   * Mark job as run (update run count and last run time)
   */
  async markJobRun(id: string, success: boolean, error?: string): Promise<void> {
    const job = this.getJob(id);
    if (!job) return;

    const now = Date.now();
    job.state.lastRunAtMs = now;
    job.state.lastRunResult = success ? 'success' : 'failure';
    job.state.runCount++;

    if (success) {
      job.state.consecutiveErrors = 0;
      job.state.lastError = undefined;
    } else {
      job.state.consecutiveErrors++;
      job.state.lastError = error;
      job.state.errorCount++;
    }

    await this.save();
  }

  /**
   * Clear all jobs
   */
  async clear(): Promise<void> {
    this.data.jobs = [];
    await this.save();
  }

  /**
   * Get store statistics
   */
  getStats(): { total: number; enabled: number; disabled: number; error: number } {
    return {
      total: this.data.jobs.length,
      enabled: this.data.jobs.filter(j => j.enabled).length,
      disabled: this.data.jobs.filter(j => !j.enabled).length,
      error: this.data.jobs.filter(j => j.state.consecutiveErrors > 0).length,
    };
  }
}
