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
import { AutonomousQueueStoreManager } from './queue.js';
import { AutonomousActivityLog } from './activity-log.js';
import { AutonomousPolicyStore, type AutonomousPolicy } from './policy.js';
import { AutonomousStateStore, type AutonomousControlState, type AutonomousControlMode } from './state.js';
import { AutonomousCheckpointStore, type CheckpointEvent } from './checkpoint.js';

export class AutonomousRunner extends EventEmitter {
  private config: AutonomousConfig;
  private state: AutonomousState;
  private engine: CoreEngine;
  private cronScheduler: CronScheduler;
  private timer: NodeJS.Timeout | null = null;
  private handlers: ProactiveMessageHandler[] = [];
  private lastUserInteraction: number = Date.now();
  private heartbeatRunning: boolean = false;
  private agentTurnQueue: Promise<void> = Promise.resolve();
  private workQueue: AutonomousQueueStoreManager;
  private activityLog: AutonomousActivityLog;
  private policyStore: AutonomousPolicyStore;
  private controlState: AutonomousStateStore;
  private checkpointStore: AutonomousCheckpointStore;
  private policy?: AutonomousPolicy;
  private initialized = false;

  constructor(
    engine: CoreEngine,
    cronScheduler: CronScheduler,
    config?: Partial<AutonomousConfig>
  ) {
    super();

    this.config = { ...DEFAULT_AUTONOMOUS_CONFIG, ...config };
    this.engine = engine;
    this.cronScheduler = cronScheduler;
    const workingDir = engine.getWorkingDir();
    this.workQueue = new AutonomousQueueStoreManager(workingDir);
    this.activityLog = new AutonomousActivityLog(workingDir);
    this.policyStore = new AutonomousPolicyStore(workingDir);
    this.controlState = new AutonomousStateStore(workingDir);
    this.checkpointStore = new AutonomousCheckpointStore(workingDir);

    this.state = {
      enabled: this.config.enabled,
      consecutiveSilentHeartbeats: 0,
      consecutiveErrors: 0,
      currentIntervalMinutes: this.config.intervalMinutes,
      channelActivity: {},
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

    const scheduleNext = () => {
      const intervalMs = this.state.currentIntervalMinutes * 60 * 1000;
      this.state.nextHeartbeatAt = Date.now() + intervalMs;
      this.timer = setTimeout(async () => {
        this.timer = null;
        await this.runHeartbeat();
        if (this.config.enabled) scheduleNext();
      }, intervalMs);
    };

    void this.ensureInitialized().then(() => {
      console.log(`[Autonomous] Started with ${this.config.intervalMinutes}min interval (${this.config.autonomyLevel})`);
      console.log(`[Autonomous] Active hours: ${this.config.activeHours?.start || '00:00'} - ${this.config.activeHours?.end || '23:59'}`);
      return this.runHeartbeat();
    }).finally(() => {
      if (this.config.enabled && !this.timer) scheduleNext();
    });
  }

  /**
   * Stop the autonomous runner
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
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
    this.recordChannelActivity('cli');
    const control = this.controlState.get();
    if (control.mode === 'working') {
      void this.controlState.setMode('paused', 'Paused because a user interaction arrived during autonomous work', 'user-interaction', control.activeWorkId);
    }
  }

  recordChannelActivity(channel: 'cli' | 'gateway' | 'qq' | 'cron' | 'autonomous', session?: string): void {
    const current = this.state.channelActivity[channel] || { lastAt: 0, count: 0 };
    this.state.channelActivity[channel] = {
      lastAt: Date.now(),
      count: current.count + 1,
      lastSession: session || current.lastSession,
    };
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

    if (this.heartbeatRunning) {
      return {
        executed: false,
        reason: 'Heartbeat already running',
        timestamp: now,
      };
    }

    this.heartbeatRunning = true;

    try {
      await this.ensureInitialized();

      const control = this.controlState.get();
      if (control.mode === 'paused' || control.mode === 'blocked') {
        const reason = `Autonomous ${control.mode}: ${control.reason || 'no reason'}`;
        this.state.lastSkipReason = reason;
        this.adjustCadence('skip');
        await this.logActivity('skip', `Skipped heartbeat because state is ${control.mode}`, { reason: control.reason });
        await this.writeCheckpoint('skipped', { result: 'heartbeat skipped', nextStep: 'resume or unblock autonomous mode', blockedReason: reason });
        return { executed: false, reason, timestamp: now };
      }

      // Check if within active hours
      if (!this.isWithinActiveHours()) {
        this.state.lastSkipReason = 'Outside active hours';
        this.adjustCadence('skip');
        await this.logActivity('skip', 'Skipped heartbeat outside active hours');
        return {
          executed: false,
          reason: 'Outside active hours',
          timestamp: now,
        };
      }

      // Check rate limit
      if (this.isRateLimited()) {
        this.state.lastSkipReason = 'Rate limited';
        this.adjustCadence('skip');
        await this.logActivity('skip', 'Skipped heartbeat due to proactive rate limit');
        return {
          executed: false,
          reason: 'Rate limited',
          timestamp: now,
        };
      }

      // Check silence period after user response
      if (now - this.lastUserInteraction < this.config.silenceAfterResponse) {
        this.state.lastSkipReason = 'In silence period after user interaction';
        this.adjustCadence('skip');
        await this.logActivity('skip', 'Skipped heartbeat during user silence window');
        return {
          executed: false,
          reason: 'In silence period after user interaction',
          timestamp: now,
        };
      }

      console.log('[Autonomous] Running heartbeat check...');
      await this.logActivity('heartbeat', 'Heartbeat started', {
        autonomyLevel: this.config.autonomyLevel,
        interval: this.state.currentIntervalMinutes,
      });

      if (!this.controlState.isAuditOnly()) {
        await this.seedAutonomousWorkFromState();
      }
      const queueResult = await this.processDueWorkItem();
      if (queueResult) {
        this.state.lastHeartbeatAt = now;
        this.state.lastProactiveAt = now;
        this.state.lastDecision = 'work-queue';
        this.state.lastSkipReason = undefined;
        this.state.consecutiveSilentHeartbeats = 0;
        this.state.consecutiveErrors = 0;
        this.state.proactiveCountThisHour++;
        this.state.totalProactiveCount++;
        this.adjustCadence('active');

        const trigger: ProactiveTrigger = {
          type: 'event',
          reason: queueResult.reason,
          priority: 6,
          timestamp: now,
        };
        await this.emitProactive(queueResult.response, trigger);

        return {
          executed: true,
          response: queueResult.response,
          timestamp: now,
        };
      }

      if (this.controlState.isAuditOnly()) {
        this.state.lastSkipReason = 'Audit mode: proactive heartbeat work skipped';
        this.adjustCadence('skip');
        await this.logActivity('skip', 'Skipped proactive heartbeat in audit mode');
        await this.writeCheckpoint('skipped', { result: 'audit mode skip', nextStep: 'resume autonomous mode to allow work' });
        return { executed: false, reason: 'Audit mode', timestamp: now };
      }

      // Build heartbeat prompt
      const prompt = this.buildHeartbeatPrompt();

      if (!this.controlState.canStartWork()) {
        const current = this.controlState.get();
        const reason = `Autonomous mode ${current.mode} prevents proactive work`;
        await this.logActivity('skip', reason, { mode: current.mode, reason: current.reason });
        await this.writeCheckpoint('skipped', { result: 'proactive heartbeat skipped', nextStep: 'wait for idle/resume', blockedReason: reason });
        return { executed: false, reason, timestamp: now };
      }

      // Call engine
      await this.controlState.markWorking('heartbeat', 'Scheduled heartbeat proactive check');
      const response = await this.engine.processProactive(prompt);
      await this.controlState.markIdle('Heartbeat proactive check completed');

      this.state.lastHeartbeatAt = now;

      // Check if AI has something to say
      if (this.isSubstantiveResponse(response)) {
        this.state.lastProactiveAt = now;
        this.state.lastDecision = 'report';
        this.state.lastSkipReason = undefined;
        this.state.consecutiveSilentHeartbeats = 0;
        this.state.consecutiveErrors = 0;
        this.state.proactiveCountThisHour++;
        this.state.totalProactiveCount++;
        this.adjustCadence('active');

        const trigger: ProactiveTrigger = {
          type: 'heartbeat',
          reason: 'Scheduled heartbeat check',
          priority: 5,
          timestamp: now,
        };

        await this.emitProactive(response, trigger);

        console.log('[Autonomous] Proactive message sent');

        return {
          executed: true,
          response,
          timestamp: now,
        };
      }

      this.state.lastDecision = 'wait';
      this.state.lastSkipReason = undefined;
      this.state.consecutiveSilentHeartbeats++;
      this.state.consecutiveErrors = 0;
      this.adjustCadence('silent');
      await this.logActivity('heartbeat', 'Heartbeat completed with no action');

      return {
        executed: true,
        response: 'HEARTBEAT_OK',
        timestamp: now,
      };
    } catch (error) {
      console.error('[Autonomous] Heartbeat error:', error);
      this.state.consecutiveErrors++;
      this.state.lastDecision = 'error';
      this.state.lastSkipReason = error instanceof Error ? error.message : String(error);
      this.adjustCadence('error');
      await this.logActivity('queue-failed', 'Heartbeat failed', { error: this.state.lastSkipReason });
      await this.controlState.setMode('blocked', this.state.lastSkipReason || 'Heartbeat failed', 'autonomous');
      await this.writeCheckpoint('failed', { result: 'heartbeat failed', blockedReason: this.state.lastSkipReason });
      return {
        executed: false,
        reason: error instanceof Error ? error.message : String(error),
        timestamp: now,
      };
    } finally {
      this.heartbeatRunning = false;
    }
  }

  /**
   * Set up cron event listeners
   */
  private setupCronListeners(): void {
    // Listen for agent turn events
    this.cronScheduler.on('agentTurn', async (job) => {
      this.agentTurnQueue = this.agentTurnQueue.then(async () => {
        console.log(`[Autonomous] Cron agent turn: ${job.name}`);

        try {
          await this.logActivity('cron-agent-turn', `Cron agent turn started: ${job.name}`, { jobId: job.id });
          const control = this.controlState.get();
          if (control.mode === 'paused' || control.mode === 'blocked' || control.mode === 'audit') {
            await this.logActivity('skip', `Skipped cron agent turn because state is ${control.mode}`, { jobId: job.id, reason: control.reason });
            await this.writeCheckpoint('skipped', {
              activeWorkId: job.id,
              title: job.name,
              source: 'cron',
              result: 'cron agent turn skipped',
              nextStep: 'resume autonomous mode to allow cron agent turns',
              blockedReason: `${control.mode}: ${control.reason || 'no reason'}`,
            });
            return;
          }
          await this.controlState.markWorking(job.id, `Cron agent turn: ${job.name}`, 'cron');
          const response = await this.engine.handleAgentTurn(job);
          await this.controlState.markIdle(`Cron agent turn completed: ${job.name}`, 'cron');

        const trigger: ProactiveTrigger = {
          type: 'cron',
          reason: `Scheduled task: ${job.name}`,
          priority: 7,
          timestamp: Date.now(),
        };

          this.recordChannelActivity('cron', job.id);
          await this.emitProactive(response, trigger);
          await this.logActivity('cron-agent-turn', `Cron agent turn completed: ${job.name}`, { jobId: job.id });
          await this.writeCheckpoint('completed', {
            activeWorkId: job.id,
            title: job.name,
            source: 'cron',
            result: response,
            nextStep: 'none',
          });
        } catch (error) {
          console.error('[Autonomous] Cron agent turn error:', error);
          await this.logActivity('queue-failed', `Cron agent turn failed: ${job.name}`, {
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          });
          await this.controlState.setMode('blocked', error instanceof Error ? error.message : String(error), 'cron');
          await this.writeCheckpoint('failed', {
            activeWorkId: job.id,
            title: job.name,
            source: 'cron',
            result: 'cron agent turn failed',
            blockedReason: error instanceof Error ? error.message : String(error),
          });
        }
      });
    });

    // systemEvent reminders are consumed by CLI/CoreEngine via the pending event queue.
    // Do not also broadcast the raw event here, otherwise reminders appear twice.
  }

  /**
   * Build the heartbeat prompt with detailed system status
   */
  private buildHeartbeatPrompt(): string {
    const now = new Date();
    const template = this.config.heartbeatPrompt || DEFAULT_HEARTBEAT_PROMPT;

    // Get scheduled tasks info
    const jobs = this.cronScheduler.getJobs();
    const enabledJobs = jobs.filter((j) => j.enabled);
    const pendingJobs = jobs.filter((j) => {
      if (!j.enabled || !j.state.nextRunAtMs) return false;
      return j.state.nextRunAtMs <= Date.now();
    });

    // Find overdue jobs (should have run but haven't)
    const overdueJobs = jobs.filter((j) => {
      if (!j.enabled || !j.state.nextRunAtMs) return false;
      // Overdue if next run was more than 1 minute ago
      return j.state.nextRunAtMs < Date.now() - 60000;
    });
    const runtime = this.engine.getRuntimeStatus();
    const contextStats = this.engine.getContextStats();
    const contextPressure = this.describeContextPressure(contextStats.totalMessages);
    const queueSummary = this.workQueue.getSummary();

    const replacements: Record<string, string> = {
      time: now.toLocaleTimeString('zh-CN'),
      date: now.toLocaleDateString('zh-CN'),
      lastInteraction: this.formatDuration(Date.now() - this.lastUserInteraction),
      autonomyLevel: this.config.autonomyLevel,
      currentInterval: String(this.state.currentIntervalMinutes),
      silentCount: String(this.state.consecutiveSilentHeartbeats),
      errorCount: String(this.state.consecutiveErrors),
      contextPressure,
      runtimeStatus: `${runtime.model}, ${runtime.messages} messages, ${runtime.tools} tools, API ${runtime.api.active}/${runtime.api.maxConcurrent} active`,
      queueStatus: `${queueSummary.queued} queued, ${queueSummary.due} due, ${queueSummary.running} running, ${queueSummary.failed} failed`,
      scheduledTasks: enabledJobs.length > 0
        ? enabledJobs.map((j) => {
            const nextRun = j.state.nextRunAtMs 
              ? new Date(j.state.nextRunAtMs).toLocaleTimeString('zh-CN')
              : 'N/A';
            const status = j.state.nextRunAtMs && j.state.nextRunAtMs <= Date.now() ? ' [DUE]' : '';
            return `- ${j.name}: ${j.schedule.kind} (next: ${nextRun})${status}`;
          }).join('\n')
        : 'No scheduled tasks',
      pendingCount: String(pendingJobs.length),
      overdueCount: String(overdueJobs.length),
      totalJobs: String(jobs.length),
    };

    let prompt = template.replace(/\{\{(\w+)\}\}/g, (match, key) => replacements[key] || match);

    // Add explicit instructions for overdue jobs
    if (overdueJobs.length > 0) {
      prompt += `\n\n⚠️ OVERDUE JOBS DETECTED:\n`;
      overdueJobs.forEach(j => {
        prompt += `- "${j.name}" was scheduled for ${new Date(j.state.nextRunAtMs!).toLocaleString()}\n`;
      });
      prompt += `\nConsider notifying the user about these overdue items.`;
    }

    if (pendingJobs.length > 0) {
      prompt += `\n\n📋 JOBS DUE NOW:\n`;
      pendingJobs.forEach(j => {
        prompt += `- "${j.name}" (${j.payload.kind})\n`;
      });
    }

    prompt += `\n\n## AUTONOMOUS STATE\n`;
    prompt += `- Last decision: ${this.state.lastDecision || 'none'}\n`;
    prompt += `- Last skip reason: ${this.state.lastSkipReason || 'none'}\n`;
    prompt += `- Total proactive reports: ${this.state.totalProactiveCount}\n`;
    prompt += `- Proactive reports this hour: ${this.state.proactiveCountThisHour}/${this.config.maxProactivePerHour}\n`;
    prompt += `- Context messages: ${contextStats.totalMessages} (${contextStats.userMessages} user, ${contextStats.assistantMessages} assistant, ${contextStats.toolMessages} tool)\n`;
    prompt += `- Autonomous queue: ${queueSummary.queued} queued, ${queueSummary.due} due, ${queueSummary.failed} failed\n`;
    prompt += `- Channel activity: ${this.describeChannelActivity()}\n`;
    if (this.policy) {
      prompt += `- Policy goals: ${this.policy.goals.join(' | ')}\n`;
    }
    prompt += `\nDecision output: do useful autonomous work if justified by the state above; otherwise respond exactly HEARTBEAT_OK.`;

    return prompt;
  }

  getRuntimeStatus() {
    return {
      ...this.getState(),
      autonomyLevel: this.config.autonomyLevel,
      intervalMinutes: this.config.intervalMinutes,
      minIntervalMinutes: this.config.minIntervalMinutes,
      maxIntervalMinutes: this.config.maxIntervalMinutes,
      heartbeatRunning: this.heartbeatRunning,
      lastUserInteraction: this.lastUserInteraction,
      queue: this.workQueue.getSummary(),
      policy: this.policy || this.policyStore.get(),
      control: this.controlState.get(),
      checkpointPath: this.checkpointStore.getCurrentPath(),
    };
  }

  async setControlMode(mode: AutonomousControlMode, reason: string = '', updatedBy: string = 'user', activeWorkId?: string): Promise<AutonomousControlState> {
    await this.ensureInitialized();
    const state = await this.controlState.setMode(mode, reason, updatedBy, activeWorkId);
    await this.writeCheckpoint('skipped', {
      result: `mode changed to ${mode}`,
      nextStep: mode === 'idle' ? 'autonomous work may resume' : 'autonomous work will not advance',
      blockedReason: reason,
    });
    return state;
  }

  async pause(reason: string = 'Paused by user', updatedBy: string = 'user'): Promise<AutonomousControlState> {
    return this.setControlMode('paused', reason, updatedBy);
  }

  async resume(reason: string = 'Resumed by user', updatedBy: string = 'user'): Promise<AutonomousControlState> {
    return this.setControlMode('idle', reason, updatedBy);
  }

  async audit(reason: string = 'Audit mode by user', updatedBy: string = 'user'): Promise<AutonomousControlState> {
    return this.setControlMode('audit', reason, updatedBy);
  }

  async block(reason: string = 'Blocked by user', updatedBy: string = 'user'): Promise<AutonomousControlState> {
    return this.setControlMode('blocked', reason, updatedBy);
  }

  private lastProactiveFingerprint?: string;
  private lastProactiveFingerprintAt = 0;

  private async emitProactive(content: string, trigger: ProactiveTrigger): Promise<void> {
    const fingerprint = this.fingerprintProactive(content, trigger.reason);
    const now = Date.now();
    const duplicateWindowMs = (this.policy || this.policyStore.get()).reporting.duplicateWindowMs;
    if (this.lastProactiveFingerprint === fingerprint && now - this.lastProactiveFingerprintAt < duplicateWindowMs) {
      await this.logActivity('skip', 'Suppressed duplicate proactive message', { reason: trigger.reason });
      return;
    }

    this.lastProactiveFingerprint = fingerprint;
    this.lastProactiveFingerprintAt = now;
    this.notifyHandlers(content, trigger);
    this.emit('proactive', content, trigger);
    await this.logActivity('proactive', trigger.reason);
  }

  private fingerprintProactive(content: string, reason: string): string {
    return `${reason}\n${content}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
  }

  private describeChannelActivity(): string {
    const entries = Object.entries(this.state.channelActivity);
    if (entries.length === 0) return 'none';
    return entries
      .map(([channel, activity]) => `${channel}: ${activity.count} events, last ${this.formatDuration(Date.now() - activity.lastAt)} ago${activity.lastSession ? `, session ${activity.lastSession}` : ''}`)
      .join('; ');
  }

  getQueueItems() {
    return this.workQueue.getAll();
  }

  async getActivityLog(limit: number = 20) {
    await this.ensureInitialized();
    return this.activityLog.tail(limit);
  }

  async enqueueWork(input: {
    title: string;
    prompt: string;
    source?: 'heartbeat' | 'cron' | 'self-maintenance' | 'manual';
    priority?: number;
    delayMs?: number;
  }) {
    await this.ensureInitialized();
    return this.workQueue.enqueue({
      title: input.title,
      prompt: input.prompt,
      source: input.source || 'manual',
      priority: input.priority,
      delayMs: input.delayMs,
    });
  }

  async cancelWork(id: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.workQueue.cancel(id);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.workQueue.init();
    await this.activityLog.init();
    await this.policyStore.init();
    await this.controlState.init();
    await this.checkpointStore.init();
    this.policy = this.policyStore.get();
    this.initialized = true;
  }

  private async seedAutonomousWorkFromState(): Promise<void> {
    if (this.config.autonomyLevel === 'observe') return;

    const now = Date.now();
    const policy = this.policy || this.policyStore.get();
    const jobs = this.cronScheduler.getJobs();
    const overdueJobs = jobs.filter(job =>
      job.enabled &&
      job.state.nextRunAtMs !== undefined &&
      job.state.nextRunAtMs < now - 60_000
    );

    if (overdueJobs.length > 0) {
      await this.workQueue.enqueue({
        title: 'Review overdue scheduled jobs',
        source: 'self-maintenance',
        priority: 8,
        prompt: `[Autonomous Work]\nPolicy goals:\n${policy.goals.map(goal => `- ${goal}`).join('\n')}\n\nReview these overdue scheduled jobs and take useful maintenance action if safe. If no action is needed, summarize why.\n\n${overdueJobs.map(job => `- ${job.id}: ${job.name}, nextRunAt=${job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : 'none'}`).join('\n')}`,
        delayMs: policy.maintenance.overdueJobReviewDelayMs,
      });
      await this.logActivity('queue-enqueued', 'Enqueued overdue scheduled jobs review');
    }

    const contextStats = this.engine.getContextStats();
    if (contextStats.totalMessages > policy.maintenance.memoryReviewMessageThreshold) {
      await this.workQueue.enqueue({
        title: 'Review context pressure',
        source: 'self-maintenance',
        priority: 6,
        prompt: `[Autonomous Work]\nPolicy goals:\n${policy.goals.map(goal => `- ${goal}`).join('\n')}\n\nContext pressure is high (${contextStats.totalMessages} messages; threshold ${policy.maintenance.memoryReviewMessageThreshold}). Review whether memory should be summarized, stale context compacted, or maintenance scheduled. Act only with safe built-in tools.`,
      });
      await this.logActivity('queue-enqueued', 'Enqueued context pressure review');
    }

    const runtime = this.engine.getRuntimeStatus();
    if (runtime.mcpTools === 0) {
      await this.workQueue.enqueue({
        title: 'Investigate missing MCP tools',
        source: 'self-maintenance',
        priority: 7,
        prompt: `[Autonomous Work]\nNo MCP tools are currently available. Inspect system status and configuration if possible, then report likely cause and safe recovery steps.`,
        delayMs: policy.maintenance.toolHealthCheckDelayMs,
      });
      await this.logActivity('queue-enqueued', 'Enqueued missing MCP tools investigation');
    }

    const queueSummary = this.workQueue.getSummary();
    if (queueSummary.failed > 0) {
      await this.workQueue.enqueue({
        title: 'Summarize failed autonomous work',
        source: 'self-maintenance',
        priority: 5,
        prompt: `[Autonomous Work]\nThere are ${queueSummary.failed} failed autonomous work items. Review the queue state and summarize what failed, whether retry is useful, and any safe next action.`,
        delayMs: policy.maintenance.failedWorkReviewDelayMs,
      });
      await this.logActivity('queue-enqueued', 'Enqueued failed work summary');
    }
  }

  private async processDueWorkItem(): Promise<{ response: string; reason: string } | null> {
    if (this.config.autonomyLevel === 'observe') return null;
    const control = this.controlState.get();
    if (control.mode === 'paused' || control.mode === 'blocked' || control.mode === 'audit') {
      await this.logActivity('skip', `Skipped work queue because state is ${control.mode}`, { reason: control.reason });
      await this.writeCheckpoint('skipped', { result: 'work queue skipped', nextStep: 'resume autonomous mode', blockedReason: `${control.mode}: ${control.reason || 'no reason'}` });
      return null;
    }
    if (!this.controlState.canStartWork()) return null;
    const due = this.workQueue.getDue(1);
    const next = due[0];
    if (!next) return null;

    const running = await this.workQueue.markRunning(next.id);
    if (!running) return null;
    await this.controlState.markWorking(running.id, `Autonomous work started: ${running.title}`);
    await this.logActivity('queue-started', `Started autonomous work: ${running.title}`, { itemId: running.id }, running.id);
    await this.writeCheckpoint('started', {
      activeWorkId: running.id,
      title: running.title,
      source: running.source,
      prompt: running.prompt,
      result: 'started',
      nextStep: 'execute work item',
    });

    try {
      const beforeCall = this.controlState.get();
      if (beforeCall.mode !== 'working' || beforeCall.activeWorkId !== running.id) {
        await this.logActivity('skip', `Work item interrupted before execution: ${running.title}`, { itemId: running.id, mode: beforeCall.mode }, running.id);
        await this.writeCheckpoint('skipped', {
          activeWorkId: running.id,
          title: running.title,
          source: running.source,
          prompt: running.prompt,
          result: 'interrupted before execution',
          nextStep: 'resume if work should continue',
          blockedReason: beforeCall.reason,
        });
        return null;
      }
      const response = await this.engine.processProactive(
        `[Autonomous Work Queue Source id=${running.id} source=${running.source} priority=${running.priority}]\n` +
        `Title: ${running.title}\n` +
        `Attempt: ${running.attempts}/${running.maxAttempts}\n\n` +
        `${running.prompt}\n\n` +
        `Complete this work autonomously. If you perform useful work or find an issue, report concisely. If no user-visible report is needed, respond exactly HEARTBEAT_OK.`
      );

      await this.workQueue.markDone(running.id, response);
      await this.logActivity('queue-completed', `Completed autonomous work: ${running.title}`, { itemId: running.id }, running.id);
      await this.controlState.markIdle(`Autonomous work completed: ${running.title}`);
      await this.writeCheckpoint('completed', {
        activeWorkId: running.id,
        title: running.title,
        source: running.source,
        prompt: running.prompt,
        result: response,
        nextStep: 'none',
      });
      if (!this.isSubstantiveResponse(response)) return null;
      return { response, reason: `Autonomous work completed: ${running.title}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.workQueue.markFailed(running.id, message);
      await this.logActivity('queue-failed', `Failed autonomous work: ${running.title}`, { error: message }, running.id);
      await this.controlState.setMode('blocked', message, 'autonomous', running.id);
      await this.writeCheckpoint('failed', {
        activeWorkId: running.id,
        title: running.title,
        source: running.source,
        prompt: running.prompt,
        result: 'failed',
        nextStep: 'user review required',
        blockedReason: message,
      });
      throw error;
    }
  }

