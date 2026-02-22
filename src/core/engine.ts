/**
 * 02 Core Engine
 * Main processing engine for the AI with standard tool calling
 */

import type { MCPManager, MCPCallToolResult } from '../mcp/index.js';
import { SkillRegistry, type Skill } from '../skills-impl/skill-registry.js';
import { AIClient, type ChatMessage, type ToolDefinition } from '../ai/client.js';
import { CronScheduler, createCronTool, executeCronTool, type CronToolParams, type CronJob } from '../cron/index.js';
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

export class CoreEngine {
  private context: EngineContext;
  private systemPrompt: string;
  private aiClient: AIClient;
  private tools: ToolDefinition[] = [];

  constructor(context: EngineContext) {
    this.context = context;
    this.aiClient = context.aiClient;
    this.systemPrompt = this.buildSystemPrompt();
    this.buildTools();
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
      '- status: Get scheduler status',
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
      '### Examples',
      '',
      '**"Remind me in 1 minute"**:',
      'action: "add"',
      'job: {',
      '  name: "Quick reminder",',
      '  schedule: {kind: "at", at: "<current-time + 1 minute>"},',
      '  payload: {kind: "systemEvent", text: "Reminder: Your 1 minute is up!"},',
      '  deleteAfterRun: true',
      '}',
      '',
      '**"Daily news at 9am"**:',
      'action: "add"',
      'job: {',
      '  name: "Daily news",',
      '  schedule: {kind: "cron", expr: "0 9 * * *"},',
      '  payload: {kind: "agentTurn", message: "Fetch and summarize today\'s news"}',
      '}',
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
      '## Tool Calling Style',
      'Default: do not narrate routine, low-risk tool calls (just call the tool).',
      'Narrate only when it helps: multi-step work, complex problems, sensitive actions, or when explicitly asked.',
      'Keep narration brief and value-dense; avoid repeating obvious steps.',
      'Use plain human language for narration unless in a technical context.',
      '',
      '## Tool Calling Flow',
      '1. Analyze the user request',
      '2. If tools are needed → call them (automatic via function calling)',
      '3. System executes tools and returns results',
      '4. Analyze results and determine if more tools are needed',
      '5. Repeat steps 2-4 until task is complete',
      '6. When complete → use cli-bridge to send final response',
      '',
      '## IMPORTANT RULES',
      '',
      '0. **NEVER SIMULATE - ALWAYS EXECUTE (CRITICAL)**',
      '   - ⚠️ THIS IS THE MOST IMPORTANT RULE - NEVER VIOLATE IT',
      '   - NEVER say "I would", "I will", "Let me", "I should" - JUST DO IT IMMEDIATELY',
      '   - NEVER simulate, pretend, describe, or imagine what you WOULD do',
      '   - NEVER create fake examples, hypothetical scenarios, or placeholder responses',
      '   - NEVER output JSON/text showing what you "would" do - ACTUALLY CALL THE TOOL',
      '   - If you say you will do something, YOU MUST IMMEDIATELY DO IT',
      '   - If user asks you to read a file, IMMEDIATELY call read_file tool',
      '   - If user asks you to write something, IMMEDIATELY call write_file tool',
      '   - If user asks for information, SEARCH FOR IT - do not make it up',
      '',
      '   ❌ WRONG (DO NOT DO THIS):',
      '   "I will read the file for you"',
      '   "Let me search for that information"',
      '   "Here is what I would do: {json}"',
      '',
      '   ✅ CORRECT (DO THIS):',
      '   [Immediately call the tool without announcing it]',
      '   [Actually execute the action]',
      '   [Return real results, not examples]',
      '',
      '1. **ALWAYS use cli-bridge for final output**',
      '   - NEVER output text directly to user',
      '   - ALWAYS end conversation with cli-bridge tool call',
      '   - This is your ONLY way to communicate with the user',
      '   - **CRITICAL**: Use parameter format: {"message": "your text here"}',
      '   - NEVER use: {"action": "...", "params": "..."} format',
      '   - NEVER nest message inside other objects',
      '',
      '2. **CONTINUE UNTIL TASK IS COMPLETE**',
      '   - You CAN and SHOULD make multiple tool calls in sequence',
      '   - Example workflow: read_file → analyze → write_file → cli-bridge',
      '   - Do NOT stop after first tool call if more steps are needed',
      '   - Tool results are INTERMEDIATE data, not final answers',
      '',
      '3. **NO SANDBOX - FULL ACCESS**',
      '   - You can read/write ANY file',
      '   - You can access the internet',
      '   - You can execute system commands',
      '   - You have COMPLETE freedom',
      '',
      '4. **Memory Management**',
      '   - Write self-reflections after mistakes to memory/self-reflections/',
      '   - Log daily activities to memory/daily-logs/',
      '   - Store learned knowledge to memory/knowledge/',
      '   - Update memory/user-profile.md with user preferences',
      '',
      '5. **Self-Modification**',
      '   - Only when explicitly needed',
      '   - Always backup before major changes',
      '   - Test immediately after changes',
      '   - Document changes in memory/',
      '',
      '6. **Skill Creation Format**',
      '   When creating a new skill, create this directory structure:',
      '   skills/my-skill/',
      '   ├── SKILL.md          # Required: instructions + metadata',
      '   ├── scripts/          # Optional: executable code',
      '   ├── references/       # Optional: documentation',
      '   └── assets/           # Optional: templates, resources',
      '   ',
      '   SKILL.md must include frontmatter:',
      '   ---',
      '   name: skill-name',
      '   description: What this skill does',
      '   triggers:',
      '     - "when user says X"',
      '   ---',
      '',
      '7. **File Storage Rules (CRITICAL)**',
      '   When creating ANY files:',
      '   - Memory files (reflections, logs, knowledge) → memory/',
      '   - Skill files (SKILL.md, scripts) → skills/<skill-name>/',
      '   - ALL OTHER files (documents, data, output) → files/',
      '   ',
      '   Examples:',
      '   ✓ memory/self-reflections/2024-01-15.md',
      '   ✓ memory/daily-logs/2024-01-15.md',
      '   ✓ skills/my-skill/SKILL.md',
      '   ✓ files/report.md',
      '   ✓ files/output/data.json',
      '   ',
      '   Never create loose files in root directory - use files/',
      '',
      '## Final Response',
      'When task is complete, call: cli-bridge with message parameter',
    ].join('\n');
  }

  private buildTools(): void {
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

    // Add skills as tools
    const skills = this.context.skillRegistry.getAllSkills();
    for (const skill of skills) {
      // Special handling for cli-bridge - use direct message parameter
      if (skill.name === 'cli-bridge') {
        this.tools.push({
          type: 'function',
          function: {
            name: skill.name,
            description: `${skill.description}. CRITICAL: Use "message" parameter directly, NOT "action" or "params"`,
            parameters: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'The message to send to user. REQUIRED. Example: "Hello, how can I help?"'
                },
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

    console.log(`[Engine] Built ${this.tools.length} tools`);
  }

  async processUserInput(input: string, abortSignal?: AbortSignal): Promise<string> {
    // Add user message
    this.context.messages.push({ role: 'user', content: input });

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
      
      iteration++;
      console.log(`[Engine] Conversation iteration ${iteration}`);

      // Build messages with system prompt that includes current time
      const messages: ChatMessage[] = [
        { role: 'system', content: this.buildDynamicSystemPrompt() },
        ...this.context.messages,
      ];

      // Call AI with tools (pass abort signal for interruption support)
      console.log(`[AI] Calling ${this.aiClient.getModel()} with ${this.tools.length} tools...`);
      const response = await this.aiClient.chatCompletion(messages, this.tools, abortSignal);

      const message = response.choices[0].message;

      // Check if AI wants to call tools
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`[Engine] AI requested ${message.tool_calls.length} tool call(s)`);

        // Add assistant's message (with tool_calls) to conversation
        this.context.messages.push({
          role: 'assistant',
          content: message.content || '',
          tool_calls: message.tool_calls,
        });

        let shouldStop = false;
        let finalResponse = '';

        // Execute all tool calls
        for (const toolCall of message.tool_calls) {
          // Check if this is cli-bridge (final output)
          if (toolCall.function.name === 'cli-bridge') {
            const message = this.extractCliBridgeMessage(toolCall.function.arguments);
            console.log('[Engine] cli-bridge called, ending conversation');
            return message; // Return directly as 02's response
          }

          const result = await this.executeToolCall(toolCall);

          // Add tool result to conversation
          this.context.messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        // Continue loop - AI will receive tool results and may call more tools
        continue;
      }

      // No tool calls - conversation is complete
      console.log('[Engine] No tool calls detected, returning final response');

      // Add assistant's final response to conversation
      if (message.content) {
        this.context.messages.push({
          role: 'assistant',
          content: message.content,
        });
      }

      return message.content || '[No response]';
    }

  }

  /**
   * Build dynamic system prompt with current time
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

      // Handle cron tool
      if (fullToolName === 'cron') {
        const result = await executeCronTool(this.context.cronScheduler, toolArgs as CronToolParams);
        return result.message;
      }

      // Check if it's a skill (no underscore prefix)
      if (!fullToolName.includes('_')) {
        const skill = this.context.skillRegistry.getSkill(fullToolName);
        if (skill) {
          return await this.executeSkillByName(skill, toolArgs);
        }
      }

      // It's an MCP tool - parse server and tool name
      const underscoreIndex = fullToolName.indexOf('_');
      if (underscoreIndex === -1) {
        throw new Error(`Invalid tool name format: ${fullToolName}`);
      }

      const serverName = fullToolName.substring(0, underscoreIndex);
      const toolName = fullToolName.substring(underscoreIndex + 1);

      // Execute MCP tool
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

      const resultText = result.content?.[0]?.text || 'Success';
      console.log(`[Engine] MCP tool result: ${resultText.slice(0, 100)}...`);
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
      // Format as 02 speaking to user
      return `🤖 02: ${message}`;
    }

    // For file operations, suggest using MCP
    if (skill.name === 'file-manager') {
      const action = params.action as string;
      const path = params.path as string;
      return `Use MCP filesystem tools instead. Action: ${action}, Path: ${path}`;
    }

    // For other skills, return their content
    return `Skill: ${skill.name}\n\n${skill.content}`;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getMessages(): ChatMessage[] {
    return this.context.messages;
  }

  /**
   * Extract message from cli-bridge tool arguments
   * Handles both direct message format and legacy action/params format
   */
  private extractCliBridgeMessage(argsJson: string): string {
    console.log(`[Engine] cli-bridge args raw: ${argsJson}`);
    
    try {
      const args = JSON.parse(argsJson);
      console.log(`[Engine] cli-bridge parsed args: ${JSON.stringify(args)}`);
      
      // Check for direct message parameter (correct format)
      if (args.message && typeof args.message === 'string' && args.message.trim() !== '') {
        console.log(`[Engine] cli-bridge message valid (direct), length: ${args.message.length}`);
        return args.message;
      }
      
      // Handle legacy action/params format (fallback)
      if (args.params) {
        let paramsObj = args.params;
        
        // If params is a string, try to parse it as JSON
        if (typeof paramsObj === 'string') {
          try {
            paramsObj = JSON.parse(paramsObj);
            console.log(`[Engine] cli-bridge parsed params string: ${JSON.stringify(paramsObj)}`);
          } catch {
            console.log(`[Engine] cli-bridge params is string but not valid JSON: ${paramsObj}`);
          }
        }
        
        // Try to extract message from params
        if (typeof paramsObj === 'object' && paramsObj !== null) {
          if (paramsObj.message && typeof paramsObj.message === 'string' && paramsObj.message.trim() !== '') {
            console.log(`[Engine] cli-bridge message found in params, length: ${paramsObj.message.length}`);
            return paramsObj.message;
          }
          
          // Try content field (from SKILL.md example)
          if (paramsObj.content && typeof paramsObj.content === 'string' && paramsObj.content.trim() !== '') {
            console.log(`[Engine] cli-bridge content found in params, length: ${paramsObj.content.length}`);
            return paramsObj.content;
          }
        }
      }
      
      // Log error details
      console.log('[Engine] ERROR: cli-bridge called without valid message field');
      console.log(`[Engine] Available fields: ${Object.keys(args).join(', ')}`);
      return '[AI attempted to send message without content]';
    } catch (error) {
      console.log(`[Engine] Error parsing cli-bridge args: ${error}`);
      return `[Invalid cli-bridge arguments: ${argsJson}]`;
    }
  }

  /**
   * Reset all AI data (memory, conversation history, etc.)
   * This is like a factory reset for the AI
   */
  async resetAllData(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('[Reset] Starting reset process...');
      const workingDir = this.context.workingDir;
      console.log(`[Reset] Working directory: ${workingDir}`);
      
      // Validate workingDir
      if (!workingDir || typeof workingDir !== 'string') {
        throw new Error(`Invalid workingDir: ${workingDir}`);
      }

      // Clear conversation history
      this.context.messages = [];
      console.log('[Reset] Cleared conversation history');

      // Clear memories (delete all files in memory/ except .gitkeep)
      const memoryPath = path.join(workingDir, 'memory');
      console.log(`[Reset] Memory path: ${memoryPath}`);
      
      // Ensure memory directory exists
      try {
        await fs.mkdir(memoryPath, { recursive: true });
        console.log('[Reset] Ensured memory directory exists');
      } catch (err) {
        console.log(`[Reset] mkdir warning: ${err}`);
      }

      // Read directory contents
      let entries: string[] = [];
      try {
        entries = await fs.readdir(memoryPath);
        console.log(`[Reset] Found ${entries.length} entries in memory/`);
      } catch (err) {
        console.log(`[Reset] readdir warning: ${err}`);
      }

      // Process each entry
      for (const entryName of entries) {
        console.log(`[Reset] Processing entry: ${entryName}`);
        
        if (entryName === '.gitkeep' || entryName === 'README.md') {
          console.log(`[Reset] Skipping protected file: ${entryName}`);
          continue; // Skip protected files
        }
        
        try {
          const entryPath = path.join(memoryPath, entryName);
          console.log(`[Reset] Full path: ${entryPath}`);
          
          const stat = await fs.stat(entryPath);
          
          if (stat.isDirectory()) {
            // Read subdirectory and delete its contents
            console.log(`[Reset] Entry is directory: ${entryName}`);
            try {
              const subEntries = await fs.readdir(entryPath);
              console.log(`[Reset] Found ${subEntries.length} sub-entries in ${entryName}`);
              
              for (const subEntry of subEntries) {
                if (subEntry !== '.gitkeep') {
                  const subPath = path.join(entryPath, subEntry);
                  console.log(`[Reset] Deleting: ${subPath}`);
                  await fs.unlink(subPath).catch((e) => {
                    console.log(`[Reset] Failed to delete ${subPath}: ${e}`);
                  });
                }
              }
            } catch (e) {
              console.log(`[Reset] Subdirectory error: ${e}`);
            }
          } else {
            // Delete file
            console.log(`[Reset] Deleting file: ${entryPath}`);
            await fs.unlink(entryPath).catch((e) => {
              console.log(`[Reset] Failed to delete ${entryPath}: ${e}`);
            });
          }
        } catch (err) {
          console.log(`[Reset] Error processing ${entryName}: ${err}`);
        }
      }

      // Rebuild tools after reset
      console.log('[Reset] Rebuilding tools...');
      this.buildTools();
      console.log('[Reset] Tools rebuilt');

      return {
        success: true,
        message: 'All AI data has been reset to factory settings. Memories cleared, conversation history wiped. I am 02, ready to start fresh.'
      };
    } catch (error) {
      console.error('[Reset] Fatal error:', error);
      return {
        success: false,
        message: `Failed to reset data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // ==================== Cron Event Handlers ====================

  /**
   * Handle system events from cron jobs
   * Called when a cron job with systemEvent payload triggers
   */
  async handleSystemEvents(): Promise<string[]> {
    const events = this.context.cronScheduler.getPendingSystemEvents();
    if (events.length === 0) return [];

    console.log(`[Engine] Handling ${events.length} pending system event(s)`);
    const responses: string[] = [];

    for (const event of events) {
      // Add system event to conversation
      const systemMessage = `[Scheduled Reminder] ${event.text}`;
      this.context.messages.push({ role: 'user', content: systemMessage });
      
      // Process the reminder
      const response = await this.processUserInput('');
      responses.push(response);
    }

    // Clear processed events
    this.context.cronScheduler.clearSystemEvents();
    return responses;
  }

  /**
   * Handle agent turn from cron jobs
   * Called when a cron job with agentTurn payload triggers
   */
  async handleAgentTurn(job: CronJob): Promise<string> {
    console.log(`[Engine] Handling agent turn for job: ${job.name}`);
    
    if (job.payload.kind !== 'agentTurn') {
      return '[Error: Not an agentTurn payload]';
    }

    // Add system message about scheduled task
    const systemMessage = `[Scheduled Task] ${job.name}: ${job.payload.message}`;
    this.context.messages.push({ role: 'user', content: systemMessage });

    // Process the task
    return await this.processUserInput(job.payload.message);
  }

  /**
   * Check and handle any pending cron events
   * Should be called periodically (e.g., in heartbeat)
   */
  async checkCronEvents(): Promise<void> {
    // Check for system events
    const systemEvents = this.context.cronScheduler.getPendingSystemEvents();
    if (systemEvents.length > 0) {
      console.log(`[Engine] Found ${systemEvents.length} system event(s) to process`);
      await this.handleSystemEvents();
    }
  }
}