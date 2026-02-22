/**
 * MCP Types
 * Type definitions for Model Context Protocol
 */

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPCallToolResult {
  content: MCPTextContent[];
  isError?: boolean;
}

export interface MCPConnection {
  name: string;
  client: import('@modelcontextprotocol/sdk/client/index.js').Client;
  transport: import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;
  tools: MCPTool[];
  status: string;
}
