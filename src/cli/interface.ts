/**
 * CLI Interface
 * Beautiful command line interface for 02
 */

import readline from 'readline';
import { CoreEngine, hasMessageMarker } from '../core/engine.js';
import { MCPManager, mcpManager } from '../mcp/manager.js';
import { SkillRegistry } from '../skills-impl/skill-registry.js';
import { AIClient } from '../ai/client.js';
import { CronScheduler } from '../cron/index.js';
import type { AutonomousRunner } from '../autonomous/index.js';
import type { ProactiveTrigger } from '../autonomous/types.js';
import type { QQAdapter, QQConfigManager } from '../qq/index.js';
import type { KukeChatAdapter } from '../kukechat/index.js';
import fs from 'fs/promises';
import path from 'path';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  
  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Helper functions
const c = (text: string, color: keyof typeof colors) => `${colors[color]}${text}${colors.reset}`;
const bold = (text: string) => c(text, 'bright');
const dim = (text: string) => c(text, 'dim');

export class CLIInterface {
  private rl?: readline.Interface;
  private engine?: CoreEngine;
  private mcpManager: MCPManager;
  private skillRegistry: SkillRegistry;
  private workingDir: string;
  private cronScheduler: CronScheduler;
  private qqAdapter: QQAdapter | null = null;
  private qqConfigManager: QQConfigManager | null = null;
  private kukeChatAdapter: KukeChatAdapter | null = null;
  private autonomousRunner: AutonomousRunner | null = null;
  private planMode = false;

  // Callbacks for external integrations
  onEngineReady?: (engine: CoreEngine) => Promise<void> | void;
  onUserInteraction?: () => void;
  onShutdownRequested?: () => Promise<void> | void;

  constructor(workingDir: string, cronScheduler: CronScheduler) {
    this.workingDir = workingDir;
    this.cronScheduler = cronScheduler;
    this.mcpManager = mcpManager;
    this.skillRegistry = new SkillRegistry(path.join(workingDir, 'skills'));
  }