  private async logActivity(
    type: Parameters<AutonomousActivityLog['append']>[0]['type'],
    message: string,
    metadata?: Record<string, unknown>,
    itemId?: string
  ): Promise<void> {
    try {
      await this.activityLog.append({ type, message, metadata, itemId });
    } catch (error) {
      console.warn('[Autonomous] Failed to write activity log:', error);
    }
  }

  private async writeCheckpoint(
    event: CheckpointEvent,
    input: {
      activeWorkId?: string;
      title?: string;
      source?: string;
      prompt?: string;
      filesChanged?: string[] | 'unknown';
      validation?: string;
      result?: string;
      nextStep?: string;
      blockedReason?: string;
    } = {},
  ): Promise<void> {
    try {
      const current = this.controlState.get();
      const checkpointPath = await this.checkpointStore.write({
        event,
        mode: current.mode,
        activeWorkId: input.activeWorkId || current.activeWorkId,
        title: input.title,
        source: input.source,
        prompt: input.prompt,
        filesChanged: input.filesChanged || 'unknown',
        validation: input.validation || 'unknown',
        result: input.result,
        nextStep: input.nextStep,
        blockedReason: input.blockedReason,
      });
      await this.controlState.setLastCheckpointPath(checkpointPath);
    } catch (error) {
      console.warn('[Autonomous] Failed to write checkpoint:', error);
    }
  }

