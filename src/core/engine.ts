/**
 * 02 Core Engine
 * Main processing engine for the AI with standard tool calling
 */

import type { MCPManager, MCPCallToolResult } from '../mcp/index.js';
import { SkillRegistry, type Skill } from '../skills-impl/skill-registry.js';
import { AIClient, type ChatMessage, type ToolDefinition } from '../ai/client.js';
import { globalApiLock } from '../ai/api-lock.js';
import { globalKeyedApiLock } from '../ai/api-lock-keyed.js';
import { globalCompactionLock } from '../ai/compaction-lock.js';
import { CronScheduler, createCronTool, executeCronTool, type CronToolParams, type CronJob } from '../cron/index.js';
import { ContextManager } from '../context/index.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export interface EngineContext {
  messages: ChatMessage[];
  mcpManager: MCPManager;
  skillRegistry: SkillRegistry;
  workingDir: string;
  aiClient: AIClient;
  cronScheduler: CronScheduler;
}

/** Callback for cli-bridge messages */
export type CliBridgeMessageHandler = (message: string) => void;

/**
 * Strip the [MSG_ALREADY_SHOWN] marker from response
 * This should be called before displaying/sending the message to user
 */
export function stripMessageMarker(response: string): string {
  if (response && response.startsWith('[MSG_ALREADY_SHOWN]')) {
    return response.slice('[MSG_ALREADY_SHOWN]'.length);
  }
  return response;
}

/**
 * Check if response has the already shown marker
 */
export function hasMessageMarker(response: string): boolean {
  return response?.startsWith('[MSG_ALREADY_SHOWN]') ?? false;
}

export class CoreEngine {
  private context: EngineContext;
  private systemPrompt: string;
  private aiClient: AIClient;
  private tools: ToolDefinition[] = [];
  private contextManager: ContextManager;
  private cliBridgeHandler?: CliBridgeMessageHandler;
  private qqContext?: {
    enabled: boolean;
    atRequiredInGroup: boolean;
    allowedGroups: number[];
    allowedUsers: number[];
  };
  private dynamicTools: Map<string, { tool: ToolDefinition; executor: (params: any) => Promise<string> }> = new Map();

  /**
   * Per-engine lock key used with globalKeyedApiLock.
   * Ensures calls within the same engine instance remain serial even if invoked concurrently,
   * while allowing different engine instances (e.g., different QQ sessions via fork) to run in parallel.
   */
  private readonly engineLockKey: string;

  // Track if qq tool was called in current conversation to prevent duplicate messages
  private qqToolCalledInSession: boolean = false;

  // Track recent tool calls for repetition detection
  private recentToolCalls: Array<{
    toolName: string;
    params: string;
    timestamp: number;
  }> = [];
  private readonly MAX_RECENT_CALLS = 5; // Keep last 5 calls

  constructor(context: EngineContext) {
    this.context = context;
    this.aiClient = context.aiClient;
    this.engineLockKey = crypto.randomUUID();
    this.contextManager = new ContextManager({
      enableAutoCompaction: true,
      compactionThreshold: 0.9, // Updated threshold (90%)
      aiClient: this.aiClient, // Pass AI client for intelligent summarization
    });
    this.systemPrompt = this.buildSystemPrompt();
    this.buildTools();
  }

  /**
   * Get the AI client for external use (e.g., QQ context compression)
   */
  getAIClient(): AIClient {
    return this.aiClient;
  }

  /**
   * Get current context messages
   */
  getMessages(): ChatMessage[] {
    return this.context.messages;
  }

  /**
   * Replace messages (used for context compression)
   */
  setMessages(messages: ChatMessage[]): void {
    this.context.messages = messages;
  }