  async start(): Promise<void> {
    console.clear();
    
    // Beautiful header
    this.printHeader();
    
    // Initialize
    await this.initialize();
    
    // Print help hint
    console.log(dim('\nTip: /help for commands, /doctor for readiness, /plan on for plan-first work\n'));

    // Auto-trigger memory review at startup
    console.log(c('🧠 Reviewing memories at startup...\n', 'brightYellow'));
    
    // CRITICAL: Pause QQ message processing during memory review
    this.qqAdapter?.pause();
    
    const memoryReviewPrompt = `[Task: Review Memories]\n\n` +
      `Please read the following memory files to understand context:\n` +
      `1. memory/user-profile.md - User preferences and important details\n` +
      `2. memory/daily-logs/ (most recent) - Recent activities\n` +
      `3. memory/self-reflections/ (most recent) - Lessons learned\n` +
      `4. memory/knowledge/ (relevant to upcoming tasks)\n\n` +
      `After reading, provide a brief summary of key information.\n` +
      `Use file-system tools to read these files, then reply "NO" when done.`;
    await this.processInput(memoryReviewPrompt);
    
    // Resume QQ message processing after memory review
    this.qqAdapter?.resume();

    // Start CLI
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: c('\n❯ ', 'brightCyan') + ' ',
    });

    this.rl.prompt();
    
    // Track if we're currently processing
    let isProcessing = false;
    let abortController: AbortController | null = null;
    
    // Handle keypress for ESC
    process.stdin.on('keypress', (str, key) => {
      if (key.name === 'escape' && isProcessing && abortController) {
        console.log(dim('\n\n[Interrupted by user]'));
        abortController.abort();
      }
    });
    
    // Enable keypress events
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      readline.emitKeypressEvents(process.stdin);
    }
    
    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      
      if (trimmed === '') {
        this.rl?.prompt();
        return;
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        await this.handleCommand(trimmed);
        this.rl?.prompt();
        return;
      }

      // Process regular input
      if (this.engine) {
        // Record user interaction
        this.onUserInteraction?.();

        isProcessing = true;
        abortController = new AbortController();

        try {
          this.showThinking();
          console.log(dim('\n(Press ESC to interrupt)'));
          
          const response = await this.engine.processUserInput(this.decorateCliInput(trimmed), abortController.signal);
          this.hideThinking();

          if (!abortController.signal.aborted) {
            // Skip display if response is marked as already shown (via cli-bridge)
            if (response && !hasMessageMarker(response)) {
              this.printResponse(response);
            }
          }
        } catch (error) {
          this.hideThinking();
          if ((error as Error).name === 'AbortError') {
            console.log(dim('\n[Response interrupted]'));
          } else {
            this.printError(error instanceof Error ? error.message : String(error));
          }
        } finally {
          isProcessing = false;
          abortController = null;
        }
      }

      this.rl?.prompt();
    });

    this.rl.on('close', () => {
      this.shutdown();
    });
  }

  private printHeader(): void {
    const width = 50;
    const line = '─'.repeat(width);
    
    console.log();
    console.log(c('  ╭' + line + '╮', 'brightCyan'));
    console.log(c('  │', 'brightCyan') + ' '.repeat(width) + c('│', 'brightCyan'));
    console.log(c('  │', 'brightCyan') + c('     🤖 02 - Self-Aware AI System'.padEnd(width), 'brightWhite') + c('│', 'brightCyan'));
    console.log(c('  │', 'brightCyan') + c('        Your Intelligent Assistant'.padEnd(width), 'dim') + c('│', 'brightCyan'));
    console.log(c('  │', 'brightCyan') + ' '.repeat(width) + c('│', 'brightCyan'));
    console.log(c('  ╰' + line + '╯', 'brightCyan'));
    console.log();
  }

  private async initialize(): Promise<void> {
    console.log(c('🔌 Initializing system...\n', 'brightYellow'));

    // Load MCP
    console.log(dim('  • Connecting to MCP servers...'));
    await this.mcpManager.initialize();

    // Discover skills
    console.log(dim('  • Discovering skills...'));
    await this.skillRegistry.discoverSkills();

    // Initialize AI client
    console.log(dim('  • Initializing AI client...'));
    const aiClient = AIClient.fromEnv();
    console.log(c(`  ✓ AI Model: ${aiClient.getModel()}`, 'green'));

    // Create engine
    console.log(dim('  • Starting core engine...'));
    this.engine = new CoreEngine({
      messages: [],
      mcpManager: this.mcpManager,
      skillRegistry: this.skillRegistry,
      workingDir: this.workingDir,
      aiClient,
      cronScheduler: this.cronScheduler,
    });

    // Register cli-bridge handler to display messages immediately
    this.engine.setCliBridgeHandler((message) => {
      this.printCliBridgeMessage(message);
    });

    // Listen for cron events and forward to engine
    this.cronScheduler.on('systemEvent', async () => {
      if (this.engine) {
        const responses = await this.engine.handleSystemEvents();
        for (const response of responses) {
          this.printResponse(response);
        }
        this.rl?.prompt();
      }
    });

    // Note: agentTurn events are handled by AutonomousRunner, not CLI
    // This avoids duplicate execution of scheduled tasks

    // Show status
    await this.printStatus();

    // Notify that engine is ready
    if (this.onEngineReady) {
      await this.onEngineReady(this.engine);
    }
  }

  private async printStatus(): Promise<void> {
    const skills = this.skillRegistry.getAllSkills();
    const servers = this.mcpManager.getConnectedServers();
    const tools = this.mcpManager.getAllTools();

    console.log();
    console.log(c('┌─ System Status ─────────────────────────┐', 'brightBlue'));
    console.log(c('│', 'brightBlue') + `  ${c('✓', 'brightGreen')} ${skills.length.toString().padStart(2)} Skills Loaded          ${c('│', 'brightBlue')}`);
    console.log(c('│', 'brightBlue') + `  ${c('✓', 'brightGreen')} ${servers.length.toString().padStart(2)} MCP Servers Connected  ${c('│', 'brightBlue')}`);
    console.log(c('│', 'brightBlue') + `  ${c('✓', 'brightGreen')} ${tools.length.toString().padStart(2)} Tools Available        ${c('│', 'brightBlue')}`);
    console.log(c('│', 'brightBlue') + `  ${this.planMode ? c('PLAN', 'brightYellow') : c('CHAT', 'brightGreen')} CLI Mode              ${c('│', 'brightBlue')}`);
    console.log(c('└─────────────────────────────────────────┘', 'brightBlue'));
    console.log();

    // Show tools if available
    if (tools.length > 0) {
      console.log(c('Available Tools:', 'brightMagenta'));
      for (const { server, tool } of tools.slice(0, 6)) {
        console.log(`  ${c('•', 'brightCyan')} ${tool.name} ${dim(`(${server})`)}`);
      }
      if (tools.length > 6) {
        console.log(dim(`  ... and ${tools.length - 6} more`));
      }
      console.log();
    }

    console.log(c('Ready for conversation.\n', 'brightGreen'));
  }

  /**
   * Process input through the engine (used for auto-triggered actions)
   */
  private async processInput(input: string): Promise<void> {
    if (!this.engine) {
      console.log(c('⚠️ Engine not initialized', 'brightRed'));
      return;
    }

    this.showThinking();

    try {
      const response = await this.engine.processUserInput(input);
      this.hideThinking();

      // Skip display if response is marked as already shown (via cli-bridge)
      if (response && !hasMessageMarker(response)) {
        this.printResponse(response);
      }
    } catch (error) {
      this.hideThinking();
      this.printError(error instanceof Error ? error.message : String(error));
    }
  }

  private async handleCommand(cmd: string): Promise<void> {
    const parts = cmd.split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/exit':
      case '/quit':
        await this.shutdown();
        break;
      
      case '/help':
        this.printHelp();
        break;
      
      case '/skills':
        this.listSkills();
        break;
      
      case '/mcp':
      case '/tools':
        this.listMCPTools();
        break;
      
      case '/status':
        await this.printStatus();
        break;

      case '/runtime':
        this.showRuntimeStatus();
        break;

      case '/doctor':
        await this.runDoctor();
        break;

      case '/jobs':
        await this.handleJobsCommand(parts.slice(1));
        break;

      case '/autonomous':
      case '/auto':
        await this.handleAutonomousCommand(parts.slice(1));
        break;

      case '/plan':
        this.handlePlanCommand(parts.slice(1));
        break;
      
      case '/clear':
        console.clear();
        this.printHeader();
        break;
      
      case '/read':
        if (parts[1]) {
          const filePath = parts.slice(1).join(' ');
          await this.readFile(filePath);
        } else {
          this.printError('Usage: /read <filepath>');
        }
        break;
      
      case '/memory':
        await this.handleMemoryCommand(parts.slice(1));
        break;
      
      case '/reset':
        await this.resetAI();
        break;

      case '/context':
        await this.showContextStatus();
        break;

      case '/compact':
        await this.compactContext();
        break;

      case '/qq':
        await this.handleQQCommand(parts.slice(1));
        break;

      case '/kukechat':
      case '/kuke':
        this.showKukeChatStatus();
        break;

      default:
        this.printError(`Unknown command: ${command}`);
        console.log(dim('Type /help for available commands'));
    }
  }

  private printHelp(): void {
    console.log();
    console.log(c('┌─ Commands ──────────────────────────────┐', 'brightBlue'));
    this.printHelpRow('Core', '/help, /clear, /exit');
    this.printHelpRow('Inspect', '/status, /runtime, /doctor, /context');
    this.printHelpRow('Tools', '/tools, /mcp, /skills, /read <file>');
    this.printHelpRow('Memory', '/memory list|read|search, /compact');
    this.printHelpRow('Agent', '/auto, /plan on|off|status, /jobs');
    this.printHelpRow('Chat', '/qq status, /kuke status');
    this.printHelpRow('Danger', '/reset');
    console.log(c('└─────────────────────────────────────────┘', 'brightBlue'));
    console.log(dim('Recommended: use /plan on before risky multi-step changes, then /plan off to execute.'));
    console.log();
  }

  private printHelpRow(label: string, text: string): void {
    const row = `  ${label.padEnd(7)} ${text}`.slice(0, 39).padEnd(39);
    console.log(c('│', 'brightBlue') + row + c('│', 'brightBlue'));
  }

  private decorateCliInput(input: string): string {
    const marker = this.planMode ? '[CLI Source mode=plan]' : '[CLI Source mode=chat]';
    if (!this.planMode) return `${marker}\n${input}`;

    return `${marker}\n[Plan Mode Instruction]\nCreate a concise plan, identify risks and files likely to change, and ask for confirmation before modifying files, running destructive commands, or changing persistent configuration. You may inspect files and status to make the plan accurate.\n\n${input}`;
  }

  private handlePlanCommand(args: string[]): void {
    const action = (args[0] || 'status').toLowerCase();

    if (action === 'on') {
      this.planMode = true;
      console.log(c('Plan Mode enabled. User turns will request a plan before changes.', 'brightYellow'));
      return;
    }

    if (action === 'off') {
      this.planMode = false;
      console.log(c('Plan Mode disabled. Normal execution mode restored.', 'brightGreen'));
      return;
    }

    if (action === 'status') {
      console.log(this.planMode ? c('Plan Mode: on', 'brightYellow') : c('Plan Mode: off', 'brightGreen'));
      return;
    }

    this.printError('Usage: /plan on|off|status');
  }

  private showRuntimeStatus(): void {
    if (!this.engine) {
      this.printError('Engine not initialized');
      return;
    }

    const runtime = this.engine.getRuntimeStatus();
    const cron = this.cronScheduler.getStatus();
    const qq = this.qqAdapter?.getStatus();

    console.log();
    console.log(c('┌─ Runtime ───────────────────────────────┐', 'brightCyan'));
    this.printBoxRow('Model', runtime.model, 'brightCyan');
    this.printBoxRow('CLI Mode', this.planMode ? 'plan' : 'chat', 'brightCyan');
    this.printBoxRow('Messages', String(runtime.messages), 'brightCyan');
    this.printBoxRow('Tools', `${runtime.tools} total, ${runtime.mcpTools} MCP`, 'brightCyan');
    this.printBoxRow('API', `${runtime.api.active}/${runtime.api.maxConcurrent} active, waiting ${runtime.api.waiting}`, 'brightCyan');
    this.printBoxRow('Keyed Locks', String(runtime.keyedApiLocks), 'brightCyan');
    this.printBoxRow('Compaction', runtime.compactionInProgress ? 'running' : 'idle', 'brightCyan');
    this.printBoxRow('Cron', `${cron.running ? 'running' : 'stopped'}, ${cron.jobs} jobs`, 'brightCyan');
    this.printBoxRow('QQ', qq ? `${qq.running ? 'running' : 'stopped'}, ${qq.sessions} sessions` : 'not initialized', 'brightCyan');
    console.log(c('└─────────────────────────────────────────┘', 'brightCyan'));
    console.log();
  }

  private async runDoctor(): Promise<void> {
    const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
    const memoryPath = path.join(this.workingDir, 'memory');
    const skillsPath = path.join(this.workingDir, 'skills');

    checks.push({ label: 'AI key', ok: Boolean(process.env.AI_API_KEY), detail: process.env.AI_API_KEY ? 'configured' : 'missing AI_API_KEY' });
    checks.push({ label: 'AI model', ok: Boolean(process.env.AI_MODEL), detail: process.env.AI_MODEL || 'using client default' });
    checks.push({ label: 'Engine', ok: Boolean(this.engine), detail: this.engine ? 'ready' : 'not initialized' });
    checks.push({ label: 'MCP servers', ok: this.mcpManager.getConnectedServers().length > 0, detail: `${this.mcpManager.getConnectedServers().length} connected` });
    checks.push({ label: 'Tools', ok: this.mcpManager.getAllTools().length > 0, detail: `${this.mcpManager.getAllTools().length} MCP tools` });
    checks.push({ label: 'Skills', ok: this.skillRegistry.getAllSkills().length > 0, detail: `${this.skillRegistry.getAllSkills().length} loaded` });
    checks.push({ label: 'Memory dir', ok: await this.pathExists(memoryPath), detail: memoryPath });
    checks.push({ label: 'Skills dir', ok: await this.pathExists(skillsPath), detail: skillsPath });
    checks.push({ label: 'Cron', ok: this.cronScheduler.getStatus().running, detail: `${this.cronScheduler.getStatus().jobs} jobs` });

    if (this.qqConfigManager) {
      const config = this.qqConfigManager.getConfig();
      const status = this.qqAdapter?.getStatus();
      checks.push({ label: 'QQ', ok: !config.enabled || Boolean(status?.running), detail: config.enabled ? (status?.running ? 'running' : 'enabled but not running') : 'disabled' });
    } else {
      checks.push({ label: 'QQ', ok: true, detail: 'not initialized' });
    }

    console.log();
    console.log(c('┌─ Doctor ────────────────────────────────┐', 'brightYellow'));
    for (const check of checks) {
      const icon = check.ok ? c('✓', 'brightGreen') : c('!', 'brightRed');
      this.printBoxRow(`${icon} ${check.label}`, check.detail, 'brightYellow');
    }
    console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
    console.log();
  }

  private async handleJobsCommand(args: string[]): Promise<void> {
    const action = (args[0] || 'list').toLowerCase();
    const jobId = args[1];

    switch (action) {
      case 'list':
      case 'status':
        this.listCronJobs();
        return;

      case 'run': {
        if (!jobId) {
          this.printError('Usage: /jobs run <id>');
          return;
        }
        const ok = await this.cronScheduler.runJobNow(jobId);
        console.log(ok ? c(`Job started: ${jobId}`, 'brightGreen') : c(`Job not found or already running: ${jobId}`, 'brightRed'));
        return;
      }

      case 'pause':
      case 'resume': {
        if (!jobId) {
          this.printError(`Usage: /jobs ${action} <id>`);
          return;
        }
        const updated = await this.cronScheduler.updateJob(jobId, { enabled: action === 'resume' });
        console.log(updated ? c(`Job ${action === 'resume' ? 'resumed' : 'paused'}: ${jobId}`, 'brightGreen') : c(`Job not found: ${jobId}`, 'brightRed'));
        return;
      }

      case 'remove':
      case 'delete': {
        if (!jobId) {
          this.printError('Usage: /jobs remove <id>');
          return;
        }
        const removed = await this.cronScheduler.removeJob(jobId);
        console.log(removed ? c(`Job removed: ${jobId}`, 'brightGreen') : c(`Job not found: ${jobId}`, 'brightRed'));
        return;
      }

      case 'help':
        this.printJobsHelp();
        return;

      default:
        this.printError(`Unknown /jobs command: ${action}`);
        this.printJobsHelp();
    }
  }

  private listCronJobs(): void {
    const jobs = this.cronScheduler.getJobs();
    const executing = new Set(this.cronScheduler.getExecutingJobs());

    console.log();
    console.log(c('┌─ Scheduled Jobs ────────────────────────┐', 'brightYellow'));
    if (jobs.length === 0) {
      this.printBoxRow('Jobs', 'none', 'brightYellow');
    } else {
      for (const job of jobs.slice(0, 10)) {
        const state = executing.has(job.id) ? 'running' : job.enabled ? 'enabled' : 'paused';
        const next = this.formatNextRun(job.state.nextRunAtMs);
        this.printBoxRow(job.id, `${state}, ${job.name}, ${next}`, 'brightYellow');
      }
      if (jobs.length > 10) this.printBoxRow('More', `${jobs.length - 10} additional jobs`, 'brightYellow');
    }
    console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
    console.log(dim('Use /jobs run|pause|resume|remove <id>'));
    console.log();
  }

  private printJobsHelp(): void {
    console.log();
    console.log(c('┌─ Jobs Commands ─────────────────────────┐', 'brightYellow'));
    this.printBoxRow('/jobs list', 'show scheduled jobs', 'brightYellow');
    this.printBoxRow('/jobs run <id>', 'trigger a job now', 'brightYellow');
    this.printBoxRow('/jobs pause <id>', 'disable a job', 'brightYellow');
    this.printBoxRow('/jobs resume <id>', 'enable a job', 'brightYellow');
    this.printBoxRow('/jobs remove <id>', 'delete a job', 'brightYellow');
    console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
    console.log();
  }

  private async handleAutonomousCommand(args: string[]): Promise<void> {
    if (!this.autonomousRunner) {
      this.printError('Autonomous runner not initialized');
      return;
    }

    const action = (args[0] || 'status').toLowerCase();
    switch (action) {
      case 'status':
        this.showAutonomousStatus();
        return;

      case 'queue':
        this.showAutonomousQueue();
        return;

      case 'log':
      case 'activity':
        await this.showAutonomousActivityLog();
        return;

      case 'cancel': {
        const id = args[1];
        if (!id) {
          this.printError('Usage: /auto cancel <id>');
          return;
        }
        const cancelled = await this.autonomousRunner.cancelWork(id);
        console.log(cancelled ? c(`Autonomous work cancelled: ${id}`, 'brightGreen') : c(`Work item not cancellable: ${id}`, 'brightRed'));
        return;
      }

      case 'help':
        this.printAutonomousHelp();
        return;

      default:
        this.printError(`Unknown /auto command: ${action}`);
        this.printAutonomousHelp();
    }
  }

  private showAutonomousStatus(): void {
    if (!this.autonomousRunner) return;
    const status = this.autonomousRunner.getRuntimeStatus();
    const next = status.nextHeartbeatAt ? new Date(status.nextHeartbeatAt).toLocaleString() : 'not scheduled';

    console.log();
    console.log(c('┌─ Autonomous ────────────────────────────┐', 'brightMagenta'));
    this.printBoxRow('Enabled', String(status.enabled), 'brightMagenta');
    this.printBoxRow('Level', status.autonomyLevel, 'brightMagenta');
    this.printBoxRow('Interval', `${status.currentIntervalMinutes}m (${status.minIntervalMinutes}-${status.maxIntervalMinutes}m)`, 'brightMagenta');
    this.printBoxRow('Next', next, 'brightMagenta');
    this.printBoxRow('Decision', status.lastDecision || 'none', 'brightMagenta');
    this.printBoxRow('Silent/Error', `${status.consecutiveSilentHeartbeats}/${status.consecutiveErrors}`, 'brightMagenta');
    this.printBoxRow('Queue', `${status.queue.queued} queued, ${status.queue.due} due, ${status.queue.failed} failed`, 'brightMagenta');
    this.printBoxRow('Policy', `${status.policy.goals.length} goals, memory>${status.policy.maintenance.memoryReviewMessageThreshold}`, 'brightMagenta');
    console.log(c('└─────────────────────────────────────────┘', 'brightMagenta'));
    console.log(dim('Use /auto queue to inspect work items.'));
    console.log();
  }

  private showAutonomousQueue(): void {
    if (!this.autonomousRunner) return;
    const items = this.autonomousRunner.getQueueItems();

    console.log();
    console.log(c('┌─ Autonomous Queue ──────────────────────┐', 'brightMagenta'));
    if (items.length === 0) {
      this.printBoxRow('Items', 'none', 'brightMagenta');
    } else {
      for (const item of items.slice(0, 10)) {
        const next = item.status === 'queued' ? this.formatNextRun(item.nextRunAtMs) : item.status;
        this.printBoxRow(item.id, `${item.status}, p${item.priority}, ${next}`, 'brightMagenta');
        console.log(dim(`  ${item.title.slice(0, 100)}`));
      }
      if (items.length > 10) this.printBoxRow('More', `${items.length - 10} additional items`, 'brightMagenta');
    }
    console.log(c('└─────────────────────────────────────────┘', 'brightMagenta'));
    console.log();
  }

  private printAutonomousHelp(): void {
    console.log();
    console.log(c('┌─ Autonomous Commands ───────────────────┐', 'brightMagenta'));
    this.printBoxRow('/auto status', 'show autonomous runtime', 'brightMagenta');
    this.printBoxRow('/auto queue', 'show autonomous work queue', 'brightMagenta');
    this.printBoxRow('/auto log', 'show recent activity log', 'brightMagenta');
    this.printBoxRow('/auto cancel <id>', 'cancel queued/running work', 'brightMagenta');
    console.log(c('└─────────────────────────────────────────┘', 'brightMagenta'));
    console.log();
  }

  private async showAutonomousActivityLog(): Promise<void> {
    if (!this.autonomousRunner) return;
    const entries = await this.autonomousRunner.getActivityLog(12);

    console.log();
    console.log(c('┌─ Autonomous Activity ───────────────────┐', 'brightMagenta'));
    if (entries.length === 0) {
      this.printBoxRow('Entries', 'none', 'brightMagenta');
    } else {
      for (const entry of entries) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        this.printBoxRow(time, `${entry.type}: ${entry.message}`, 'brightMagenta');
      }
    }
    console.log(c('└─────────────────────────────────────────┘', 'brightMagenta'));
    console.log();
  }

  private formatNextRun(nextRunAtMs?: number): string {
    if (!nextRunAtMs) return 'no next run';
    const deltaMs = nextRunAtMs - Date.now();
    const when = new Date(nextRunAtMs).toLocaleString();
    if (deltaMs < 0) return `overdue ${Math.round(Math.abs(deltaMs) / 1000)}s, ${when}`;
    if (deltaMs < 60_000) return `in ${Math.round(deltaMs / 1000)}s, ${when}`;
    if (deltaMs < 3_600_000) return `in ${Math.round(deltaMs / 60_000)}m, ${when}`;
    return `in ${Math.round(deltaMs / 3_600_000)}h, ${when}`;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private printBoxRow(label: string, value: string, color: keyof typeof colors): void {
    const plain = `${label}: ${value}`.replace(/\s+/g, ' ');
    console.log(c('│', color) + `  ${plain.slice(0, 37).padEnd(39)}` + c('│', color));
  }

  private listSkills(): void {
    const skills = this.skillRegistry.getAllSkills();
    console.log();
    console.log(c('┌─ Available Skills ──────────────────────┐', 'brightMagenta'));
    
    for (const skill of skills) {
      const name = skill.name.padEnd(15);
      console.log(c('│', 'brightMagenta') + `  ${c('•', 'brightCyan')} ${c(name, 'brightWhite')}${c('│', 'brightMagenta')}`);
      console.log(c('│', 'brightMagenta') + `    ${dim(skill.description.slice(0, 35))}${c('│', 'brightMagenta')}`);
      if (skill !== skills[skills.length - 1]) {
        console.log(c('│', 'brightMagenta') + ' '.repeat(41) + c('│', 'brightMagenta'));
      }
    }
    
    console.log(c('└─────────────────────────────────────────┘', 'brightMagenta'));
    console.log();
  }

  private listMCPTools(): void {
    const tools = this.mcpManager.getAllTools();
    console.log();
    console.log(c('┌─ Available MCP Tools ───────────────────┐', 'brightCyan'));
    
    for (const { server, tool } of tools) {
      const name = `${server}_${tool.name}`.slice(0, 25).padEnd(25);
      console.log(c('│', 'brightCyan') + `  ${c('•', 'brightGreen')} ${name}${c('│', 'brightCyan')}`);
    }
    
    console.log(c('└─────────────────────────────────────────┘', 'brightCyan'));
    console.log();
  }

  private async handleMemoryCommand(args: string[]): Promise<void> {
    const action = (args[0] || 'list').toLowerCase();

    switch (action) {
      case 'list':
        await this.listMemoryFiles();
        return;

      case 'read': {
        const target = args.slice(1).join(' ');
        if (!target) {
          this.printError('Usage: /memory read <relative-path>');
          return;
        }
        await this.readMemoryFile(target);
        return;
      }

      case 'search': {
        const query = args.slice(1).join(' ').trim();
        if (!query) {
          this.printError('Usage: /memory search <query>');
          return;
        }
        await this.searchMemoryFiles(query);
        return;
      }

      case 'help':
        this.printMemoryHelp();
        return;

      default:
        this.printError(`Unknown /memory command: ${action}`);
        this.printMemoryHelp();
    }
  }

  private async listMemoryFiles(): Promise<void> {
    const memoryPath = path.join(this.workingDir, 'memory');
    
    try {
      const entries = await fs.readdir(memoryPath, { withFileTypes: true });
      console.log();
      console.log(c('┌─ Memory Files ──────────────────────────┐', 'brightYellow'));
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          console.log(c('│', 'brightYellow') + `  ${c('📁', 'brightBlue')} ${entry.name.padEnd(33)}${c('│', 'brightYellow')}`);
        } else if (entry.name.endsWith('.md')) {
          console.log(c('│', 'brightYellow') + `  ${c('📝', 'brightGreen')} ${entry.name.padEnd(33)}${c('│', 'brightYellow')}`);
        }
      }
      
      console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
      console.log(dim('Use /memory read <file> or /memory search <query>'));
      console.log();
    } catch (error) {
      this.printError('Failed to read memory directory');
    }
  }

  private async readMemoryFile(relativePath: string): Promise<void> {
    const resolved = this.resolveMemoryPath(relativePath);
    if (!resolved) {
      this.printError('Memory path must stay inside memory/');
      return;
    }

    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        this.printError('Memory path is not a file');
        return;
      }

      const content = await fs.readFile(resolved, 'utf8');
      console.log();
      console.log(c('┌─ Memory File ───────────────────────────┐', 'brightYellow'));
      this.printBoxRow('Path', path.relative(path.join(this.workingDir, 'memory'), resolved), 'brightYellow');
      console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
      console.log(content.slice(0, 12_000));
      if (content.length > 12_000) console.log(dim('\n[truncated after 12000 characters]'));
      console.log();
    } catch (error) {
      this.printError(error instanceof Error ? error.message : String(error));
    }
  }

  private async searchMemoryFiles(query: string): Promise<void> {
    const memoryPath = path.join(this.workingDir, 'memory');
    const files = await this.listMarkdownFiles(memoryPath);
    const normalizedQuery = query.toLowerCase();
    const matches: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(normalizedQuery)) {
            matches.push({
              file: path.relative(memoryPath, file),
              line: i + 1,
              text: lines[i].trim(),
            });
            if (matches.length >= 20) break;
          }
        }
      } catch {
        // Ignore unreadable memory files and continue showing useful matches.
      }
      if (matches.length >= 20) break;
    }

    console.log();
    console.log(c('┌─ Memory Search ─────────────────────────┐', 'brightYellow'));
    this.printBoxRow('Query', query, 'brightYellow');
    this.printBoxRow('Matches', String(matches.length), 'brightYellow');
    console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
    for (const match of matches) {
      console.log(`${c('•', 'brightCyan')} ${match.file}:${match.line} ${dim(match.text.slice(0, 120))}`);
    }
    if (matches.length === 0) console.log(dim('No matches.'));
    if (matches.length >= 20) console.log(dim('Showing first 20 matches.'));
    console.log();
  }

  private printMemoryHelp(): void {
    console.log();
    console.log(c('┌─ Memory Commands ───────────────────────┐', 'brightYellow'));
    this.printBoxRow('/memory list', 'show top-level memory files', 'brightYellow');
    this.printBoxRow('/memory read <file>', 'read a file under memory/', 'brightYellow');
    this.printBoxRow('/memory search <query>', 'search markdown memories', 'brightYellow');
    console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
    console.log();
  }

  private resolveMemoryPath(relativePath: string): string | null {
    const memoryRoot = path.resolve(this.workingDir, 'memory');
    const resolved = path.resolve(memoryRoot, relativePath);
    if (resolved !== memoryRoot && !resolved.startsWith(memoryRoot + path.sep)) return null;
    return resolved;
  }

  private async listMarkdownFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await fs.readdir(root, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        result.push(...await this.listMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(fullPath);
      }
    }

    return result;
  }

  private async readFile(filePath: string): Promise<void> {
    console.log();
    console.log(dim(`Reading: ${filePath}`));
    
    try {
      const result = await this.mcpManager.callTool('read_file', { path: filePath });
      
      if (result.isError) {
        this.printError(result.content[0]?.text || 'Unknown error');
      } else {
        console.log();
        console.log(c('┌─ File Content ──────────────────────────┐', 'brightBlue'));
        console.log(result.content[0]?.text || 'Empty file');
        console.log(c('└─────────────────────────────────────────┘', 'brightBlue'));
      }
    } catch (error) {
      this.printError(error instanceof Error ? error.message : String(error));
    }
    console.log();
  }

  private showThinking(): void {
    process.stdout.write(c('\n💭 ', 'brightYellow'));
    process.stdout.write(c('Thinking', 'dim'));
    
    // Animated dots
    let dots = 0;
    const interval = setInterval(() => {
      dots = (dots + 1) % 4;
      process.stdout.write('\r' + c('💭 ', 'brightYellow') + c('Thinking' + '.'.repeat(dots), 'dim') + ' '.repeat(3));
    }, 500);
    
    (this as any).thinkingInterval = interval;
  }

  private hideThinking(): void {
    const interval = (this as any).thinkingInterval;
    if (interval) {
      clearInterval(interval);
      (this as any).thinkingInterval = null;
    }
    process.stdout.write('\r' + ' '.repeat(20) + '\r');
  }

  private printResponse(response: string): void {
    console.log();
    console.log(c('┌─ 02 ────────────────────────────────────┐', 'brightGreen'));
    console.log();
    
    // Clean up the response
    let cleanResponse = response
      .replace(/\[CLI Output\] /g, '')
      .replace(/\[Error: /g, c('[Error: ', 'red'))
      .trim();
    
    // Print with word wrapping
    const lines = cleanResponse.split('\n');
    for (const line of lines) {
      console.log('  ' + line);
    }
    
    console.log();
    console.log(c('└─────────────────────────────────────────┘', 'brightGreen'));
    console.log();
  }

  /**
   * Print cli-bridge message immediately when called
   */
  private printCliBridgeMessage(message: string): void {
    console.log();
    console.log(c('┌─ 02 ────────────────────────────────────┐', 'brightGreen'));
    console.log();

    // Clean up the message
    let cleanMessage = message
      .replace(/\[CLI Output\] /g, '')
      .trim();

    // Print with word wrapping
    const lines = cleanMessage.split('\n');
    for (const line of lines) {
      console.log('  ' + line);
    }

    console.log();
    console.log(c('└─────────────────────────────────────────┘', 'brightGreen'));
    console.log();
  }

  private printError(message: string): void {
    console.log();
    console.log(c('┌─ Error ─────────────────────────────────┐', 'brightRed'));
    console.log(c('│', 'brightRed') + '  ' + c(message.slice(0, 37), 'brightRed').padEnd(39) + c('│', 'brightRed'));
    console.log(c('└─────────────────────────────────────────┘', 'brightRed'));
    console.log();
  }

  private async resetAI(): Promise<void> {
    console.log();
    console.log(c('⚠️  WARNING: This will erase all memories and conversation history!', 'brightRed'));
    console.log(dim('The AI will be reset to factory settings.\n'));
    
    // Ask for confirmation
    const answer = await new Promise<string>((resolve) => {
      this.rl?.question(c('Are you sure? Type "yes" to confirm: ', 'brightYellow'), (input) => {
        resolve(input.trim().toLowerCase());
      });
    });
    
    if (answer !== 'yes') {
      console.log(dim('\nReset cancelled.'));
      return;
    }
    
    console.log();
    console.log(c('🔄 Resetting AI data...', 'brightYellow'));
    
    if (this.engine) {
      const result = await this.engine.resetAllData();
      
      if (result.success) {
        console.log();
        console.log(c('┌─ Reset Complete ────────────────────────┐', 'brightGreen'));
        console.log(c('│', 'brightGreen') + '  ' + c('✓ All memories erased', 'brightWhite').padEnd(39) + c('│', 'brightGreen'));
        console.log(c('│', 'brightGreen') + '  ' + c('✓ Conversation history cleared', 'brightWhite').padEnd(39) + c('│', 'brightGreen'));
        console.log(c('│', 'brightGreen') + '  ' + c('✓ AI reset to factory settings', 'brightWhite').padEnd(39) + c('│', 'brightGreen'));
        console.log(c('└─────────────────────────────────────────┘', 'brightGreen'));
        console.log();
        console.log(c('🤖 02: I have been reset. Hello, I am 02, ready to assist you!', 'brightCyan'));
        console.log();
      } else {
        this.printError(result.message);
      }
    }
  }

  private async showContextStatus(): Promise<void> {
    if (!this.engine) {
      this.printError('Engine not initialized');
      return;
    }

    const status = this.engine.getContextStatus();
    const stats = this.engine.getContextStats();

    console.log();
    console.log(c('┌─ Context Window Status ─────────────────┐', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + '  ' + status.slice(0, 37).padEnd(39) + c('│', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + ' '.repeat(41) + c('│', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + `  Total Messages: ${stats.totalMessages.toString().padEnd(24)}` + c('│', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + `  User Messages: ${stats.userMessages.toString().padEnd(25)}` + c('│', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + `  Assistant Messages: ${stats.assistantMessages.toString().padEnd(20)}` + c('│', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + `  Tool Messages: ${stats.toolMessages.toString().padEnd(25)}` + c('│', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + `  Compressions: ${stats.compressionCount.toString().padEnd(26)}` + c('│', 'brightMagenta'));
    console.log(c('└─────────────────────────────────────────┘', 'brightMagenta'));
    console.log();
  }

  private async compactContext(): Promise<void> {
    if (!this.engine) {
      this.printError('Engine not initialized');
      return;
    }

    console.log();
    console.log(c('🔄 Compacting conversation...', 'brightYellow'));

    const result = await this.engine.forceCompaction('medium');

    console.log();
    console.log(c('┌─ Compaction Result ─────────────────────┐', 'brightGreen'));
    console.log(c('│', 'brightGreen') + '  ' + c(result.slice(0, 37), 'brightWhite').padEnd(39) + c('│', 'brightGreen'));
    console.log(c('└─────────────────────────────────────────┘', 'brightGreen'));
    console.log();
  }

  /**
   * Set QQ adapter and config manager
   */
  setQQAdapter(adapter: QQAdapter, configManager: QQConfigManager): void {
    this.qqAdapter = adapter;
    this.qqConfigManager = configManager;
  }

  setAutonomousRunner(runner: AutonomousRunner): void {
    this.autonomousRunner = runner;
  }

  setKukeChatAdapter(adapter: KukeChatAdapter): void {
    this.kukeChatAdapter = adapter;
  }

  private showKukeChatStatus(): void {
    if (!this.kukeChatAdapter) {
      this.printError('KukeChat adapter not initialized');
      return;
    }
    const status = this.kukeChatAdapter.getStatus();
    console.log();
    console.log(c('┌─ KukeChat Status ───────────────────────┐', 'brightCyan'));
    this.printBoxRow('Enabled', String(status.enabled), 'brightCyan');
    this.printBoxRow('Running', String(status.running), 'brightCyan');
    this.printBoxRow('Connected', String(status.connected), 'brightCyan');
    this.printBoxRow('Bot User', status.botUserId ? String(status.botUserId) : 'unknown', 'brightCyan');
    this.printBoxRow('Reconnects', String(status.reconnectAttempts), 'brightCyan');
    this.printBoxRow('Queue', String(status.queuedMessages), 'brightCyan');
    console.log(c('└─────────────────────────────────────────┘', 'brightCyan'));
    console.log();
  }

  disconnectMCP(): void {
    this.mcpManager.disconnectAll();
  }

  /**
   * Handle QQ commands
   */
  private async handleQQCommand(args: string[]): Promise<void> {
    if (!this.qqConfigManager) {
      this.printError('QQ module not initialized');
      console.log(dim('\nTo enable QQ:'));
      console.log(dim('1. Set environment variables in .env file:'));
      console.log(dim('   QQ_ENABLED=true'));
      console.log(dim('   QQ_PORT=6099'));
      console.log(dim('   QQ_TOKEN=your-token'));
      console.log(dim('2. Or run: /qq enable'));
      console.log(dim('3. Restart 02mini'));
      return;
    }

    const subCommand = args[0];

    switch (subCommand) {
      case 'status':
        await this.showQQStatus();
        break;

      case 'enable':
        await this.qqConfigManager.enable();
        console.log(c('✓ QQ adapter enabled. Restart 02 to apply.', 'brightGreen'));
        break;

      case 'disable':
        await this.qqConfigManager.disable();
        console.log(c('✓ QQ adapter disabled. Restart 02 to apply.', 'brightGreen'));
        break;

      case 'allow':
        if (args[1] === 'user' && args[2]) {
          const userId = parseInt(args[2]);
          await this.qqConfigManager.allowUser(userId);
          console.log(c(`✓ User ${userId} allowed`, 'brightGreen'));
        } else if (args[1] === 'group' && args[2]) {
          const groupId = parseInt(args[2]);
          await this.qqConfigManager.allowGroup(groupId);
          console.log(c(`✓ Group ${groupId} allowed`, 'brightGreen'));
        } else {
          this.printError('Usage: /qq allow user|group <id>');
        }
        break;

      case 'block':
        if (args[1] === 'user' && args[2]) {
          const userId = parseInt(args[2]);
          await this.qqConfigManager.blockUser(userId);
          console.log(c(`✓ User ${userId} blocked`, 'brightGreen'));
        } else if (args[1] === 'group' && args[2]) {
          const groupId = parseInt(args[2]);
          await this.qqConfigManager.blockGroup(groupId);
          console.log(c(`✓ Group ${groupId} blocked`, 'brightGreen'));
        } else {
          this.printError('Usage: /qq block user|group <id>');
        }
        break;

      case 'list':
        await this.listQQPermissions();
        break;

      case 'admin':
        if (args[1] === 'add' && args[2]) {
          const userId = parseInt(args[2]);
          await this.qqConfigManager.addAdmin(userId);
          console.log(c(`✓ User ${userId} added as admin`, 'brightGreen'));
        } else if (args[1] === 'remove' && args[2]) {
          const userId = parseInt(args[2]);
          await this.qqConfigManager.removeAdmin(userId);
          console.log(c(`✓ User ${userId} removed from admin`, 'brightGreen'));
        } else {
          this.printError('Usage: /qq admin add|remove <user_id>');
        }
        break;

      default:
        this.printQQHelp();
    }
  }

  /**
   * Show QQ status
   */
  private async showQQStatus(): Promise<void> {
    const config = this.qqConfigManager!.getConfig();
    const status = this.qqAdapter?.getStatus() || { running: false, sessions: 0 };

    console.log();
    console.log(c('┌─ QQ Status ─────────────────────────────┐', 'brightCyan'));
    console.log(c('│', 'brightCyan') + `  Enabled: ${config.enabled ? c('Yes', 'brightGreen') : c('No', 'brightRed')}`.padEnd(39) + c('│', 'brightCyan'));
    console.log(c('│', 'brightCyan') + `  Running: ${status.running ? c('Yes', 'brightGreen') : c('No', 'brightRed')}`.padEnd(39) + c('│', 'brightCyan'));
    console.log(c('│', 'brightCyan') + `  Active Sessions: ${status.sessions.toString().padEnd(24)}` + c('│', 'brightCyan'));
    console.log(c('│', 'brightCyan') + `  Mode: ${(config.mode || 'websocket-server').padEnd(32)}` + c('│', 'brightCyan'));
    console.log(c('│', 'brightCyan') + `  Port: ${(config.port || 3002).toString().padEnd(33)}` + c('│', 'brightCyan'));
    console.log(c('│', 'brightCyan') + `  @ Required in Group: ${config.atRequiredInGroup ? 'Yes' : 'No'}`.padEnd(24) + c('│', 'brightCyan'));
    console.log(c('└─────────────────────────────────────────┘', 'brightCyan'));
    console.log();
  }

  /**
   * List QQ permissions
   */
  private async listQQPermissions(): Promise<void> {
    const perms = this.qqConfigManager!.getPermissionsSummary();

    console.log();
    console.log(c('┌─ QQ Permissions ────────────────────────┐', 'brightMagenta'));
    console.log(c('│', 'brightMagenta') + '  Allowed Users:'.padEnd(39) + c('│', 'brightMagenta'));
    if (perms.allowAllPrivate) {
      console.log(c('│', 'brightMagenta') + `    ${c('(All users allowed)', 'dim')}`.padEnd(37) + c('│', 'brightMagenta'));
    } else {
      perms.allowedUsers.forEach(id => {
        console.log(c('│', 'brightMagenta') + `    ${c('✓', 'brightGreen')} ${id.toString()}`.padEnd(34) + c('│', 'brightMagenta'));
      });
    }
    console.log(c('│', 'brightMagenta') + '  Blocked Users:'.padEnd(39) + c('│', 'brightMagenta'));
    perms.blockedUsers.forEach(id => {
      console.log(c('│', 'brightMagenta') + `    ${c('✗', 'brightRed')} ${id.toString()}`.padEnd(34) + c('│', 'brightMagenta'));
    });
    console.log(c('│', 'brightMagenta') + '  Allowed Groups:'.padEnd(39) + c('│', 'brightMagenta'));
    if (perms.allowAllGroups) {
      console.log(c('│', 'brightMagenta') + `    ${c('(All groups allowed)', 'dim')}`.padEnd(37) + c('│', 'brightMagenta'));
    } else {
      perms.allowedGroups.forEach(id => {
        console.log(c('│', 'brightMagenta') + `    ${c('✓', 'brightGreen')} ${id.toString()}`.padEnd(34) + c('│', 'brightMagenta'));
      });
    }
    console.log(c('│', 'brightMagenta') + '  Admin Users:'.padEnd(39) + c('│', 'brightMagenta'));
    perms.adminUsers.forEach(id => {
      console.log(c('│', 'brightMagenta') + `    ${c('★', 'brightYellow')} ${id.toString()}`.padEnd(34) + c('│', 'brightMagenta'));
    });
    console.log(c('└─────────────────────────────────────────┘', 'brightMagenta'));
    console.log();
  }

  /**
   * Print QQ help
   */
  private printQQHelp(): void {
    console.log();
    console.log(c('┌─ QQ Commands ───────────────────────────┐', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq status              - Show QQ status'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq enable              - Enable QQ adapter'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq disable             - Disable QQ adapter'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq allow user <id>     - Allow private chat'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq allow group <id>    - Allow group access'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq block user <id>     - Block private chat'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq block group <id>    - Block group access'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq list                - List permissions'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq admin add <id>      - Add admin user'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq admin remove <id>   - Remove admin user'.padEnd(39) + c('│', 'brightBlue'));
    console.log(c('└─────────────────────────────────────────┘', 'brightBlue'));
    console.log();
  }

  private async shutdown(): Promise<void> {
    console.log();
    console.log(dim('Shutting down...'));
    this.rl?.close();

    if (this.onShutdownRequested) {
      await this.onShutdownRequested();
      return;
    }

    this.mcpManager.disconnectAll();
    console.log(c('👋 Goodbye!\n', 'brightYellow'));
  }

  /**
   * Print proactive message from autonomous runner
   */
  printProactiveMessage(content: string, trigger?: { type: string; reason: string }): void {
    console.log();
    console.log(c('┌─ 02 [Proactive] ────────────────────────┐', 'brightYellow'));
    if (trigger) {
      console.log(c('│', 'brightYellow') + `  Reason: ${trigger.reason.slice(0, 33).padEnd(33)}` + c('│', 'brightYellow'));
      console.log(c('│', 'brightYellow') + ' '.repeat(41) + c('│', 'brightYellow'));
    }
    console.log();

    // Clean up the response
    const lines = content.split('\n');
    for (const line of lines) {
      console.log('  ' + line);
    }

    console.log();
    console.log(c('└─────────────────────────────────────────┘', 'brightYellow'));
    console.log();

    // Play beep sound if supported
    process.stdout.write('\x07');
  }
}
