/**
 * Init Command - Initialize configuration
 */

import { Command } from "commander";
import chalk from "chalk";
import { createDefaultConfig, saveConfig } from "../../config/manager.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new configuration file")
    .option("-p, --path <path>", "Configuration file path")
    .option("-f, --force", "Overwrite existing configuration")
    .action(async (options) => {
      console.log(chalk.blue("📦 Initializing 02mini configuration...\n"));

      try {
        const config = createDefaultConfig();
        
        // Add helpful comments
        console.log(chalk.yellow("Configuration created with the following defaults:"));
        console.log(chalk.gray("  • Gateway port: 18789"));
        console.log(chalk.gray("  • Web UI enabled with Material Design 3"));
        console.log(chalk.gray("  • File upload enabled (max 10MB)"));
        console.log(chalk.gray("  • Session stored per-conversation"));
        console.log();
        
        saveConfig(config, options.path);
        
        console.log(chalk.green("✅ Configuration saved successfully!\n"));
        
        console.log(chalk.blue("Next steps:"));
        console.log("  1. Set your API keys as environment variables:");
        console.log(chalk.cyan("     export OPENAI_API_KEY=your_key_here"));
        console.log(chalk.cyan("     export MINI_GATEWAY_TOKEN=your_secure_token"));
        console.log();
        console.log("  2. Start the gateway:");
        console.log(chalk.cyan("     02mini gateway start"));
        console.log();
        console.log("  3. Open your browser at:");
        console.log(chalk.cyan("     http://127.0.0.1:18789"));
        console.log();
        
      } catch (error) {
        console.error(chalk.red("❌ Failed to initialize:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
