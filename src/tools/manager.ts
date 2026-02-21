/**
 * Tool Manager
 * Manages and executes tools
 */

import type { Tool, ToolContext, ToolResult, ToolExecutor } from "./types.js";
import { BashTool } from "./bash.js";
import type { ToolsConfig } from "../config/types.js";

export class ToolManager {
  private tools: Map<string, { tool: Tool; executor: ToolExecutor }> = new Map();
  private config: ToolsConfig;

  constructor(config: ToolsConfig) {
    this.config = config;
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    // Register bash tool
    if (this.config.bash?.enabled) {
      const bashTool = new BashTool(this.config.bash!);
      this.registerTool(
        {
          name: "bash",
          description: "Execute shell commands",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "The command to execute",
              },
              args: {
                type: "array",
                description: "Command arguments",
                items: { type: "string" },
              },
            },
            required: ["command"],
          },
        },
        async (args) => {
          const result = await bashTool.execute(
            args.command as string,
            (args.args as string[]) || []
          );
          return {
            success: result.exitCode === 0,
            output: result.stdout || result.stderr,
          };
        }
      );
    }
  }

  registerTool(tool: Tool, executor: ToolExecutor): void {
    this.tools.set(tool.name, { tool, executor });
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values()).map((t) => t.tool);
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const toolEntry = this.tools.get(name);
    if (!toolEntry) {
      return {
        success: false,
        error: `Tool '${name}' not found`,
      };
    }

    try {
      return await toolEntry.executor(args, context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
