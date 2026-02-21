/**
 * Status Command
 * Display system status
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, resolveConfigPath } from "../../config/manager.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Display system status")
    .option("-p, --path <path>", "Configuration file path")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        // Check environment variables
        const envStatus = {
          OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
          MINI_GATEWAY_TOKEN: !!process.env.MINI_GATEWAY_TOKEN,
          TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
          DISCORD_BOT_TOKEN: !!process.env.DISCORD_BOT_TOKEN,
          SLACK_BOT_TOKEN: !!process.env.SLACK_BOT_TOKEN,
        };
        
        // Check channel status
        const channelStatus: Record<string, { enabled: boolean; configured: boolean }> = {};
        
        for (const [name, channelConfig] of Object.entries(config.channels || {})) {
          if (channelConfig) {
            const cfg = channelConfig as { enabled: boolean; botToken?: string };
            channelStatus[name] = {
              enabled: cfg.enabled,
              configured: !!cfg.botToken || name === "whatsapp" || name === "signal" || name === "imessage",
            };
          }
        }
        
        const status = {
          config: {
            version: config.version,
            name: config.name,
            path: resolveConfigPath(options.path),
          },
          gateway: {
            port: config.gateway.port,
            host: config.gateway.host,
            auth: config.gateway.auth.type,
          },
          ai: {
            type: config.ai.type,
            model: config.ai.model,
          },
          channels: channelStatus,
          environment: envStatus,
          session: {
            scope: config.session?.scope,
            maxHistory: config.session?.maxHistory,
          },
        };
        
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }
        
        console.log(chalk.blue("\n📊 02mini Status\n"));
        
        console.log(chalk.bold("Configuration:"));
        console.log(chalk.gray(`  Version: ${status.config.version}`));
        console.log(chalk.gray(`  Name: ${status.config.name}`));
        console.log();
        
        console.log(chalk.bold("Gateway:"));
        console.log(chalk.gray(`  Port: ${status.gateway.port}`));
        console.log(chalk.gray(`  Host: ${status.gateway.host}`));
        console.log(chalk.gray(`  Auth: ${status.gateway.auth}`));
        console.log();
        
        console.log(chalk.bold("AI Provider:"));
        console.log(chalk.gray(`  Type: ${status.ai.type}`));
        console.log(chalk.gray(`  Model: ${status.ai.model}`));
        console.log();
        
        console.log(chalk.bold("Channels:"));
        for (const [name, info] of Object.entries(status.channels)) {
          const icon = info.enabled 
            ? (info.configured ? chalk.green("✅") : chalk.yellow("⚠️"))
            : chalk.gray("⏸️");
          console.log(chalk.gray(`  ${icon} ${name}: ${info.enabled ? "enabled" : "disabled"}`));
        }
        console.log();
        
        console.log(chalk.bold("Environment:"));
        for (const [name, set] of Object.entries(status.environment)) {
          const icon = set ? chalk.green("✓") : chalk.gray("✗");
          console.log(chalk.gray(`  ${icon} ${name}: ${set ? "set" : "not set"}`));
        }
        console.log();
        
        console.log(chalk.bold("Session:"));
        console.log(chalk.gray(`  Scope: ${status.session.scope}`));
        console.log(chalk.gray(`  Max history: ${status.session.maxHistory}`));
        console.log();
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}