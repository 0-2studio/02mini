/**
 * MCP Client
 * Client for communicating with MCP servers using official SDK
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';
import type { MCPServerConfig, MCPTool, MCPCallToolResult } from './types.js';

export class MCPClient extends EventEmitter {
  private client?: Client;
  private transport?: StdioClientTransport;
  private tools: MCPTool[] = [];
  private ready = false;

  constructor(
    private name: string,
    private config: MCPServerConfig
  ) {
    super();
  }

  async connect(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      // Create client
      this.client = new Client(
        { name: '02mini-mcp-client', version: '1.0.0' },
        { capabilities: {} }
      );

      // Create transport
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.buildEnv(),
      });

      // Connect with timeout (30 seconds)
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);
      });

      await Promise.race([connectPromise, timeoutPromise]);
      if (timeout) clearTimeout(timeout);

      // List tools
      const toolsResponse = await this.client.request(
        { method: 'tools/list' },
        ListToolsResultSchema
      );

      this.tools = toolsResponse.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      this.ready = true;
      console.log(`[MCP:${this.name}] Connected with ${this.tools.length} tools`);

      // Log available tools
      for (const tool of this.tools) {
        console.log(`[MCP:${this.name}]  - ${tool.name}`);
      }

      this.emit('connected', { name: this.name, tools: this.tools.length });
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      console.error(`[MCP:${this.name}] Connection failed:`, error);
      this.emit('error', error);
      this.disconnect();
      throw error;
    }
  }

  private buildEnv(): Record<string, string> {
    const allowedKeys = (process.env.MCP_ENV_ALLOWLIST || 'PATH,Path,HOME,USERPROFILE,TEMP,TMP,SystemRoot,COMSPEC')
      .split(',')
      .map(key => key.trim())
      .filter(Boolean);
    const env: Record<string, string> = {};
    for (const key of allowedKeys) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return { ...env, ...(this.config.env || {}) };
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
    if (!this.client || !this.ready) {
      throw new Error(`MCP client ${this.name} not connected`);
    }

    try {
      const result = await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        },
        CallToolResultSchema
      );

      return {
        content: result.content as Array<{ type: 'text'; text: string }>,
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: String(error) }],
        isError: true,
      };
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  isReady(): boolean {
    return this.ready;
  }

  disconnect(): void {
    this.ready = false;
    if (this.client) {
      this.client.close().catch(() => {});
      this.client = undefined;
    }
    this.transport = undefined;
    this.tools = [];
  }
}
