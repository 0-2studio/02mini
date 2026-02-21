/**
 * Setup Command
 * Initialize a new 02mini configuration
 */

import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { createDefaultConfig, saveConfig, resolveConfigPath } from "../../config/manager.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Initialize a new 02mini configuration")
    .option("-f, --force", "Overwrite existing configuration")
    .option("-p, --path <path>", "Custom configuration file path")
    .action(async (options) => {
      console.log(chalk.blue("\n🔧 Setting up 02mini...\n"));

      const configPath = resolveConfigPath(options.path);
      
      // Check if config already exists
      if (fs.existsSync(configPath) && !options.force) {
        console.log(chalk.yellow("⚠️  Configuration already exists:"));
        console.log(chalk.gray(`   ${configPath}`));
        console.log(chalk.gray("\nUse --force to overwrite, or edit the existing file."));
        process.exit(1);
      }

      try {
        // Create default configuration
        const config = createDefaultConfig();
        
        // Ensure directory exists
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }

        // Save configuration
        saveConfig(config, configPath);

        console.log(chalk.green("✅ Configuration created successfully!"));
        console.log(chalk.gray(`   Path: ${configPath}\n`));

        console.log(chalk.blue("📋 Configuration Summary:"));
        console.log(chalk.gray(`   • Gateway port: ${config.gateway.port}`));
        console.log(chalk.gray(`   • AI provider: ${config.ai.type} (${config.ai.model})`));
        console.log(chalk.gray(`   • Session scope: ${config.session?.scope}`));
        console.log(chalk.gray(`   • Tools: ${Object.entries(config.tools || {})
          .filter(([_, v]) => (v as { enabled?: boolean }).enabled)
          .map(([k]) => k)
          .join(", ") || "none"}`));
        console.log();

        console.log(chalk.yellow("⚠️  Environment Variables Required:"));
        console.log(chalk.gray("   Set these before starting the gateway:"));
        console.log(chalk.cyan("   export OPENAI_API_KEY=your_key_here"));
        console.log(chalk.cyan("   export MINI_GATEWAY_TOKEN=your_secure_token"));
        
        if (config.channels?.telegram?.enabled) {
          console.log(chalk.cyan("   export TELEGRAM_BOT_TOKEN=your_bot_token"));
        }
        if (config.channels?.discord?.enabled) {
          console.log(chalk.cyan("   export DISCORD_BOT_TOKEN=your_bot_token"));
        }
        if (config.channels?.slack?.enabled) {
          console.log(chalk.cyan("   export SLACK_BOT_TOKEN=your_bot_token"));
        }

        console.log();
        console.log(chalk.blue("🚀 Next steps:"));
        console.log(chalk.gray("   1. Set environment variables"));
        console.log(chalk.gray("   2. Enable desired channels in config"));
        console.log(chalk.gray("   3. Start the gateway: 02mini gateway start"));
        console.log();

      } catch (error) {
        console.error(chalk.red("\n❌ Failed to create configuration:"));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}