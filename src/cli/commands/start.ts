/**
 * Start Command
 * One-click start gateway + web interface
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, createDefaultConfig, saveConfig, resolveConfigPath } from "../../config/manager.js";
import { GatewayServer } from "../../gateway/server.js";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

let gateway: GatewayServer | null = null;
let isShuttingDown = false;

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start 02mini gateway and web interface")
    .option("-p, --path <path>", "Configuration file path")
    .option("--port <port>", "Gateway port", "18789")
    .option("--host <host>", "Gateway host", "127.0.0.1")
    .option("--no-browser", "Don't open browser automatically")
    .action(async (options) => {
      // Check if config exists, create if not
      const configPath = resolveConfigPath(options.path);
      
      if (!fs.existsSync(configPath)) {
        console.log(chalk.yellow("⚠️  No configuration found. Creating default config...\n"));
        
        // Ensure directory exists
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        
        // Create default config
        const defaultConfig = createDefaultConfig();
        defaultConfig.gateway.port = parseInt(options.port);
        defaultConfig.gateway.host = options.host;
        
        saveConfig(defaultConfig, configPath);
        console.log(chalk.green(`✅ Configuration created: ${configPath}\n`));
      }

      console.log(chalk.blue("🚀 Starting 02mini...\n"));

      try {
        // Load configuration
        const config = loadConfig(options.path);
        
        // Apply command line overrides
        config.gateway.port = parseInt(options.port);
        config.gateway.host = options.host;
        
        console.log(chalk.gray(`Config: ${configPath}`));
        console.log(chalk.gray(`Gateway: http://${config.gateway.host}:${config.gateway.port}`));
        console.log(chalk.gray(`AI: ${config.ai.type} (${config.ai.model})`));
        console.log(chalk.gray(`Auth: ${config.gateway.auth.type}`));
        
        if (config.ai.apiKey.includes("${") || !config.ai.apiKey) {
          console.log(chalk.yellow("\n⚠️  Warning: AI API key not set!"));
          console.log(chalk.gray("Set it via environment variable or edit the config file."));
        }
        
        console.log();
        
        // Create and start gateway
        gateway = new GatewayServer(config);
        
        // Setup shutdown handlers
        setupShutdownHandlers();
        
        await gateway.start();
        
        console.log(chalk.green("✅ Gateway is running!\n"));
        console.log(chalk.cyan(`🌐 Open: http://${config.gateway.host}:${config.gateway.port}\n`));
        
        // Open browser if requested
        if (options.browser) {
          const url = `http://${config.gateway.host}:${config.gateway.port}`;
          console.log(chalk.gray(`Opening browser...`));
          
          const platform = os.platform();
          let command: string;
          
          if (platform === "win32") {
            command = `start "" "${url}"`;
          } else if (platform === "darwin") {
            command = `open "${url}"`;
          } else {
            command = `xdg-open "${url}"`;
          }
          
          spawn(command, { shell: true, detached: true, stdio: "ignore" });
        }
        
        console.log(chalk.gray("Press Ctrl+C to stop\n"));
        
        // Keep process running
        await new Promise(() => {});
        
      } catch (error) {
        console.error(chalk.red("\n❌ Failed to start:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.log(chalk.yellow("\n⚠️  Force exit..."));
      process.exit(1);
      return;
    }
    
    isShuttingDown = true;
    console.log(chalk.yellow(`\n\nReceived ${signal}, shutting down...`));
    
    try {
      if (gateway && gateway.isRunning()) {
        // Set a timeout to force exit if graceful shutdown takes too long
        const forceExitTimeout = setTimeout(() => {
          console.log(chalk.red("\n⚠️  Shutdown timeout, forcing exit..."));
          process.exit(1);
        }, 5000);
        
        await gateway.stop();
        clearTimeout(forceExitTimeout);
      }
      
      console.log(chalk.green("✅ Stopped"));
      process.exit(0);
    } catch (error) {
      console.error(chalk.red("\n❌ Error during shutdown:"), error);
      process.exit(1);
    }
  };

  // Handle Ctrl+C
  process.on("SIGINT", () => shutdown("SIGINT"));
  
  // Handle termination
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  
  // Windows specific
  if (process.platform === "win32") {
    process.on("message", (msg) => {
      if (msg === "shutdown") {
        shutdown("message");
      }
    });
    
    // Handle Windows Ctrl+Break
    process.on("SIGBREAK", () => shutdown("SIGBREAK"));
  }
  
  // Handle uncaught errors gracefully
  process.on("uncaughtException", async (error) => {
    console.error(chalk.red("\n❌ Uncaught exception:"), error);
    await shutdown("uncaughtException");
  });
  
  process.on("unhandledRejection", async (reason) => {
    console.error(chalk.red("\n❌ Unhandled rejection:"), reason);
    await shutdown("unhandledRejection");
  });
}