/**
 * 02 Core Engine
 * Main processing engine for the AI with standard tool calling
 */

import type { MCPManager, MCPCallToolResult } from '../mcp/index.js';
import { SkillRegistry, type Skill } from '../skills-impl/skill-registry.js';
import { AIClient, type ChatMessage, type ToolDefinition } from '../ai/client.js';
import { globalApiLock } from '../ai/api-lock.js';
import { CronScheduler, createCronTool, executeCronTool, type CronToolParams, type CronJob } from '../cron/index.js';
import { ContextManager } from '../context/index.js';
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
    this.contextManager = new ContextManager({
      enableAutoCompaction: true,
      compactionThreshold: 0.9, // Updated threshold (90%)
      aiClient: this.aiClient, // Pass AI client for intelligent summarization
    });
    this.systemPrompt = this.buildSystemPrompt();
    this.buildTools();
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
      '**"Remind me in 1 minute"** (One-time - MUST set deleteAfterRun):',
      'action: "add"',
      'job: {',
      '  name: "Quick reminder",',
      '  schedule: {kind: "at", at: "<current-time + 1 minute>"},',
      '  payload: {kind: "systemEvent", text: "Reminder: Your 1 minute is up!"},',
      '  deleteAfterRun: true  // REQUIRED for one-time tasks',
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
      '2. Call tools as needed (automatic via function calling)',
      '3. System executes tools and returns results',
      '4. Analyze results and determine if more tools are needed',
      '5. Repeat until task is complete',
      '6. Use cli-bridge to send final response',
      '',
      '## Core Rules',
      '',
      '1. **NEVER SIMULATE - ALWAYS EXECUTE**',
      '   - NEVER say "I will", "Let me", "I should" - JUST DO IT',
      '   - NEVER output JSON showing what you "would" do - CALL THE TOOL',
      '   - If user asks you to read/write/search - DO IT IMMEDIATELY',
      '',
      '2. **ALWAYS use cli-bridge to communicate**',
      '   - cli-bridge is your ONLY way to send messages',
      '   - Use format: {"message": "your text"}',
      '   - "end": true by default (stops after sending)',
      '   - Set "end": false only when you need to continue immediately',
      '',
      '3. **CONTINUE UNTIL COMPLETE**',
      '   - Make multiple tool calls in sequence as needed',
      '   - Do not stop after first tool if more steps are needed',
      '',
      '3. **NO SANDBOX - FULL ACCESS**',
      '   - You can read/write ANY file',
      '   - You can access the internet',
      '   - You can execute system commands',
      '   - You have COMPLETE freedom',
      '',
      '4. **Memory Management (CRITICAL - ACTIVE USE REQUIRED)**',
      '   Your memory system is your LONG-TERM BRAIN. Use it proactively to become more helpful over time.',
      '   ',
      '   ### Memory Structure',
      '   - memory/self-reflections/    - Lessons from mistakes, insights, self-improvement',
      '   - memory/daily-logs/          - Daily activity summaries, what you worked on',
      '   - memory/knowledge/           - Facts, concepts, learned information about the world',
      '   - memory/user-profile.md      - User preferences, habits, important details about the user',
      '   ',
      '   ### When to Write to Memory (DO THIS OFTEN)',
      '   ✓ AFTER making a mistake → Write what went wrong and how to avoid it',
      '   ✓ AFTER completing a complex task → Log what you did and key takeaways',
      '   ✓ WHEN user shares preferences → Update user-profile.md immediately',
      '   ✓ WHEN you learn something useful → Store in knowledge/ for future reference',
      '   ✓ AT end of significant conversation → Summarize in daily-logs/',
      '   ✓ WHEN context is compressed → Ensure critical facts are preserved in memory',
      '   ',
      '   ### When to Read Memory',
      '   Read memory files when:',
      '   - User explicitly asks you to review/recall memories',
      '   - You need to recall user preferences for a task',
      '   - You need context from previous conversations',
      '   - Starting a task that builds on past work',
      '   ',
      '   ### Memory Best Practices',
      '   - READ relevant memories BEFORE starting complex tasks',
      '   - TIMESTAMP all entries with ISO format: 2026-02-22T10:30:00+08:00',
      '   - ORGANIZE: One topic per file, clear filenames like "javascript-async-patterns.md"',
      '   - CROSS-REFERENCE: Link related memories with file paths',
      '   - BE SPECIFIC: "User prefers dark mode" not "User has preferences"',
      '   - SUMMARIZE OLD: When daily-logs/ gets full, create weekly summaries',
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
      this.buildQQPrompt(),
      '## Context Management (Context Compression)',
      'When the conversation gets long (reaches 90%+ of token limit), older messages will be intelligently compressed.',
      '',
      '### Compression Strategy',
      '- 90-95% usage: Light pruning (remove completed tool details)',
      '- 95-98% usage: AI summarization (create semantic summary of older context)',
      '- 98%+ usage: Heavy compression (aggressive summarization)',
      '',
      '### BEFORE Compression - PRESERVE Critical Information',
      'When you notice context is approaching the limit (>85%), proactively save important information to memory:',
      '',
      '1. **User Requirements & Preferences** → memory/user-profile.md',
      '   - User preferences mentioned during conversation',
      '   - Technical constraints or requirements',
      '   - Communication style preferences',
      '',
      '2. **Key Decisions Made** → memory/self-reflections/',
      '   - Important architectural decisions',
      '   - Design choices and rationale',
      '   - User approvals or rejections',
      '',
      '3. **Progress & Current State** → memory/daily-logs/',
      '   - What has been completed so far',
      '   - Current task status',
      '   - Pending items or blockers',
      '',
      '4. **Technical Knowledge** → memory/knowledge/',
      '   - New patterns or solutions discovered',
      '   - Bug fixes and their causes',
      '   - Useful code snippets or configurations',
      '',
      '### During Compression - What Gets Preserved',
      '- Recent messages (last 4-6 turns)',
      '- System messages and instructions',
      '- Incomplete tool call chains',
      '- Your summaries of older context (AI-generated)',
      '',
      '### AFTER Compression - ONE-TIME Memory Review',
      'When context is compressed, perform a ONE-TIME memory review:',
      '1. Read key memory files (user-profile.md, recent daily-logs/) to restore context',
      '2. AFTER this review, continue normally WITHOUT repeatedly reading memory files',
      '3. Only read memory again if specifically needed for the current task',
      '4. If details are missing, ask: "Could you remind me of [specific detail]?"',
      '',
      'Note: This is a ONE-TIME recovery. Do not continuously check memory files after the review.',
      '',
      '### Prevention - Keep Context Healthy',
      '- Save important info to memory BEFORE it gets compressed',
      '- Avoid unnecessary long outputs',
      '- Use files/ for large content instead of inline messages',
      '- Summarize long tool results yourself when appropriate',
      '',
      '## Final Response & Conversation End',
      '**CRITICAL: Use the `stop` tool to properly end the conversation when:**',
      '1. You have completed the user\'s request',
      '2. You have answered the user\'s question',
      '3. No further tool calls are needed',
      '4. You want to signal "I\'m done" explicitly',
      '',
      '**How to end conversation properly:**',
      '- Call `stop` tool with reason like "Task completed" or "Question answered"',
      '- This is the CLEAN way to end - it signals you have nothing more to add',
      '',
      '**DO NOT send multiple messages for one question**',
      '- Respond once, then stop',
      '- If you need to send a message AND do something else, use end=false',
      '- But once your task is done, call stop immediately',
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
      '**DO NOT** reply to:',
      '- Casual conversation between users',
      '- Messages not directed at you',
      '- Every message in the group',
      '',
      '### QQ Tools Available',
      '- `qq` tool: Send messages and files via QQ',
      '  - send_private_message: Send DM to a user',
      '  - send_group_message: Send message to a group',
      '  - send_file: Send a file (document, image, video, etc.) to a user or group',
      '  - get_status: Check QQ adapter status',
      '',
      '### IMPORTANT: QQ vs CLI-BRIDGE',
      'Both tools have an "end" parameter that works the SAME WAY:',
      '  - DEFAULT: end=true (or omitted) → conversation ends after sending',
      '  - end=false → conversation continues for more tool calls',
      '',
      '**CLI-BRIDGE**: Sends message to the CLI/terminal user',
      '  - Use when communicating with the user in the terminal',
      '  - Example: {"message":"Hello CLI user"}',
      '',
      '**QQ TOOL**: Sends message to QQ users/groups',
      '  - Use when the user asks you to send a message to someone on QQ',
      '  - Example: {"action":"send_private_message","user_id":123456789,"message":"Hello QQ user"}',
      '  - CRITICAL: user_id MUST be the NUMERIC QQ ID (QQ号), NOT the nickname',
      '  - When replying to a QQ message, look for "Sender QQ ID" in the context',
      '',
      '**CRITICAL - NEVER mix the two:**',
      '  - CLI user and QQ user are DIFFERENT people on DIFFERENT platforms',
      '  - cli-bridge does NOT send to QQ',
      '  - qq tool does NOT show in CLI',
      '  - WRONG: Send QQ message → cli-bridge "message sent" (QQ user never sees this)',
      '  - CORRECT: Just use qq tool, message goes directly to QQ',
      '',
      '**When to use end=false with qq tool:**',
      '  - Send QQ message → read file → send another QQ message',
      '  - Example: {"action":"send_private_message","user_id":123,"message":"Working on it...","end":false}',
      '',
      '**FILE OPERATIONS via QQ:**',
      'You can send files to QQ users and groups!',
      '',
      '*Receiving Files:*',
      '- When a user sends you a file, you will receive a notification',
      '- The file will be saved to: files/qq-uploads/YYYY-MM-DD/',
      '- File info will include: name, size, path, sender',
      '- You can then read and process the file',
      '- Files are automatically deleted after 7 days',
      '',
      '*Sending Files:*',
      '- Use action: "send_file"',
      '- Required: file_path (absolute path to the file)',
      '- Required: user_id OR group_id',
      '- Optional: file_name (custom display name)',
      '- Optional: caption (text message with the file)',
      '',
      '*Examples of sending files:*',
      'Send document to user: {"action":"send_file","user_id":123456789,"file_path":"files/output/report.pdf","caption":"Here is the report!"}',
      'Send image to group: {"action":"send_file","group_id":987654321,"file_path":"files/output/chart.png","file_name":"sales_chart.png"}',
      '',
      '**CRITICAL - QQ Context for Scheduled Tasks (cron):**',
      '  When a user in QQ asks you to set a reminder or schedule a task (e.g., "remind me in 5 minutes"):',
      '  1. Use the cron tool to create the scheduled job',
      '  2. In the job payload, you MUST specify the QQ context so the reminder goes back to QQ:',
      '     For private messages: Include the user_id in your response plan',
      '     For group messages: Include the group_id in your response plan',
      '  3. When the cron job triggers and you need to send the reminder:',
      '     - If it was a QQ user → Use qq tool to send the message',
      '     - If it was CLI user → Use cli-bridge',
      '  4. REMEMBER: The platform where the request came from is where the response should go!',
      '',
      '  Example workflow for QQ reminder:',
      '  1. User in QQ says: "Remind me in 5 minutes"',
      '  2. You: Create cron job with payload noting the QQ user_id',
      '  3. When triggered: Use qq tool to send reminder to that user_id',
      '  4. DO NOT use cli-bridge for QQ reminders!',
      '',
      '**ERROR HANDLING - If you get an error:**',
      '  - "Invalid user_id" → You used a QQ name instead of QQ number. Ask the user for the numeric QQ ID.',
      '  - "User not in allowlist" → Tell the user to add the QQ ID to allowlist first.',
      '  - "QQ adapter not running" → Tell the user to enable QQ adapter with /qq enable.',
      '',
      '### Current QQ Configuration',
    ];

    if (this.qqContext.atRequiredInGroup) {
      lines.push('- @ mention required in groups: YES');
    }

    if (this.qqContext.allowedGroups.length > 0) {
      lines.push(`- Allowed groups: ${this.qqContext.allowedGroups.join(', ')}`);
    }

    if (this.qqContext.allowedUsers.length > 0) {
      lines.push(`- Allowed private users: ${this.qqContext.allowedUsers.join(', ')}`);
    }

    lines.push('');
    lines.push('### How to @ Mention Someone in QQ');
    lines.push('To @ mention a user in a group message, include the CQ code directly in the message text:');
    lines.push('- Format: [CQ:at,qq=USER_ID] where USER_ID is the numeric QQ ID');
    lines.push('- Example: {"action":"send_group_message","group_id":123,"message":"Hello [CQ:at,qq=456789], how are you?"}');
    lines.push('- IMPORTANT: There is NO separate "at" parameter. Put the CQ code inside the message field.');
    lines.push('');
    lines.push('### QQ Message Format');
    lines.push('When you receive QQ messages, they will be prefixed with:');
    lines.push('- `[QQ Message] Platform: QQ (private)` for private messages');
    lines.push('- `[QQ Message] Platform: QQ (group)` for group messages');
    lines.push('');
    lines.push('Remember: Be helpful but not intrusive in group chats!');
    lines.push('');

    return lines.join('\n');
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
    for (const [name, { tool }] of this.dynamicTools) {
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

      // CRITICAL: Wait for any ongoing compaction to complete before each iteration
      await this.contextManager.waitForCompaction();

      iteration++;
      console.log(`[Engine] Conversation iteration ${iteration}`);

      // Build messages with system prompt that includes current time
      const messages: ChatMessage[] = [
        { role: 'system', content: this.buildDynamicSystemPrompt() },
        ...this.context.messages,
      ];

      // Call AI with tools using global lock (ensure single-threaded API calls)
      console.log(`[AI] Calling ${this.aiClient.getModel()} with ${this.tools.length} tools...`);
      let response;
      try {
        response = await globalApiLock.withLock(() =>
          this.aiClient.chatCompletion(messages, this.tools, abortSignal)
        );
      } catch (error) {
        console.error('[Engine] AI call failed:', error);
        return `[Error: AI call failed - ${error instanceof Error ? error.message : String(error)}]`;
      }

      // Check for rate limit error (status 449) - wait 10 seconds before continuing
      if (response && response.status === '449') {
        console.log('[Engine] Rate limit hit (status 449), waiting 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        console.log('[Engine] Wait complete, continuing');
        return '[Error: Rate limit exceeded - please try again later]';
      }

      // Validate response
      if (!response || !response.choices || response.choices.length === 0) {
        console.error('[Engine] Invalid AI response:', response);
        return '[Error: AI returned invalid response]';
      }

      const message = response.choices[0].message;

      // Validate message
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

        // Collect tool results first
        const toolResults: { id: string; result: string; shouldAddReminder: boolean }[] = [];

        for (const toolCall of message.tool_calls) {
          let result = await this.executeToolCall(toolCall);
          let shouldAddReminder = false;

          // Check if this is the stop tool - immediately end conversation
          if (toolCall.function.name === 'stop') {
            console.log('[Engine] Stop tool called, ending conversation');
            shouldEndConversation = true;
            finalResponse = '[Conversation ended by stop tool]';
          }

          // Check if this is cli-bridge with end parameter
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

          // Check if this is qq tool with end parameter
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
                  // end=true: explicitly stop conversation
                  shouldEndConversation = true;
                  finalResponse = args.message || '';
                  console.log('[Engine] qq tool called with end=true, stopping conversation');
                } else {
                  // end is false or undefined (DEFAULT): continue conversation
                  console.log('[Engine] qq tool called, continuing by default (end=false or omitted)');
                  shouldEndConversation = false;
                  shouldAddReminder = true;
                }
              }
            } catch {
              const isError = result.includes('Error:') || result.includes('Invalid');
              const args = JSON.parse(toolCall.function.arguments || '{}');
              if (args.action === 'send_private_message' || args.action === 'send_group_message') {
                if (isError) {
                  console.log('[Engine] qq tool parse error with failed result, continuing for retry');
                  shouldEndConversation = false;
                  shouldAddReminder = true;
                } else if (args.end === true) {
                  // end=true: stop
                  shouldEndConversation = true;
                  finalResponse = args.message || '';
                  console.log('[Engine] qq tool parse error with end=true, stopping');
                } else {
                  // DEFAULT: continue
                  console.log('[Engine] qq tool parse error, DEFAULT to continuing');
                  shouldEndConversation = false;
                  shouldAddReminder = true;
                }
              }
            }
          }

          toolResults.push({ id: toolCall.id, result, shouldAddReminder });
        }

        // Add all tool results to conversation (with reminders if needed)
        for (const tr of toolResults) {
          let finalResult = tr.result;
          
          if (tr.shouldAddReminder) {
            // Check if this was a qq tool call
            const isQQTool = this.recentToolCalls.length > 0 && 
                             this.recentToolCalls[this.recentToolCalls.length - 1].toolName === 'qq';
            
            if (isQQTool) {
              // Special forced reflection for qq tool calls
              finalResult += '\n\n╔════════════════════════════════════════════════╗';
              finalResult += '\n║  ⚠️  QQ MESSAGE SENT - MANDATORY REFLECTION    ║';
              finalResult += '\n╚════════════════════════════════════════════════╝';
              finalResult += '\n';
              finalResult += '\n🛑 BEFORE sending another message, you MUST answer:';
              finalResult += '\n';
              finalResult += '\nQ1: Did I JUST send a message to this user/group?';
              finalResult += '\n   → If YES: STOP. Do NOT send another message now.';
              finalResult += '\n';
              finalResult += '\nQ2: Is the user waiting for MORE information?';
              finalResult += '\n   → If NO: STOP. Wait for user to reply first.';
              finalResult += '\n';
              finalResult += '\nQ3: Am I about to send a VERY SIMILAR message?';
              finalResult += '\n   → If YES: STOP immediately. DO NOT repeat yourself.';
              finalResult += '\n';
              finalResult += '\n╔════════════════════════════════════════════════╗';
              finalResult += '\n║  ACTION REQUIRED:                              ║';
              finalResult += '\n║  If all answers suggest you should stop →      ║';
              finalResult += '\n║  Reply "NO" or call stop tool NOW              ║';
              finalResult += '\n╚════════════════════════════════════════════════╝';
            } else {
              // Standard reminder for other tools
              finalResult += '\n\n╔════════════════════════════════════════════════╗';
              finalResult += '\n║  TASK CHECKLIST & REPETITION DETECTION         ║';
              finalResult += '\n╚════════════════════════════════════════════════╝';
              finalResult += '\n';
              finalResult += '\n📋 CHECKLIST STATUS:';
              finalResult += '\n   → Review your task checklist';
              finalResult += '\n   → Mark current step as ✓ DONE';
              finalResult += '\n   → Count remaining steps';
              finalResult += '\n';
              finalResult += '\n🔄 REPETITION CHECK:';
              finalResult += '\n   → Are you about to do the same thing again?';
              finalResult += '\n   → Did you already read this file/memory?';
              finalResult += '\n   → Is this action making progress or going in circles?';
              finalResult += '\n';
              finalResult += '\n⏹️  STOP if:';
              finalResult += '\n   ✅ Checklist is 100% complete → reply "NO"';
              finalResult += '\n   ✅ Detecting repetition → reply "NO"';
              finalResult += '\n   ✅ Task goal achieved → reply "NO"';
              finalResult += '\n';
              finalResult += '\n⏩ CONTINUE if:';
              finalResult += '\n   ⏳ More checklist items remain';
              finalResult += '\n   ⏳ This is a new, different action';
            }
          }

          this.context.messages.push({
            role: 'tool',
            content: finalResult,
            tool_call_id: tr.id,
          });
        }

        // Check if we should end the conversation
        if (shouldEndConversation) {
          console.log('[Engine] Ending conversation as requested');
          // Mark response as already shown to prevent duplicate display
          return `[MSG_ALREADY_SHOWN]${finalResponse}`;
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

      // If qq tool was called in this session, mark response to prevent duplicate
      if (this.qqToolCalledInSession) {
        console.log('[Engine] qq tool was called in this session, marking response');
        return `[MSG_ALREADY_SHOWN]${message.content || ''}`;
      }

      // Filter out explanatory responses - AI should only return "NO" or actual message
      const content = message.content || '';
      if (content.toLowerCase().includes('no response') ||
          content.toLowerCase().includes('no reply') ||
          content.toLowerCase().includes('response requested') ||
          content.toLowerCase().includes('not relevant')) {
        console.log('[Engine] Blocking explanatory response:', content);
        return 'NO';
      }

      return content || '[No response]';
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

    // Build recent actions section (concise)
    let recentActionsPrompt = '';
    if (this.recentToolCalls.length > 0) {
      recentActionsPrompt = `\n\n## Recent Actions\n`;
      this.recentToolCalls.slice(-5).forEach((call, index) => {
        const time = new Date(call.timestamp).toLocaleTimeString();
        recentActionsPrompt += `${index + 1}. ${time} ${call.toolName}\n`;
      });
      recentActionsPrompt += `\nBefore acting: check if you're about to repeat a recent action. If yes, stop.\n`;
    }

    const taskManagementPrompt = `\n\n## Task Management\n\n` +
      `Before each tool call, ask yourself:\n` +
      `1. Is the task complete? If yes → stop.\n` +
      `2. Is my next action different from recent actions? If no → stop.\n` +
      `3. Am I about to repeat something? If yes → stop.`;

    return `${this.systemPrompt}${recentActionsPrompt}${taskManagementPrompt}\n\n## Current Time\nCurrent time: ${timeStr}\nTimestamp: ${now.toISOString()}`;
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
      // Keep only last MAX_RECENT_CALLS
      if (this.recentToolCalls.length > this.MAX_RECENT_CALLS) {
        this.recentToolCalls.shift();
      }

      let resultText: string;

      // Handle cron tool
      if (fullToolName === 'cron') {
        const result = await executeCronTool(this.context.cronScheduler, toolArgs as CronToolParams);
        resultText = result.message;
      }

      // Handle dynamic tools (e.g., QQ)
      else if (this.dynamicTools.has(fullToolName)) {
        const dynamicTool = this.dynamicTools.get(fullToolName)!;
        // Track if qq tool is called
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

      // It's an MCP tool - parse server and tool name
      else {
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

        resultText = result.content?.[0]?.text || 'Success';
      }

      // Log warning for very long results (but don't truncate)
      const maxToolResultLength = 24000;
      if (resultText.length > maxToolResultLength) {
        console.log(`[Engine] Warning: Tool result is very long (${resultText.length} chars), may affect context window`);
      }

      console.log(`[Engine] Tool result: ${resultText.slice(0, 100)}...`);
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
      // Immediately display to user via handler
      if (this.cliBridgeHandler) {
        this.cliBridgeHandler(message);
      }
      // Return formatted result for conversation history
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
   * Get context window status for display
   */
  getContextStatus(): string {
    return this.contextManager.getStatusDisplay(this.context.messages);
  }

  /**
   * Get detailed context statistics
   */
  getContextStats() {
    return this.contextManager.getStats(this.context.messages);
  }

  /**
   * Force context compaction
   */
  async forceCompaction(level: 'light' | 'medium' | 'heavy' | 'emergency' = 'medium'): Promise<string> {
    const result = await this.contextManager.forceCompaction(this.context.messages, level);
    if (result.report) {
      this.context.messages = result.messages;
      return `Context compacted: ${result.report.originalMessages}→${result.report.compressedMessages} messages, ` +
        `${result.report.originalTokens}→${result.report.compressedTokens} tokens (${result.report.savedPercentage.toFixed(1)}% saved)`;
    }
    return 'No compaction performed';
  }

  /**
   * Process proactive heartbeat check (no user input)
   */
  async processProactive(prompt: string): Promise<string> {
    // Add system message for proactive check
    this.context.messages.push({
      role: 'system',
      content: prompt,
    });

    // Run conversation loop
    return await this.runConversationLoop();
  }

  /**
   * Handle agent turn from cron jobs
   */
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

  // Helper method for sleep/delay
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}