  private adjustCadence(outcome: 'active' | 'silent' | 'skip' | 'error'): void {
    const min = Math.max(1, this.config.minIntervalMinutes);
    const max = Math.max(min, this.config.maxIntervalMinutes);
    const base = Math.max(min, Math.min(max, this.config.intervalMinutes));

    if (outcome === 'active') {
      this.state.currentIntervalMinutes = min;
      return;
    }

    if (outcome === 'error') {
      this.state.currentIntervalMinutes = Math.min(max, Math.max(base, this.state.currentIntervalMinutes * 2));
      return;
    }

    if (outcome === 'skip') {
      this.state.currentIntervalMinutes = Math.min(max, Math.max(base, this.state.currentIntervalMinutes));
      return;
    }

    const silentBoost = Math.min(4, Math.floor(this.state.consecutiveSilentHeartbeats / 2));
    this.state.currentIntervalMinutes = Math.min(max, base + silentBoost * base);
  }

  private describeContextPressure(totalMessages: number): string {
    if (totalMessages > 120) return 'high';
    if (totalMessages > 60) return 'medium';
    return 'low';
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

    if (startMinutes <= endMinutes) {
      return currentTime >= startMinutes && currentTime <= endMinutes;
    }
    return currentTime >= startMinutes || currentTime <= endMinutes;
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
