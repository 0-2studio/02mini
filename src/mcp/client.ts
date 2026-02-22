/**
 * MCP Client
 * Client for communicating with MCP servers via stdio
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { MCPServerConfig, MCPTool, MCPCallToolResult } from './types.js';

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export class MCPClient extends EventEmitter {
  private process?: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private tools: MCPTool[] = [];
  private ready = false;

  constructor(
    private name: string,
    private config: MCPServerConfig
  ) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { command, args, env } = this.config;

      const resolvedEnv: Record<string, string> = {};
      if (env) {
        for (const [key, value] of Object.entries(env)) {
          resolvedEnv[key] = value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
            return process.env[varName] || '';
          });
        }
      }

      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...resolvedEnv },
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const log = data.toString().trim();
        if (log) {
          console.log(`[MCP:${this.name}] ${log}`);
        }
      });

      this.process.on('exit', (code) => {
        this.ready = false;
        this.emit('disconnect', code);
        for (const pending of this.pendingRequests.values()) {
          pending.reject(new Error(`MCP server ${this.name} disconnected`));
        }
        this.pendingRequests.clear();
      });

      this.process.on('error', (error) => {
        reject(new Error(`Failed to start MCP server ${this.name}: ${error.message}`));
      });

      setTimeout(async () => {
        try {
          await this.initialize();
          this.ready = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 1000);
    });
  }

  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: '02', version: '1.0.0' },
    });

    const result = await this.sendRequest('tools/list', {}) as { tools: MCPTool[] };
    this.tools = result.tools || [];
    console.log(`[MCP:${this.name}] Connected with ${this.tools.length} tools`);
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JSONRPCResponse;
        if (message.id !== undefined) {
          const pending = this.pendingRequests.get(message.id);
          if (pending) {
            this.pendingRequests.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error.message));
            } else {
              pending.resolve(message.result);
            }
          }
        }
      } catch {
        // Invalid JSON
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin || !this.ready) {
        reject(new Error(`MCP client ${this.name} not connected`));
        return;
      }

      const id = ++this.requestId;
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 60000);
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
    return await this.sendRequest('tools/call', {
      name,
      arguments: args,
    }) as MCPCallToolResult;
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  isReady(): boolean {
    return this.ready;
  }

  disconnect(): void {
    this.ready = false;
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('MCP client disconnected'));
    }
    this.pendingRequests.clear();
  }
}