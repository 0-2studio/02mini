/**
 * Autonomous Runner
 * Manages proactive AI behavior including heartbeat checks
 */

import { EventEmitter } from 'events';
import type { CoreEngine } from '../core/engine.js';
import type { CronScheduler } from '../cron/index.js';
import type {
  AutonomousConfig,
  AutonomousState,
  ProactiveTrigger,
  HeartbeatResult,
  ProactiveMessageHandler,
} from './types.js';
import {
  DEFAULT_AUTONOMOUS_CONFIG,
  DEFAULT_HEARTBEAT_PROMPT,
} from './types.js';

export class AutonomousRunner extends EventEmitter {
  private config: AutonomousConfig;
  private state: AutonomousState;
  private engine: CoreEngine;
  private cronScheduler: CronScheduler;
  private timer: NodeJS.Timeout | null = null;
  private handlers: ProactiveMessageHandler[] = [];
  private lastUserInteraction: number = Date.now();

  constructor(
    engine: CoreEngine,
    cronScheduler: CronScheduler,
    config?: Partial<AutonomousConfig>
  ) {
    super();

    this.config = { ...DEFAULT_AUTONOMOUS_CONFIG, ...config };
    this.engine = engine;
    this.cronScheduler = cronScheduler;

    this.state = {
      enabled: this.config.enabled,
      proactiveCountThisHour: 0,
      hourStartTime: Date.now(),
      totalProactiveCount: 0,
    };

    // Bind to cron events
    this.setupCronListeners();
  }

  /**
   * Start the autonomous runner
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('[Autonomous] Disabled, not starting');
      return;
    }

    if (this.timer) {
      console.log('[Autonomous] Already running');
      return;
    }

    // Schedule regular heartbeat
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => this.runHeartbeat(), intervalMs);

    console.log(`[Autonomous] Started with ${this.config.intervalMinutes}min interval`);
    console.log(`[Autonomous] Active hours: ${this.config.activeHours?.start || '00:00'} - ${this.config.activeHours?.end || '23:59'}`);

    // Run initial heartbeat
    this.runHeartbeat();
  }

  /**
   * Stop the autonomous runner
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Autonomous] Stopped');
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutonomousConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    // Handle enable/disable transition
    if (!wasEnabled && this.config.enabled) {
      this.start();
    } else if (wasEnabled && !this.config.enabled) {
      this.stop();
    }
  }

  /**
   * Register a handler for proactive messages
   */
  onProactiveMessage(handler: ProactiveMessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index > -1) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /**
   * Record user interaction (resets silence timer)
   */
  recordUserInteraction(): void {
    this.lastUserInteraction = Date.now();
  }

  /**
   * Get current state
   */
  getState(): AutonomousState {
    // Reset hourly counter if needed
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    if (now - this.state.hourStartTime > hourMs) {
      this.state.proactiveCountThisHour = 0;
      this.state.hourStartTime = now;
    }

    return { ...this.state };
  }

  /**
   * Execute a heartbeat check
   */
  async runHeartbeat(): Promise<HeartbeatResult> {
    const now = Date.now();

    // Check if within active hours
    if (!this.isWithinActiveHours()) {
      return {
        executed: false,
        reason: 'Outside active hours',
        timestamp: now,
      };
    }

    // Check rate limit
    if (this.isRateLimited()) {
      return {
        executed: false,
        reason: 'Rate limited',
        timestamp: now,
      };
    }

    // Check silence period after user response
    if (now - this.lastUserInteraction < this.config.silenceAfterResponse) {
      return {
        executed: false,
        reason: 'In silence period after user interaction',
        timestamp: now,
      };
    }

    console.log('[Autonomous] Running heartbeat check...');

    try {
      // Build heartbeat prompt
      const prompt = this.buildHeartbeatPrompt();

      // Call engine
      const response = await this.engine.processProactive(prompt);

      this.state.lastHeartbeatAt = now;

      // Check if AI has something to say
      if (this.isSubstantiveResponse(response)) {
        this.state.lastProactiveAt = now;
        this.state.proactiveCountThisHour++;
        this.state.totalProactiveCount++;

        const trigger: ProactiveTrigger = {
          type: 'heartbeat',
          reason: 'Scheduled heartbeat check',
          priority: 5,
          timestamp: now,
        };

        // Notify handlers
        this.notifyHandlers(response, trigger);

        // Emit event
        this.emit('proactive', response, trigger);

        console.log('[Autonomous] Proactive message sent');

        return {
          executed: true,
          response,
          timestamp: now,
        };
      }

      return {
        executed: true,
        response: 'HEARTBEAT_OK',
        timestamp: now,
      };
    } catch (error) {
      console.error('[Autonomous] Heartbeat error:', error);
      return {
        executed: false,
        reason: error instanceof Error ? error.message : String(error),
        timestamp: now,
      };
    }
  }

