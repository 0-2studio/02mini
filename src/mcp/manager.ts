/**
 * MCP Manager
 * Manages multiple MCP server connections using official SDK
 */

import fs from 'fs/promises';
import path from 'path';
import { MCPClient } from './client.js';
import type { MCPConfig, MCPTool, MCPCallToolResult } from './types.js';

export class MCPManager {
  private clients = new Map<string, MCPClient>();
  private config?: MCPConfig;

  async loadConfig(configPath: string): Promise<void> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      this.config = JSON.parse(content) as MCPConfig;
    } catch (error) {
      console.warn(`[MCP] Failed to load config from ${configPath}:`, error);
      this.config = { mcpServers: {} };
    }
  }

  async initialize(): Promise<void> {
    // Load config if not already loaded
    if (!this.config) {
      const configPaths = [
        './mcp-config.json',
        path.join(process.cwd(), 'mcp-config.json'),
      ];

      for (const configPath of configPaths) {
        try {
          await this.loadConfig(configPath);
          if (Object.keys(this.config?.mcpServers || {}).length > 0) {
            console.log(`[MCP] Loaded config from ${configPath}`);
            break;
          }
        } catch {
          // Continue to next path
        }
      }
    }

    if (!this.config || Object.keys(this.config.mcpServers).length === 0) {
      console.log('[MCP] No MCP servers configured');
      return;
    }

    // Connect to all servers
    console.log(`[MCP] Connecting to ${Object.keys(this.config.mcpServers).length} server(s)...`);

    const results = await Promise.allSettled(
      Object.entries(this.config.mcpServers).map(async ([name, serverConfig]) => {
        try {
          const client = new MCPClient(name, serverConfig);
          await client.connect();
          this.clients.set(name, client);
          console.log(`[MCP] ✓ Connected to server: ${name}`);
        } catch (error) {
          console.error(`[MCP] ✗ Failed to connect to ${name}:`, error);
        }
      })
    );

    const connected = this.clients.size;
    const total = Object.keys(this.config.mcpServers).length;
    console.log(`[MCP] Connected: ${connected}/${total} servers`);
  }

  getAllTools(): Array<{ server: string; tool: MCPTool }> {
    const tools: Array<{ server: string; tool: MCPTool }> = [];
    for (const [serverName, client] of this.clients) {
      if (client.isReady()) {
        for (const tool of client.getTools()) {
          tools.push({ server: serverName, tool });
        }
      }
    }
    return tools;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPCallToolResult> {
    // Try to find the tool in any connected server
    for (const [serverName, client] of this.clients) {
      if (!client.isReady()) continue;

      const tools = client.getTools();
      const tool = tools.find(t => t.name === toolName);

      if (tool) {
        console.log(`[MCP] Calling ${toolName} on server ${serverName}`);
        return await client.callTool(toolName, args);
      }
    }

    throw new Error(`Tool '${toolName}' not found in any connected MCP server`);
  }

  async callToolOnServer(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPCallToolResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server '${serverName}' not connected`);
    }
    if (!client.isReady()) {
      throw new Error(`MCP server '${serverName}' not ready`);
    }
    return await client.callTool(toolName, args);
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, client]) => client.isReady())
      .map(([name]) => name);
  }

  hasConnections(): boolean {
    for (const client of this.clients.values()) {
      if (client.isReady()) return true;
    }
    return false;
  }

  disconnectAll(): void {
    for (const [name, client] of this.clients) {
      console.log(`[MCP] Disconnecting ${name}`);
      client.disconnect();
    }
    this.clients.clear();
  }
}

export const mcpManager = new MCPManager();