/**
 * Onboard Command
 * Interactive onboarding wizard
 */

import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import readline from "node:readline";
import { createDefaultConfig, saveConfig, resolveConfigPath } from "../../config/manager.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

export function registerOnboardCommand(program: Command): void {
  program
    .command("onboard")
    .description("Interactive onboarding wizard")
    .option("-f, --force", "Overwrite existing configuration")
    .action(async (options) => {
      console.log(chalk.blue("\n🚀 Welcome to 02mini Setup!\n"));
      console.log(chalk.gray("This wizard will help you configure your AI gateway.\n"));

      const configPath = resolveConfigPath();
      
      // Check if config exists
      if (fs.existsSync(configPath) && !options.force) {
        const overwrite = await ask(
          chalk.yellow("Configuration already exists. Overwrite? (y/N): ")
        );
        if (overwrite.toLowerCase() !== "y") {
          console.log(chalk.gray("Setup cancelled."));
          rl.close();
          process.exit(0);
        }
      }

      const config = createDefaultConfig();

      // Step 1: AI Provider
      console.log(chalk.bold("\nStep 1: AI Provider\n"));
      
      const provider = await ask(
        chalk.gray("Choose AI provider (openai/anthropic) [openai]: ")
      );
      config.ai.type = (provider || "openai") as "openai" | "anthropic";

      const apiKey = await ask(
        chalk.gray(`Enter your ${config.ai.type} API key: `)
      );
      config.ai.apiKey = apiKey || "${OPENAI_API_KEY}";

      const model = await ask(
        chalk.gray(`Choose model (gpt-4o-mini/gpt-4o/claude-3-haiku/claude-3-sonnet) [gpt-4o-mini]: `)
      );
      config.ai.model = model || "gpt-4o-mini";

      // Step 2: Gateway
      console.log(chalk.bold("\nStep 2: Gateway Configuration\n"));
      
      const port = await ask(
        chalk.gray("Gateway port [18789]: ")
      );
      config.gateway.port = parseInt(port || "18789");

      const authType = await ask(
        chalk.gray("Authentication type (none/token/password) [token]: ")
      );
      config.gateway.auth.type = (authType || "token") as "none" | "token" | "password";

      if (config.gateway.auth.type === "token") {
        const token = await ask(
          chalk.gray("Enter gateway token (or press Enter to use env var): ")
        );
        config.gateway.auth.token = token || "${MINI_GATEWAY_TOKEN}";
      }

      // Step 3: Channels
      console.log(chalk.bold("\nStep 3: Message Channels\n"));
      
      const enableTelegram = await ask(
        chalk.gray("Enable Telegram? (y/N): ")
      );
      if (enableTelegram.toLowerCase() === "y") {
        config.channels!.telegram!.enabled = true;
        const token = await ask(chalk.gray("Telegram bot token: "));
        config.channels!.telegram!.botToken = token || "${TELEGRAM_BOT_TOKEN}";
      }

      const enableDiscord = await ask(
        chalk.gray("Enable Discord? (y/N): ")
      );
      if (enableDiscord.toLowerCase() === "y") {
        config.channels!.discord!.enabled = true;
        const token = await ask(chalk.gray("Discord bot token: "));
        config.channels!.discord!.botToken = token || "${DISCORD_BOT_TOKEN}";
      }

      const enableSlack = await ask(
        chalk.gray("Enable Slack? (y/N): ")
      );
      if (enableSlack.toLowerCase() === "y") {
        config.channels!.slack!.enabled = true;
        const token = await ask(chalk.gray("Slack bot token: "));
        config.channels!.slack!.botToken = token || "${SLACK_BOT_TOKEN}";
      }

      // Step 4: Tools
      console.log(chalk.bold("\nStep 4: Tools\n"));
      
      const enableBash = await ask(
        chalk.gray("Enable bash tool? (y/N) [y]: ")
      );
      config.tools!.bash!.enabled = enableBash.toLowerCase() !== "n";

      const enableFile = await ask(
        chalk.gray("Enable file tool? (y/N) [y]: ")
      );
      config.tools!.file!.enabled = enableFile.toLowerCase() !== "n";

      const enableWeb = await ask(
        chalk.gray("Enable web tool? (y/N) [y]: ")
      );
      config.tools!.web!.enabled = enableWeb.toLowerCase() !== "n";

      // Save configuration
      console.log(chalk.blue("\n💾 Saving configuration...\n"));
      
      saveConfig(config, configPath);

      console.log(chalk.green("✅ Configuration saved!"));
      console.log(chalk.gray(`   Path: ${configPath}\n`));

      console.log(chalk.blue("🎉 Setup complete!"));
      console.log(chalk.gray("\nNext steps:"));
      console.log(chalk.gray("  1. Set required environment variables"));
      console.log(chalk.gray("  2. Run '02mini doctor' to verify setup"));
      console.log(chalk.gray("  3. Start the gateway with '02mini gateway start'"));
      console.log();

      rl.close();
    });
}