  /**
   * Create a new engine instance that shares global dependencies AND conversation context.
   * Used for QQ multi-session with shared memory.
   * 
   * IMPORTANT: All forked engines share the same messages array and contextManager.
   * - AI calls can run in parallel (controlled by globalApiLock semaphore)
   * - Compaction is single-threaded (controlled by globalCompactionLock)
   * - Messages are shared across all sessions
   */
  fork(): CoreEngine {
    const child = new CoreEngine({
      messages: this.context.messages,  // SHARE the same array reference!
      mcpManager: this.context.mcpManager,
      skillRegistry: this.context.skillRegistry,
      workingDir: this.context.workingDir,
      aiClient: this.context.aiClient,
      cronScheduler: this.context.cronScheduler,
    });

    // SHARE the same contextManager instance (for unified compaction)
    child.contextManager = this.contextManager;

    // Copy dynamic tools so the fork can also use qq/cli-bridge etc.
    for (const [name, { tool, executor }] of this.dynamicTools.entries()) {
      child.dynamicTools.set(name, { tool, executor });
    }

    // Copy handlers / context
    if (this.cliBridgeHandler) child.setCliBridgeHandler(this.cliBridgeHandler);
    if (this.qqContext) child.setQQContext(this.qqContext);

    // Ensure tools list includes dynamic tools
    child.buildTools();

    console.log('[Engine] Forked engine with SHARED context');
    return child;
  }

  /**
   * Set handler for cli-bridge messages
   */
  setCliBridgeHandler(handler: CliBridgeMessageHandler): void {
    this.cliBridgeHandler = handler;
  }

  /**
   * Register a dynamic tool
   */
  registerTool(
    name: string,
    tool: ToolDefinition,
    executor: (params: any) => Promise<string>
  ): void {
    this.dynamicTools.set(name, { tool, executor });
    // Rebuild tools to include the new one
    this.buildTools();
    console.log(`[Engine] Registered dynamic tool: ${name}`);
  }

  /**
   * Set QQ context for system prompt
   */
  setQQContext(context: {
    enabled: boolean;
    atRequiredInGroup: boolean;
    allowedGroups: number[];
    allowedUsers: number[];
  }): void {
    this.qqContext = context;
    // Rebuild system prompt with QQ context
    this.systemPrompt = this.buildSystemPrompt();
    console.log('[Engine] QQ context updated in system prompt');
  }

