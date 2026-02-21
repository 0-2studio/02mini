/**
 * Channels Command
 * Manage message channels
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../../config/manager.js";

export function registerChannelsCommand(program: Command): void {
  const channelsCmd = program
    .command("channels")
    .description("Manage message channels");

  // List channels
  channelsCmd
    .command("list")
    .description("List all configured channels")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        console.log(chalk.blue("\n📡 Channels\n"));
        
        for (const [name, channelConfig] of Object.entries(config.channels || {})) {
          if (!channelConfig) continue;
          
          const cfg = channelConfig as { enabled: boolean; botToken?: string };
          const status = cfg.enabled 
            ? chalk.green("● enabled") 
            : chalk.gray("○ disabled");
          
          console.log(`${chalk.bold(name)}: ${status}`);
          
          if (cfg.enabled) {
            const configured = cfg.botToken && !cfg.botToken.startsWith("${")
              ? chalk.green("✓ configured")
              : chalk.yellow("⚠ token from env");
            console.log(chalk.gray(`  ${configured}`));
          }
          console.log();
        }
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Enable channel
  channelsCmd
    .command("enable <channel>")
    .description("Enable a channel")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (channel: string, options) => {
      try {
        const config = loadConfig(options.path);
        
        if (!config.channels) {
          config.channels = {};
        }
        
        if (!(channel in config.channels)) {
          console.log(chalk.yellow(`Channel '${channel}' not found in config.`));
          console.log(chalk.gray("Valid channels: telegram, discord, slack, whatsapp, signal, imessage"));
          process.exit(1);
        }
        
        const channelConfig = config.channels[channel as keyof typeof config.channels] as { enabled: boolean };
        channelConfig.enabled = true;
        
        saveConfig(config, options.path);
        console.log(chalk.green(`✅ Channel '${channel}' enabled.`));
        console.log(chalk.gray("Don't forget to set the required environment variables!"));
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Disable channel
  channelsCmd
    .command("disable <channel>")
    .description("Disable a channel")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (channel: string, options) => {
      try {
        const config = loadConfig(options.path);
        
        if (!config.channels || !(channel in config.channels)) {
          console.log(chalk.yellow(`Channel '${channel}' not found.`));
          process.exit(1);
        }
        
        const channelConfig = config.channels[channel as keyof typeof config.channels] as { enabled: boolean };
        channelConfig.enabled = false;
        
        saveConfig(config, options.path);
        console.log(chalk.green(`✅ Channel '${channel}' disabled.`));
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Status command
  channelsCmd
    .command("status")
    .description("Show channel connection status")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        console.log(chalk.blue("\n📡 Channel Status\n"));
        console.log(chalk.gray("(Requires running gateway to check actual connection status)\n"));
        
        for (const [name, channelConfig] of Object.entries(config.channels || {})) {
          if (!channelConfig) continue;
          
          const cfg = channelConfig as { enabled: boolean; botToken?: string };
          const status = cfg.enabled 
            ? (cfg.botToken && !cfg.botToken.startsWith("${") 
                ? chalk.green("● ready") 
                : chalk.yellow("● waiting for token"))
            : chalk.gray("○ disabled");
          
          console.log(`${chalk.bold(name)}: ${status}`);
        }
        
        console.log();
        console.log(chalk.gray("Use '02mini health' to check actual connection status."));
        console.log();
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}