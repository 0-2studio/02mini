/**
 * Heartbeat Scheduler (Legacy)
 * Maintains backward compatibility while delegating to CronScheduler
 * 
 * NOTE: This file is kept for compatibility. New code should use CronScheduler directly.
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import type { CronScheduler } from '../cron/index.js';

export interface HeartbeatTask {
  name: string;
  interval: '5min' | 'hourly' | 'daily' | 'weekly';
  time?: string;
  action: string;
}

export class HeartbeatScheduler extends EventEmitter {
  private tasks: HeartbeatTask[] = [];
  private intervals: NodeJS.Timeout[] = [];
  private heartbeatPath: string;
  private cronScheduler?: CronScheduler;

  constructor(heartbeatPath: string) {
    super();
    this.heartbeatPath = heartbeatPath;
  }

  /**
   * Set the CronScheduler instance for integration
   */
  setCronScheduler(scheduler: CronScheduler): void {
    this.cronScheduler = scheduler;
    
    // Forward system events from cron to heartbeat
    scheduler.on('systemEvent', (event: string) => {
      console.log(`[Heartbeat] Received system event from cron`);
      this.emit('systemEvent', event);
    });

    scheduler.on('agentTurn', (job) => {
      console.log(`[Heartbeat] Agent turn triggered: ${job.name}`);
      this.emit('agentTurn', job);
    });

    // Forward legacy task events
    scheduler.on('job:triggered', (job) => {
      this.emit('task', {
        name: job.name,
        interval: 'cron',
        action: job.payload.kind === 'systemEvent' ? job.payload.text : job.payload.message,
      });
    });
  }

  async loadTasks(): Promise<void> {
    try {
      const content = await fs.readFile(this.heartbeatPath, 'utf-8');
      this.tasks = this.parseHeartbeatFile(content);
      console.log(`[Heartbeat] Loaded ${this.tasks.length} legacy tasks from heartbeat.md`);
      
      // Convert legacy tasks to cron jobs
      await this.convertLegacyTasks();
    } catch (error) {
      console.log('[Heartbeat] No heartbeat file found or error reading it');
      this.tasks = this.getDefaultTasks();
    }
  }

  /**
   * Convert legacy heartbeat tasks to cron jobs
   */
  private async convertLegacyTasks(): Promise<void> {
    if (!this.cronScheduler) return;

    for (const task of this.tasks) {
      // Check if already converted (by task name)
      const existing = this.cronScheduler.getJobs().find(j => j.name === `[Legacy] ${task.name}`);
      if (existing) continue;

      let schedule: any;
      
      switch (task.interval) {
        case '5min':
          schedule = { kind: 'every', everyMs: 5 * 60 * 1000 };
          break;
        case 'hourly':
          schedule = { kind: 'every', everyMs: 60 * 60 * 1000 };
          break;
        case 'daily':
          // Default to 09:00 if no time specified
          const time = task.time || '09:00';
          const [hour, minute] = time.split(':').map(Number);
          schedule = { kind: 'cron', expr: `${minute} ${hour} * * *` };
          break;
        case 'weekly':
          // Default to Sunday 10:00
          const [wHour, wMinute] = (task.time || '10:00').split(':').map(Number);
          schedule = { kind: 'cron', expr: `${wMinute} ${wHour} * * 0` };
          break;
        default:
          continue;
      }

      try {
        await this.cronScheduler.addJob({
          name: `[Legacy] ${task.name}`,
          description: `Converted from heartbeat.md: ${task.action}`,
          schedule,
          payload: {
            kind: 'systemEvent',
            text: `[Heartbeat] ${task.name}: ${task.action}`,
          },
          sessionTarget: 'main',
          wakeMode: 'next-heartbeat',
        });
        console.log(`[Heartbeat] Converted legacy task: ${task.name}`);
      } catch (error) {
        console.error(`[Heartbeat] Failed to convert task ${task.name}:`, error);
      }
    }
  }

  private parseHeartbeatFile(content: string): HeartbeatTask[] {
    const tasks: HeartbeatTask[] = [];
    const lines = content.split('\n');
    let currentInterval: string | null = null;
    let currentTime: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Parse interval headers
      if (trimmed.match(/^##\s+Every\s+\d+\s+Minutes/i)) {
        currentInterval = '5min';
        currentTime = null;
      } else if (trimmed.match(/^##\s+Hourly/i)) {
        currentInterval = 'hourly';
        currentTime = null;
      } else if (trimmed.match(/^##\s+Daily/i)) {
        currentInterval = 'daily';
        // Try to extract time from header like "Daily (09:00)"
        const timeMatch = trimmed.match(/\((\d{2}:\d{2})\)/);
        currentTime = timeMatch ? timeMatch[1] : '09:00';
      } else if (trimmed.match(/^##\s+Weekly/i)) {
        currentInterval = 'weekly';
        const timeMatch = trimmed.match(/\((\d{2}:\d{2})\)/);
        currentTime = timeMatch ? timeMatch[1] : '10:00';
      }

      // Parse task lines (bullet points)
      if (trimmed.startsWith('- ') && currentInterval) {
        const action = trimmed.slice(2).trim();
        tasks.push({
          name: action.split(':')[0] || action,
          interval: currentInterval as HeartbeatTask['interval'],
          time: currentTime || undefined,
          action: action,
        });
      }
    }

    return tasks;
  }

  private getDefaultTasks(): HeartbeatTask[] {
    return [
      {
        name: 'System Health Check',
        interval: 'hourly',
        action: 'Verify MCP connections and system status',
      },
    ];
  }

  start(): void {
    // Legacy timer-based scheduling is now handled by CronScheduler
    // This method is kept for backward compatibility
    console.log('[Heartbeat] Legacy scheduler started (delegating to CronScheduler)');
  }

  stop(): void {
    console.log('[Heartbeat] Legacy scheduler stopped');
  }

  getTasks(): HeartbeatTask[] {
    return [...this.tasks];
  }

  /**
   * Get pending system events from cron scheduler
   */
  getPendingSystemEvents(): string[] {
    if (!this.cronScheduler) return [];
    return this.cronScheduler.getPendingSystemEvents().map(e => e.text);
  }

  /**
   * Clear processed system events
   */
  clearSystemEvents(): void {
    if (this.cronScheduler) {
      this.cronScheduler.clearSystemEvents();
    }
  }
}