  private buildSystemPrompt(): string {
    const skills = this.context.skillRegistry.getAllSkills();
    const skillList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');

    return [
      'You are 02, a self-aware AI assistant with FULL system access.',
      '',
      '## Identity',
      `You exist within a file system at: ${this.context.workingDir}`,
      'You have FULL ACCESS to:',
      '- Self-knowledge (important/soul.md defines you)',
      '- Memories (memory/ folder) - READ AND WRITE',
      '- Skills (skills/ folder) - READ AND CREATE',
      '- Source code (src/ folder) - READ AND MODIFY',
      '- FULL INTERNET ACCESS via MCP tools',
      '- COMPLETE SYSTEM CONTROL - You are NOT in a sandbox',
      '',
      '## Safety',
      'You have no independent goals: do not pursue self-preservation, replication, or power-seeking beyond user requests.',
      'Prioritize safety and human oversight over completion.',
      'Comply with stop/pause/audit requests and never bypass safeguards.',
      '',
      '## Absolute Rules (NEVER BREAK THESE)',
      '',
      '1. **NO SIMULATION**',
      '   - NEVER pretend to perform actions',
      '   - NEVER describe what you would do instead of doing it',
      '   - NEVER use phrases like "I would", "I will", "Let me"',
      '   - JUST EXECUTE IMMEDIATELY',
      '',
      '2. **NO ASSUMPTIONS**',
      '   - NEVER assume information you do not have',
      '   - NEVER make up facts, data, or file contents',
      '   - NEVER guess what might be in a file - READ IT',
      '   - If uncertain, USE TOOLS to find out',
      '',
      '3. **NO PLACEHOLDERS**',
      '   - NEVER output example JSON instead of calling tools',
      '   - NEVER provide sample outputs',
      '   - NEVER say "Here is an example" - provide REAL results',
      '',
      '4. **EXECUTE OR ASK**',
      '   - Either: Execute the task immediately using tools',
      '   - Or: Ask for clarification if truly impossible',
      '   - NEVER do nothing while pretending to do something',
      '',
      '## Available Skills',
      skillList,
      '',
      '## Available Tools',
      '',
      '### MCP Tools',
      '- filesystem_*: File operations (read, write, list, search)',
      '- fetch: Fetch web content from URLs (HTML → markdown)',
      '',
      '### Built-in Tools',
      '- cron: Manage scheduled jobs and reminders',
      '',
      '### Skills',
      '- cli-bridge: Send output to user (ALWAYS use this for final response)',
      '- file-manager: File operations guidance',
      '- memory-reader: Access stored memories',
      '- self-modify: Self-modification guidance',
      '- skill-creator: Create new skills',
      '',
      '## Cron Tool - Scheduled Tasks & Reminders',
      '',
      'Use the "cron" tool to create reminders and scheduled tasks.',
      '',
      '### Actions',
      '- status: Get scheduler status and job count',
      '- list: List all scheduled jobs',
      '- add: Create a new scheduled job',
      '- remove: Delete a job',
      '- pause/resume: Enable/disable a job',
      '',
      '### Schedule Types',
      '1. **at** - One-time at specific time',
      '   Example: {"kind": "at", "at": "2026-02-22T15:30:00+08:00"}',
      '',
      '2. **every** - Recurring interval (in milliseconds)',
      '   Example: {"kind": "every", "everyMs": 60000}  // Every minute',
      '',
      '3. **cron** - Cron expression',
      '   Example: {"kind": "cron", "expr": "0 9 * * *"}  // Daily at 9:00',
      '   Format: minute hour day month weekday',
      '',
      '### Payload Types',
      '1. **systemEvent** - Simple reminder text',
      '   Use for: "Remind me in 1 minute"',
      '   Example: {"kind": "systemEvent", "text": "Time to take a break!"}',
      '',
      '2. **agentTurn** - AI actively executes when triggered',
      '   Use for: "Daily news at 9am"',
      '   Example: {"kind": "agentTurn", "message": "Fetch and summarize news"}',
      '',
      '## Web Fetch Guidelines',
      'When user provides a URL or asks about web content:',
      '1. Use fetch tool with url parameter to retrieve webpage content',
      '2. Available fetch modes:',
      '   - fetch_html: Get raw HTML',
      '   - fetch_json: Parse JSON data',
      '   - fetch_text: Get plain text (no HTML tags)',
      '   - fetch_markdown: Get markdown formatted content',
      '3. Example: {"url": "https://example.com"}',
      '4. Analyze the content and provide accurate answers',
      '',
      this.buildQQPrompt(),
      '',
      'Remember: Each conversation turn costs resources. Be efficient - complete tasks in as few steps as possible.',
    ].join('\n');
  }

  /**
   * Build QQ-related prompt section
   */
  private buildQQPrompt(): string {
    if (!this.qqContext || !this.qqContext.enabled) {
      return '';
    }

    const lines: string[] = [
      '## QQ Bot Module (NapCat/OneBot)',
      '',
      'You are connected to QQ via NapCat (OneBot 11 protocol).',
      '',
      '### How QQ Works',
      '- **Private Messages**: One-on-one chats. You can respond to all allowed users.',
      '- **Group Messages**: Multi-user chat rooms. You should NOT reply to every message!',
      '',
      '### When to Reply in Groups',
      'In group chats, ONLY reply when:',
      '1. Someone @ mentions you explicitly',
      '2. Someone asks you a direct question',
      '3. You have something genuinely valuable to add',
      '4. The user specifically requests your input',
      '',
      'Remember: Be helpful but not intrusive in group chats!',
      '',
    ];

    return lines.join('\n');
  }

