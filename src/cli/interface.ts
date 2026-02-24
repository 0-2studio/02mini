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
import type { ProactiveTrigger } from '../autonomous/types.js';
import type { QQAdapter, QQConfigManager } from '../qq/index.js';
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

  // Callbacks for external integrations
  onEngineReady?: (engine: CoreEngine) => Promise<void> | void;
  onUserInteraction?: () => void;

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
    console.log(dim('\n💡 Type "/help" for available commands\n'));

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
          
          const response = await this.engine.processUserInput(trimmed, abortController.signal);
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

    console.log(c('✨ Ready for conversation!\n', 'brightGreen'));
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
        this.listMCPTools();
        break;
      
      case '/status':
        await this.printStatus();
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
        await this.listMemoryFiles();
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

      default:
        this.printError(`Unknown command: ${command}`);
        console.log(dim('Type /help for available commands'));
    }
  }

  private printHelp(): void {
    console.log();
    console.log(c('┌─ Available Commands ────────────────────┐', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /help      - Show this help message     ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /skills    - List all available skills  ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /mcp       - List all MCP tools         ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /status    - Show system status         ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /context   - Show context window status ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /compact   - Compact conversation (opt) ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /qq        - QQ NapCat bot management   ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /read      - Read a file                ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /memory    - List memory files          ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /reset     - Reset all AI data (DANGER) ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /clear     - Clear the screen           ' + c('│', 'brightBlue'));
    console.log(c('│', 'brightBlue') + '  /exit      - Exit the application       ' + c('│', 'brightBlue'));
    console.log(c('└─────────────────────────────────────────┘', 'brightBlue'));
    console.log();
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
      console.log();
    } catch (error) {
      this.printError('Failed to read memory directory');
    }
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
        if (args[2] === 'add' && args[3]) {
          const userId = parseInt(args[3]);
          await this.qqConfigManager.addAdmin(userId);
          console.log(c(`✓ User ${userId} added as admin`, 'brightGreen'));
        } else if (args[2] === 'remove' && args[3]) {
          const userId = parseInt(args[3]);
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

    this.mcpManager.disconnectAll();

    console.log(c('👋 Goodbye!\n', 'brightYellow'));

    this.rl?.close();
    process.exit(0);
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