/**
 * Heartbeat Scheduler
 * Manages scheduled tasks
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export interface HeartbeatTask {
  name: string;
  interval: '5min' | 'hourly' | 'daily' | 'weekly';
  time?: string; // For daily/weekly: "09:00"
  action: string;
}

export class HeartbeatScheduler extends EventEmitter {
  private tasks: HeartbeatTask[] = [];
  private intervals: NodeJS.Timeout[] = [];
  private heartbeatPath: string;

  constructor(heartbeatPath: string) {
    super();
    this.heartbeatPath = heartbeatPath;
  }

  async loadTasks(): Promise<void> {
    try {
      const content = await fs.readFile(this.heartbeatPath, 'utf-8');
      this.tasks = this.parseHeartbeatFile(content);
      console.log(`[Heartbeat] Loaded ${this.tasks.length} tasks`);
    } catch (error) {
      console.log('[Heartbeat] No heartbeat file found, using defaults');
      this.tasks = this.getDefaultTasks();
    }
  }

  private parseHeartbeatFile(content: string): HeartbeatTask[] {
    const tasks: HeartbeatTask[] = [];
    const lines = content.split('\n');
    let currentInterval: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Parse interval headers
      if (trimmed.match(/^##\s+Every\s+\d+\s+Minutes/i)) {
        currentInterval = '5min';
      } else if (trimmed.match(/^##\s+Hourly/i)) {
        currentInterval = 'hourly';
      } else if (trimmed.match(/^##\s+Daily/i)) {
        currentInterval = 'daily';
        // Try to extract time from header like "Daily (09:00)"
        const timeMatch = trimmed.match(/\((\d{2}:\d{2})\)/);
        if (timeMatch) {
          // Store time for tasks under this section
        }
      } else if (trimmed.match(/^##\s+Weekly/i)) {
        currentInterval = 'weekly';
      }

      // Parse task lines (bullet points)
      if (trimmed.startsWith('- ') && currentInterval) {
        const action = trimmed.slice(2).trim();
        tasks.push({
          name: action.split(':')[0] || action,
          interval: currentInterval as HeartbeatTask['interval'],
          action: action,
        });
      }
    }

    return tasks;
  }

  private getDefaultTasks(): HeartbeatTask[] {
    return [
      {
        name: 'Check User Input',
        interval: '5min',
        action: 'Check if user has sent new messages',
      },
      {
        name: 'System Health',
        interval: 'hourly',
        action: 'Verify MCP connections and system status',
      },
      {
        name: 'Morning Routine',
        interval: 'daily',
        action: 'Read yesterday\'s log, write reflection, review skills',
      },
    ];
  }

  start(): void {
    console.log('[Heartbeat] Starting scheduler...');

    // 5-minute interval
    const fiveMinInterval = setInterval(() => {
      this.runTasks('5min');
    }, 5 * 60 * 1000);
    this.intervals.push(fiveMinInterval);

    // Hourly interval
    const hourlyInterval = setInterval(() => {
      this.runTasks('hourly');
    }, 60 * 60 * 1000);
    this.intervals.push(hourlyInterval);

    // Check daily tasks every minute
    const dailyCheck = setInterval(() => {
      this.checkDailyTasks();
    }, 60 * 1000);
    this.intervals.push(dailyCheck);

    // Check weekly tasks every hour
    const weeklyCheck = setInterval(() => {
      this.checkWeeklyTasks();
    }, 60 * 60 * 1000);
    this.intervals.push(weeklyCheck);

    console.log('[Heartbeat] Scheduler started');
  }

  private runTasks(interval: HeartbeatTask['interval']): void {
    const tasksToRun = this.tasks.filter(t => t.interval === interval);
    
    for (const task of tasksToRun) {
      console.log(`[Heartbeat] Running task: ${task.name}`);
      this.emit('task', task);
    }
  }

  private checkDailyTasks(): void {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    // Check for tasks at this time (default to 09:00 if not specified)
    const dailyTasks = this.tasks.filter(t => {
      if (t.interval !== 'daily') return false;
      // Simple check - run at 09:00 by default
      return timeStr === '09:00';
    });

    for (const task of dailyTasks) {
      console.log(`[Heartbeat] Running daily task: ${task.name}`);
      this.emit('task', task);
    }
  }

  private checkWeeklyTasks(): void {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    const hours = now.getHours();

    // Run on Sunday at 10:00
    if (day === 0 && hours === 10) {
      const weeklyTasks = this.tasks.filter(t => t.interval === 'weekly');
      for (const task of weeklyTasks) {
        console.log(`[Heartbeat] Running weekly task: ${task.name}`);
        this.emit('task', task);
      }
    }
  }

  stop(): void {
    console.log('[Heartbeat] Stopping scheduler...');
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }

  getTasks(): HeartbeatTask[] {
    return [...this.tasks];
  }
}
