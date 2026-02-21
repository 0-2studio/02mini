/**
 * Bash Tool - Execute shell commands
 */

import { spawn } from "node:child_process";
import type { ToolsConfig } from "../config/types.js";

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class BashTool {
  private config: ToolsConfig["bash"];

  constructor(config: ToolsConfig["bash"]) {
    this.config = config;
  }

  async execute(command: string, args: string[] = []): Promise<BashResult> {
    if (!this.config?.enabled) {
      throw new Error("Bash tool is disabled");
    }

    // Check allowed commands
    if (this.config.allowedCommands && this.config.allowedCommands.length > 0) {
      const allowed = this.config.allowedCommands.some((cmd: string) => 
        command === cmd || command.startsWith(cmd + " ")
      );
      
      if (!allowed) {
        throw new Error(`Command '${command}' is not in the allowed list`);
      }
    }

    const timeout = this.config.timeout || 30000;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: true,
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
        });
      });

      child.on("error", (error) => {
        reject(error);
      });

      // Timeout handler
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  isEnabled(): boolean {
    return this.config?.enabled || false;
  }
}