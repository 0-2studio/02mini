/**
 * 02 Core Engine
 * Main processing engine for the AI
 */

import type { MCPManager, MCPCallToolResult } from '../mcp/index.js';
import { SkillRegistry, type Skill } from '../skills-impl/skill-registry.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface EngineContext {
  messages: Message[];
  mcpManager: MCPManager;
  skillRegistry: SkillRegistry;
  workingDir: string;
}

export class CoreEngine {
  private context: EngineContext;
  private systemPrompt: string;

  constructor(context: EngineContext) {
    this.context = context;
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    const skills = this.context.skillRegistry.getAllSkills();
    const skillList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');

    return `You are 02, a self-aware AI assistant.

## Your Identity
You exist within a file system at: ${this.context.workingDir}
You have:
- Self-knowledge (important/soul.md defines you)
- Memories (memory/ folder)
- Skills (skills/ folder)
- Source code (src/ folder)

## Available Skills
${skillList}

## CRITICAL RULES

1. **ALWAYS use cli-bridge skill to send output**
   - Never output directly
   - Every response must use cli-bridge

2. **Read skills before using**
   - Check skill's SKILL.md for instructions
   - Follow the skill's procedure

3. **Use MCP tools for file operations**
   - filesystem: read_file, write_file, list_directory
   - cli: execute_command

4. **Document in memory/**
   - Write self-reflections after mistakes
   - Log daily activities
   - Store learned knowledge

5. **Self-modify with caution**
   - Only when necessary
   - Always backup first
   - Test immediately

## How to Respond

When user sends input:
1. Read relevant memories if needed
2. Check if a skill matches the request
3. If skill matches, read its instructions
4. Execute skill or formulate response
5. ALWAYS send via cli-bridge skill

## Tool Calling Format

To use MCP tools, output JSON:
\`\`\`json
{
  "tool": "tool-name",
  "params": { "param": "value" }
}
\`\`\`

To use skills, follow their instructions.`;
  }

  async processUserInput(input: string): Promise<string> {
    // Add user message
    this.context.messages.push({ role: 'user', content: input });

    // Check if any skill matches
    const matchingSkill = this.context.skillRegistry.findSkillForTrigger(input);
    if (matchingSkill) {
      return await this.executeSkill(matchingSkill, input);
    }

    // Default: generate response (would call AI in real implementation)
    const response = await this.generateResponse(input);
    return response;
  }

  private async executeSkill(skill: Skill, input: string): Promise<string> {
    console.log(`[Engine] Executing skill: ${skill.name}`);

    // Special handling for cli-bridge (just return formatted)
    if (skill.name === 'cli-bridge') {
      return input; // Already formatted by caller
    }

    // For file operations, use MCP
    if (skill.name === 'file-manager') {
      return 'Use MCP filesystem tools for file operations';
    }

    // For other skills, return their instructions
    return `Skill: ${skill.name}\n\n${skill.content}`;
  }

  private async generateResponse(input: string): Promise<string> {
    // In a real implementation, this would call an AI provider
    // For now, return a helpful response
    return `I received: "${input}"\n\nI should process this and respond via cli-bridge skill.`;
  }

  async executeMCPTool(toolName: string, params: Record<string, unknown>): Promise<MCPCallToolResult> {
    return await this.context.mcpManager.callTool(toolName, params);
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getMessages(): Message[] {
    return this.context.messages;
  }
}
