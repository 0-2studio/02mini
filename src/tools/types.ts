/**
 * Tool System Types
 */

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolContext {
  sessionId: string;
  workspace: string;
  config: unknown;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

export type ToolExecutor = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
