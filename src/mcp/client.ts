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
        env: { ...process.env, ...(this.config.env || {}) } as Record<string, string>,
      });

      // Connect with timeout
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });

      await Promise.race([connectPromise, timeoutPromise]);

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
      console.error(`[MCP:${this.name}] Connection failed:`, error);
      this.emit('error', error);
      throw error;
    }
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
