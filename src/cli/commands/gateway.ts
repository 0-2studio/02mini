/**
 * Gateway Command
 * Start and manage the gateway server
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../../config/manager.js";
import { GatewayServer } from "../../gateway/server.js";

let gateway: GatewayServer | null = null;

export function registerGatewayCommand(program: Command): void {
  const gatewayCmd = program
    .command("gateway")
    .description("Manage the gateway server");

  // Start command
  gatewayCmd
    .command("start")
    .description("Start the gateway server")
    .option("-p, --path <path>", "Configuration file path")
    .option("--port <port>", "Override gateway port")
    .option("--host <host>", "Override gateway host")
    .action(async (options) => {
      console.log(chalk.blue("\n🚀 Starting 02mini gateway...\n"));

      try {
        // Load configuration
        const config = loadConfig(options.path);
        
        // Apply overrides
        if (options.port) {
          config.gateway.port = parseInt(options.port);
        }
        if (options.host) {
          config.gateway.host = options.host;
        }
        
        console.log(chalk.gray(`Config loaded`));
        console.log(chalk.gray(`Gateway: ${config.gateway.host}:${config.gateway.port}`));
        console.log(chalk.gray(`AI Provider: ${config.ai.type} (${config.ai.model})`));
        
        // Create and start gateway
        gateway = new GatewayServer(config);
        
        // Setup shutdown handlers
        setupShutdownHandlers();
        
        await gateway.start();
        
        console.log();
        console.log(chalk.green("✅ Gateway is running!"));
        console.log(chalk.gray(`   URL: http://${config.gateway.host}:${config.gateway.port}`));
        
        if (config.gateway.auth.type !== "none") {
          console.log(chalk.gray(`   Auth: ${config.gateway.auth.type}`));
        }
        
        console.log();
        console.log(chalk.blue("Press Ctrl+C to stop"));
        
        // Keep process running
        await new Promise(() => {});
        
      } catch (error) {
        console.error();
        console.error(chalk.red("❌ Failed to start gateway:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Stop command
  gatewayCmd
    .command("stop")
    .description("Stop the gateway server")
    .action(async () => {
      if (gateway?.isRunning()) {
        await gateway.stop();
        console.log(chalk.green("✅ Gateway stopped"));
      } else {
        console.log(chalk.yellow("⚠️  Gateway is not running"));
      }
    });

  // Status command
  gatewayCmd
    .command("status")
    .description("Check gateway status")
    .action(async () => {
      // In a real implementation, this would check if the gateway is running
      // by trying to connect to the WebSocket or checking a PID file
      console.log(chalk.yellow("⚠️  Gateway status check not implemented"));
      console.log(chalk.gray("Use '02mini health' to check running gateway"));
    });

  // Restart command
  gatewayCmd
    .command("restart")
    .description("Restart the gateway server")
    .action(async () => {
      console.log(chalk.blue("🔄 Restarting gateway..."));
      
      if (gateway?.isRunning()) {
        await gateway.stop();
      }
      
      // Would need to re-run the start command
      console.log(chalk.yellow("Please run '02mini gateway start' manually"));
    });
}

function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    console.log();
    console.log(chalk.yellow(`\nReceived ${signal}, shutting down...`));
    
    if (gateway) {
      await gateway.stop();
    }
    
    console.log(chalk.green("Goodbye!"));
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  
  // Windows doesn't support SIGINT properly
  if (process.platform === "win32") {
    process.on("message", (msg) => {
      if (msg === "shutdown") {
        shutdown("message");
      }
    });
  }
  
  // Handle uncaught errors
  process.on("uncaughtException", async (error) => {
    console.error(chalk.red("\n❌ Uncaught exception:"), error);
    if (gateway) {
      await gateway.stop();
    }
    process.exit(1);
  });
  
  process.on("unhandledRejection", async (reason) => {
    console.error(chalk.red("\n❌ Unhandled rejection:"), reason);
    if (gateway) {
      await gateway.stop();
    }
    process.exit(1);
  });
}