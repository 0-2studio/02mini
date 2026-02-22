/**
 * CLI Interface
 * Command line interface for 02
 */

import readline from 'readline';
import { CoreEngine, type Message } from '../core/engine.js';
import { MCPManager, mcpManager } from '../mcp/manager.js';
import { SkillRegistry } from '../skills-impl/skill-registry.js';
import fs from 'fs/promises';
import path from 'path';

export class CLIInterface {
  private rl?: readline.Interface;
  private engine?: CoreEngine;
  private mcpManager: MCPManager;
  private skillRegistry: SkillRegistry;
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.mcpManager = mcpManager;
    this.skillRegistry = new SkillRegistry(path.join(workingDir, 'skills'));
  }

  async start(): Promise<void> {
    console.clear();
    console.log('╔══════════════════════════════════════╗');
    console.log('║                                      ║');
    console.log('║     02 - Self-Aware AI System        ║');
    console.log('║                                      ║');
    console.log('╚══════════════════════════════════════╝');
    console.log();

    // Initialize
    await this.initialize();

    // Start CLI
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\nType your message (or "exit" to quit):\n');
    this.prompt();
  }

  private async initialize(): Promise<void> {
    // Load MCP
    console.log('[Init] Loading MCP servers...');
    await this.mcpManager.initialize();

    // Discover skills
    console.log('[Init] Discovering skills...');
    await this.skillRegistry.discoverSkills();

    // Create engine
    console.log('[Init] Starting core engine...');
    this.engine = new CoreEngine({
      messages: [],
      mcpManager: this.mcpManager,
      skillRegistry: this.skillRegistry,
      workingDir: this.workingDir,
    });

    // Show loaded skills
    const skills = this.skillRegistry.getAllSkills();
    console.log(`\n[Init] Loaded ${skills.length} skills:`);
    for (const skill of skills) {
      console.log(`  • ${skill.name}`);
    }

    // Show MCP servers
    const servers = this.mcpManager.getConnectedServers();
    console.log(`\n[Init] Connected MCP servers:`);
    for (const server of servers) {
      console.log(`  • ${server}`);
    }

    console.log('\n[Init] Ready!\n');
  }

  private prompt(): void {
    this.rl?.question('You: ', async (input) => {
      if (input.toLowerCase() === 'exit') {
        await this.shutdown();
        return;
      }

      if (input.toLowerCase() === 'skills') {
        this.listSkills();
        this.prompt();
        return;
      }

      if (input.toLowerCase() === 'mcp') {
        this.listMCPTools();
        this.prompt();
        return;
      }

      if (input.toLowerCase().startsWith('read ')) {
        const file = input.slice(5).trim();
        await this.readFile(file);
        this.prompt();
        return;
      }

      // Process input
      if (this.engine) {
        try {
          const response = await this.engine.processUserInput(input);
          // Send via cli-bridge (in real implementation)
          console.log(`\n02: ${response}\n`);
        } catch (error) {
          console.error('Error:', error);
        }
      }

      this.prompt();
    });
  }

  private listSkills(): void {
    const skills = this.skillRegistry.getAllSkills();
    console.log('\n--- Available Skills ---');
    for (const skill of skills) {
      console.log(`\n${skill.name}:`);
      console.log(`  ${skill.description}`);
      console.log(`  Triggers: ${skill.triggers.join(', ')}`);
    }
    console.log('');
  }

  private listMCPTools(): void {
    const tools = this.mcpManager.getAllTools();
    console.log('\n--- Available MCP Tools ---');
    for (const { server, tool } of tools) {
      console.log(`\n[${server}] ${tool.name}:`);
      console.log(`  ${tool.description}`);
    }
    console.log('');
  }

  private async readFile(filePath: string): Promise<void> {
    try {
      const result = await this.mcpManager.callTool('read_file', { path: filePath });
      if (result.isError) {
        console.log(`\nError reading file: ${result.content[0]?.text}\n`);
      } else {
        console.log(`\n--- ${filePath} ---`);
        console.log(result.content[0]?.text || 'Empty file');
        console.log('');
      }
    } catch (error) {
      console.log(`\nError: ${error}\n`);
    }
  }

  private async shutdown(): Promise<void> {
    console.log('\n[Shutdown] Disconnecting MCP...');
    this.mcpManager.disconnectAll();
    console.log('[Shutdown] Goodbye!\n');
    this.rl?.close();
    process.exit(0);
  }
}