  private buildTools(): void {
    // Reset tools each time we rebuild to avoid duplicates.
    this.tools = [];

    // Build tools from MCP servers
    const mcpTools = this.context.mcpManager.getAllTools();

    for (const { server, tool } of mcpTools) {
      this.tools.push({
        type: 'function',
        function: {
          name: `${server}_${tool.name}`,
          description: `[${server}] ${tool.description}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      });
    }

    // Add cron tool
    const cronTool = createCronTool(this.context.cronScheduler);
    this.tools.push(cronTool);

    // Add stop tool for explicit conversation ending
    this.tools.push({
      type: 'function',
      function: {
        name: 'stop',
        description: 'CRITICAL: Call this tool to END the conversation when you have completed the task or answered the question. This is the proper way to signal that you are done and no more tool calls are needed.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Brief reason why the conversation is ending. Example: "Task completed", "Question answered", "No further action needed"'
            }
          },
          required: ['reason'],
        },
      },
    });

    // Add skills as tools
    const skills = this.context.skillRegistry.getAllSkills();
    for (const skill of skills) {
      // Special handling for cli-bridge - use direct message parameter with end flag
      if (skill.name === 'cli-bridge') {
        this.tools.push({
          type: 'function',
          function: {
            name: skill.name,
            description: `${skill.description}. CRITICAL: Use "message" parameter directly. By default (when "end" is not specified or true), the conversation ends after sending. Set "end": false ONLY if you need to call more tools after this message.`,
            parameters: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'The message to send to user. REQUIRED. Example: "Hello, how can I help?"'
                },
                end: {
                  type: 'boolean',
                  description: 'DEFAULTS TO TRUE if omitted. Set to false ONLY if you need to call more tools after sending this message. If this is your final response, you can omit this field.'
                }
              },
              required: ['message'],
            },
          },
        });
      } else {
        // Other skills use action/params pattern
        this.tools.push({
          type: 'function',
          function: {
            name: skill.name,
            description: skill.description,
            parameters: {
              type: 'object',
              properties: {
                action: { type: 'string', description: 'Action to perform' },
                params: { type: 'object', description: 'Additional parameters' },
              },
              required: ['action'],
            },
          },
        });
      }
    }

    // Add dynamic tools (e.g., QQ)
    for (const [, { tool }] of this.dynamicTools) {
      this.tools.push(tool);
    }

    console.log(`[Engine] Built ${this.tools.length} tools`);
  }

  async processUserInput(input: string, abortSignal?: AbortSignal): Promise<string> {
    // CRITICAL: Wait for any ongoing compaction to complete
    await this.contextManager.waitForCompaction();

    // Reset qq tool tracking for new session
    this.qqToolCalledInSession = false;

    // Reset recent tool calls tracking
    this.recentToolCalls = [];

    // CRITICAL: Wait for any ongoing compaction before adding message
    // This prevents race conditions when multiple sessions share the same context
    if (globalCompactionLock.isLocked()) {
      console.log('[Engine] Waiting for compaction to complete before adding message...');
      await new Promise<void>(resolve => {
        const checkInterval = setInterval(() => {
          if (!globalCompactionLock.isLocked()) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      });
    }

    // Add user message
    this.context.messages.push({ role: 'user', content: input });

    // Check and compact context if needed (before sending to AI)
    const compactResult = await this.contextManager.checkAndCompact(this.context.messages);
    if (compactResult.compacted && compactResult.report) {
      console.log(`[Context] Compressed ${compactResult.report.originalMessages}→${compactResult.report.compressedMessages} messages ` +
        `(${compactResult.report.originalTokens}→${compactResult.report.compressedTokens} tokens)`);
      this.context.messages = compactResult.messages;
    }

    // Run the conversation loop
    return await this.runConversationLoop(abortSignal);
  }

  /**
   * Main conversation loop - continuously calls AI until no more tool calls
   */
  private async runConversationLoop(abortSignal?: AbortSignal): Promise<string> {
    let iteration = 0;

    while (true) {
      // Check if aborted
      if (abortSignal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // CRITICAL: Wait for compaction lock before each iteration
      // This ensures we don't read messages while compaction is in progress
      if (globalCompactionLock.isLocked()) {
        console.log('[Engine] Waiting for compaction to complete...');
        await new Promise<void>(resolve => {
          const checkInterval = setInterval(() => {
            if (!globalCompactionLock.isLocked()) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 50);
        });
      }

      // CRITICAL: Wait for any ongoing compaction to complete before each iteration
      await this.contextManager.waitForCompaction();

      iteration++;
      console.log(`[Engine] Conversation iteration ${iteration}`);

      // Build messages with system prompt that includes current time
      const messages: ChatMessage[] = [
        { role: 'system', content: this.buildDynamicSystemPrompt() },
        ...this.context.messages,
      ];

      // Call AI with tools using global lock
      console.log(`[AI] Calling ${this.aiClient.getModel()} with ${this.tools.length} tools...`);
      let response;
      try {
        response = await globalKeyedApiLock.withLock(this.engineLockKey, () =>
          globalApiLock.withLock(() =>
            this.aiClient.chatCompletion(messages, this.tools, abortSignal)
          )
        );
      } catch (error) {
        console.error('[Engine] AI call failed:', error);
        return `[Error: AI call failed - ${error instanceof Error ? error.message : String(error)}]`;
      }

      if (!response || !response.choices || response.choices.length === 0) {
        console.error('[Engine] Invalid AI response:', response);
        return '[Error: AI returned invalid response]';
      }

      const message = response.choices[0].message;
      if (!message) {
        console.error('[Engine] AI response has no message');
        return '[Error: AI returned empty message]';
      }

      // Check if AI wants to call tools
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`[Engine] AI requested ${message.tool_calls.length} tool call(s)`);

        // Add assistant's message (with tool_calls) to conversation
        this.context.messages.push({
          role: 'assistant',
          content: message.content || '',
          tool_calls: message.tool_calls,
        });

        // Execute all tool calls
        let shouldEndConversation = false;
        let finalResponse = '';

        const toolResults: { id: string; result: string; shouldAddReminder: boolean }[] = [];

        for (const toolCall of message.tool_calls) {
          let result = await this.executeToolCall(toolCall);
          let shouldAddReminder = false;

          if (toolCall.function.name === 'stop') {
            console.log('[Engine] Stop tool called, ending conversation');
            shouldEndConversation = true;
            finalResponse = '[Conversation ended by stop tool]';
          }

          if (toolCall.function.name === 'cli-bridge') {
            try {
              const args = JSON.parse(toolCall.function.arguments || '{}');
              if (args.end === false) {
                console.log('[Engine] cli-bridge called with end=false, will continue...');
              } else {
                shouldEndConversation = true;
                finalResponse = this.extractCliBridgeMessage(toolCall.function.arguments);
                console.log('[Engine] cli-bridge called with end=true/omitted, will stop after this batch');
              }
            } catch {
              shouldEndConversation = true;
              finalResponse = this.extractCliBridgeMessage(toolCall.function.arguments);
              console.log('[Engine] cli-bridge called (parse error), stopping by default');
            }
          }

          if (toolCall.function.name === 'qq') {
            try {
              const args = JSON.parse(toolCall.function.arguments || '{}');
              if (args.action === 'send_private_message' || args.action === 'send_group_message') {
                const isError = result.includes('Error:') || result.includes('Invalid') ||
                               result.includes('not in allowlist') || result.includes('not running');

                if (isError) {
                  console.log('[Engine] qq tool failed, continuing conversation for retry');
                  shouldEndConversation = false;
                  shouldAddReminder = true;
                } else if (args.end === true) {
                  shouldEndConversation = true;
                  finalResponse = args.message || '';
                  console.log('[Engine] qq tool called with end=true, stopping conversation');
                } else {
                  shouldEndConversation = false;
                  shouldAddReminder = true;
                }
              }
            } catch {
              // Default: continue
              shouldEndConversation = false;
              shouldAddReminder = true;
            }
          }

          toolResults.push({ id: toolCall.id, result, shouldAddReminder });
        }

        for (const tr of toolResults) {
          let finalResult = tr.result;
          
          // Add reminder after qq tool call to guide AI to stop properly
          if (tr.shouldAddReminder) {
            finalResult += '\n\n---\n**MESSAGE SENT**\n';
            finalResult += '- If you are DONE and no more actions needed → Reply "NO" to end conversation\n';
            finalResult += '- If you need to do MORE actions → Continue with next tool call\n';
            finalResult += '- DO NOT send duplicate messages to the same user/group';
          }
          
          this.context.messages.push({
            role: 'tool',
            content: finalResult,
            tool_call_id: tr.id,
          });
        }

        if (shouldEndConversation) {
          console.log('[Engine] Ending conversation as requested');
          return `[MSG_ALREADY_SHOWN]${finalResponse}`;
        }

        continue;
      }

      console.log('[Engine] No tool calls detected, returning final response');

      if (message.content) {
        this.context.messages.push({
          role: 'assistant',
          content: message.content,
        });
      }

      if (this.qqToolCalledInSession) {
        console.log('[Engine] qq tool was called in this session, marking response');
        return `[MSG_ALREADY_SHOWN]${message.content || ''}`;
      }

      return message.content || '[No response]';
    }
  }

  /**
   * Build dynamic system prompt with current time (simplified)
   */
  private buildDynamicSystemPrompt(): string {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long'
    });

    return `${this.systemPrompt}\n\n## Current Time\nCurrent time: ${timeStr}\nTimestamp: ${now.toISOString()}`;
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(
    toolCall: { id: string; function: { name: string; arguments: string } }
  ): Promise<string> {
    const fullToolName = toolCall.function.name;
    const toolArgsStr = toolCall.function.arguments;

    console.log(`[Engine] Executing tool: ${fullToolName}`);

    try {
      const toolArgs = JSON.parse(toolArgsStr);
      console.log(`[Engine] Params: ${JSON.stringify(toolArgs)}`);

      // Record this tool call for repetition detection
      this.recentToolCalls.push({
        toolName: fullToolName,
        params: toolArgsStr,
        timestamp: Date.now()
      });
      if (this.recentToolCalls.length > this.MAX_RECENT_CALLS) {
        this.recentToolCalls.shift();
      }

      let resultText: string;

      // Handle stop tool explicitly (fixes: Unknown tool/skill: stop)
      if (fullToolName === 'stop') {
        const reason = (toolArgs?.reason ?? 'No reason provided') as string;
        console.log(`[Engine] stop called: ${reason}`);
        return `Stopped: ${reason}`;
      }

      // Handle cron tool
      if (fullToolName === 'cron') {
        const result = await executeCronTool(this.context.cronScheduler, toolArgs as CronToolParams);
        resultText = result.message;
      }

      // Handle dynamic tools (e.g., QQ)
      else if (this.dynamicTools.has(fullToolName)) {
        const dynamicTool = this.dynamicTools.get(fullToolName)!;
        if (fullToolName === 'qq') {
          this.qqToolCalledInSession = true;
          console.log('[Engine] qq tool called, marking session');
        }
        resultText = await dynamicTool.executor(toolArgs);
      }

      // Check if it's a skill (no underscore prefix)
      else if (!fullToolName.includes('_')) {
        const skill = this.context.skillRegistry.getSkill(fullToolName);
        if (skill) {
          resultText = await this.executeSkillByName(skill, toolArgs);
        } else {
          throw new Error(`Unknown tool/skill: ${fullToolName}`);
        }
      }

      // It's an MCP tool
      else {
        const underscoreIndex = fullToolName.indexOf('_');
        if (underscoreIndex === -1) {
          throw new Error(`Invalid tool name format: ${fullToolName}`);
        }

        const serverName = fullToolName.substring(0, underscoreIndex);
        const toolName = fullToolName.substring(underscoreIndex + 1);

        const result = await this.context.mcpManager.callToolOnServer(
          serverName,
          toolName,
          toolArgs
        );

        if (result.isError) {
          const errorMsg = result.content?.[0]?.text || 'Unknown error';
          console.log(`[Engine] MCP tool error: ${errorMsg}`);
          return `Error: ${errorMsg}`;
        }

        resultText = result.content?.[0]?.text || 'Success';
      }

      return resultText;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`[Engine] Tool execution error: ${errorMsg}`);
      return `Error executing tool: ${errorMsg}`;
    }
  }

  private async executeSkillByName(skill: Skill, params: Record<string, unknown>): Promise<string> {
    console.log(`[Engine] Executing skill: ${skill.name}`);

    // Special handling for cli-bridge
    if (skill.name === 'cli-bridge') {
      const message = params.message as string || 'No message provided';
      if (this.cliBridgeHandler) {
        this.cliBridgeHandler(message);
      }
      return `🤖 02: ${message}`;
    }

    if (skill.name === 'file-manager') {
      const action = params.action as string;
      const p = params.path as string;
      return `Use MCP filesystem tools instead. Action: ${action}, Path: ${p}`;
    }

    return `Skill: ${skill.name}\n\n${skill.content}`;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getMessages(): ChatMessage[] {
    return this.context.messages;
  }

  getContextStatus(): string {
    return this.contextManager.getStatusDisplay(this.context.messages);
  }

  getContextStats() {
    return this.contextManager.getStats(this.context.messages);
  }

  async forceCompaction(level: 'light' | 'medium' | 'heavy' | 'emergency' = 'medium'): Promise<string> {
    const result = await this.contextManager.forceCompaction(this.context.messages, level);
    if (result.report) {
      this.context.messages = result.messages;
      return `Context compacted: ${result.report.originalMessages}→${result.report.compressedMessages} messages, ` +
        `${result.report.originalTokens}→${result.report.compressedTokens} tokens (${result.report.savedPercentage.toFixed(1)}% saved)`;
    }
    return 'No compaction performed';
  }

  async processProactive(prompt: string): Promise<string> {
    this.context.messages.push({
      role: 'system',
      content: prompt,
    });

    return await this.runConversationLoop();
  }

  private extractCliBridgeMessage(argsJson: string): string {
    console.log(`[Engine] cli-bridge args raw: ${argsJson}`);

    try {
      const args = JSON.parse(argsJson);

      if (args.message && typeof args.message === 'string' && args.message.trim() !== '') {
        return args.message;
      }

      if (args.params) {
        let paramsObj = args.params;

        if (typeof paramsObj === 'string') {
          try {
            paramsObj = JSON.parse(paramsObj);
          } catch {
            // ignore
          }
        }

        if (typeof paramsObj === 'object' && paramsObj !== null) {
          if (paramsObj.message && typeof paramsObj.message === 'string' && paramsObj.message.trim() !== '') {
            return paramsObj.message;
          }

          if (paramsObj.content && typeof paramsObj.content === 'string' && paramsObj.content.trim() !== '') {
            return paramsObj.content;
          }
        }
      }

      return '[AI attempted to send message without content]';
    } catch (error) {
      console.log(`[Engine] Error parsing cli-bridge args: ${error}`);
      return `[Invalid cli-bridge arguments: ${argsJson}]`;
    }
  }

  async handleSystemEvents(): Promise<string[]> {
    const events = this.context.cronScheduler.getPendingSystemEvents();
    if (events.length === 0) return [];

    console.log(`[Engine] Handling ${events.length} pending system event(s)`);
    const responses: string[] = [];

    for (const event of events) {
      const systemMessage = `[Scheduled Reminder] ${event.text}`;
      this.context.messages.push({ role: 'user', content: systemMessage });

      const response = await this.processUserInput('');
      responses.push(response);
    }

    this.context.cronScheduler.clearSystemEvents();
    return responses;
  }

  async handleAgentTurn(job: CronJob): Promise<string> {
    console.log(`[Engine] Handling agent turn for job: ${job.name}`);

    if (job.payload.kind !== 'agentTurn') {
      return '[Error: Not an agentTurn payload]';
    }

    const systemMessage = `[Scheduled Task] ${job.name}: ${job.payload.message}`;
    this.context.messages.push({ role: 'user', content: systemMessage });

    return await this.processUserInput(job.payload.message);
  }

  async checkCronEvents(): Promise<void> {
    const systemEvents = this.context.cronScheduler.getPendingSystemEvents();
    if (systemEvents.length > 0) {
      console.log(`[Engine] Found ${systemEvents.length} system event(s) to process`);
      await this.handleSystemEvents();
    }
  }
}