  /**
   * Set up cron event listeners
   */
  private setupCronListeners(): void {
    // Listen for agent turn events
    this.cronScheduler.on('agentTurn', async (job) => {
      console.log(`[Autonomous] Cron agent turn: ${job.name}`);

      try {
        const response = await this.engine.handleAgentTurn(job);

        const trigger: ProactiveTrigger = {
          type: 'cron',
          reason: `Scheduled task: ${job.name}`,
          priority: 7,
          timestamp: Date.now(),
        };

        this.notifyHandlers(response, trigger);
        this.emit('proactive', response, trigger);
      } catch (error) {
        console.error('[Autonomous] Cron agent turn error:', error);
      }
    });

    // Listen for system events
    this.cronScheduler.on('systemEvent', (text) => {
      console.log(`[Autonomous] System event: ${text.slice(0, 50)}...`);

      const trigger: ProactiveTrigger = {
        type: 'event',
        reason: 'System event triggered',
        priority: 6,
        timestamp: Date.now(),
      };

      this.notifyHandlers(text, trigger);
      this.emit('proactive', text, trigger);
    });
  }

  /**
   * Build the heartbeat prompt
   */
  private buildHeartbeatPrompt(): string {
    const now = new Date();
    const template = this.config.heartbeatPrompt || DEFAULT_HEARTBEAT_PROMPT;

    // Get scheduled tasks info
    const jobs = this.cronScheduler.getJobs();
    const enabledJobs = jobs.filter((j) => j.enabled);

    const replacements: Record<string, string> = {
      time: now.toLocaleTimeString('zh-CN'),
      date: now.toLocaleDateString('zh-CN'),
      lastInteraction: this.formatDuration(Date.now() - this.lastUserInteraction),
      scheduledTasks: enabledJobs.length > 0
        ? enabledJobs.map((j) => `- ${j.name} (${j.schedule.kind})`).join('\n')
        : 'None',
    };

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => replacements[key] || match);
  }

  /**
   * Check if response is substantive (not just HEARTBEAT_OK)
   */
  private isSubstantiveResponse(response: string): boolean {
    const trimmed = response.trim();

    // Check for HEARTBEAT_OK variants
    if (trimmed === 'HEARTBEAT_OK') return false;
    if (trimmed === '[HEARTBEAT_OK]') return false;
    if (trimmed.toLowerCase().includes('heartbeat_ok')) return false;

    // Check for empty or very short responses
    if (trimmed.length < 10) return false;

    return true;
  }

  /**
   * Check if within active hours
   */
  private isWithinActiveHours(): boolean {
    if (!this.config.activeHours) return true;

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = this.config.activeHours.start.split(':').map(Number);
    const [endHour, endMin] = this.config.activeHours.end.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    return currentTime >= startMinutes && currentTime <= endMinutes;
  }

  /**
   * Check if rate limited
   */
  private isRateLimited(): boolean {
    // Reset counter if hour has passed
    const hourMs = 60 * 60 * 1000;
    if (Date.now() - this.state.hourStartTime > hourMs) {
      this.state.proactiveCountThisHour = 0;
      this.state.hourStartTime = Date.now();
    }

    return this.state.proactiveCountThisHour >= this.config.maxProactivePerHour;
  }

  /**
   * Notify all registered handlers
   */
  private notifyHandlers(content: string, trigger: ProactiveTrigger): void {
    for (const handler of this.handlers) {
      try {
        handler(content, trigger);
      } catch (error) {
        console.error('[Autonomous] Handler error:', error);
      }
    }
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}