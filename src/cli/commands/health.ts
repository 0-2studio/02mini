/**
 * Health Command
 * Check health of running gateway
 */

import { Command } from "commander";
import chalk from "chalk";
import http from "node:http";
import { loadConfig } from "../../config/manager.js";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Check health of running gateway")
    .option("-p, --path <path>", "Configuration file path")
    .option("--host <host>", "Gateway host")
    .option("--port <port>", "Gateway port")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        const host = options.host || config.gateway.host || "127.0.0.1";
        const port = options.port || config.gateway.port;
        
        const healthUrl = `http://${host}:${port}/health`;
        
        console.log(chalk.gray(`Checking health at ${healthUrl}...\n`));
        
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.get(healthUrl, (res) => {
            resolve(res);
          });
          
          req.on("error", (err) => {
            reject(err);
          });
          
          req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error("Request timeout"));
          });
        });
        
        let data = "";
        for await (const chunk of response) {
          data += chunk;
        }
        
        const health = JSON.parse(data);
        
        if (options.json) {
          console.log(JSON.stringify(health, null, 2));
          return;
        }
        
        console.log(chalk.blue("📊 Gateway Health\n"));
        
        const status = health.status === "ok" ? chalk.green("✅ Healthy") : chalk.red("❌ Unhealthy");
        console.log(`Status: ${status}`);
        console.log(chalk.gray(`  Version: ${health.version || "unknown"}`));
        console.log(chalk.gray(`  Uptime: ${formatUptime(health.uptime || 0)}`));
        
        if (health.channels) {
          console.log(chalk.bold("\nChannels:"));
          for (const [name, status] of Object.entries(health.channels)) {
            const icon = (status as { connected: boolean }).connected 
              ? chalk.green("✓") 
              : chalk.gray("✗");
            console.log(chalk.gray(`  ${icon} ${name}`));
          }
        }
        
        if (health.sessions) {
          console.log(chalk.bold("\nSessions:"));
          console.log(chalk.gray(`  Active: ${health.sessions.active || 0}`));
          console.log(chalk.gray(`  Total: ${health.sessions.total || 0}`));
        }
        
        console.log();
        
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2));
        } else {
          console.error(chalk.red("\n❌ Health check failed:"));
          console.error(chalk.gray(`  ${error instanceof Error ? error.message : error}`));
          console.error(chalk.gray("\nIs the gateway running?"));
          console.error(chalk.gray("Start it with: 02mini gateway start"));
        }
        process.exit(1);
      }
    });
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}
