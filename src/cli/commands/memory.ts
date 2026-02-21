/**
 * Memory Command
 * Search and manage memory
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../../config/manager.js";

export function registerMemoryCommand(program: Command): void {
  const memoryCmd = program
    .command("memory")
    .description("Search and manage memory");

  // Search memory
  memoryCmd
    .command("search <query>")
    .description("Search memory for relevant information")
    .option("-p, --path <path>", "Configuration file path")
    .option("-n, --limit <n>", "Number of results", "5")
    .option("-j, --json", "Output as JSON")
    .action(async (query: string, options) => {
      try {
        const config = loadConfig(options.path);
        
        if (!config.memory?.enabled) {
          console.log(chalk.yellow("\n⚠️  Memory is not enabled."));
          console.log(chalk.gray("Enable it in config: memory.enabled = true"));
          process.exit(1);
        }
        
        // This would connect to the memory backend
        // For now, placeholder implementation
        console.log(chalk.blue(`\n🔍 Searching memory for: "${query}"\n`));
        console.log(chalk.gray("Memory search requires a running gateway."));
        console.log(chalk.gray("Start the gateway first: 02mini gateway start\n"));
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Index sessions
  memoryCmd
    .command("index")
    .description("Index all sessions into memory")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        if (!config.memory?.enabled) {
          console.log(chalk.yellow("\n⚠️  Memory is not enabled."));
          console.log(chalk.gray("Enable it in config: memory.enabled = true"));
          process.exit(1);
        }
        
        console.log(chalk.blue("\n📚 Indexing sessions into memory...\n"));
        console.log(chalk.gray("Session indexing requires a running gateway."));
        console.log(chalk.gray("Start the gateway first: 02mini gateway start\n"));
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Reindex memory
  memoryCmd
    .command("reindex")
    .description("Clear and rebuild memory index")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        if (!config.memory?.enabled) {
          console.log(chalk.yellow("\n⚠️  Memory is not enabled."));
          process.exit(1);
        }
        
        console.log(chalk.blue("\n🔄 Reindexing memory...\n"));
        console.log(chalk.gray("This operation requires a running gateway."));
        console.log(chalk.gray("Start the gateway first: 02mini gateway start\n"));
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Memory status
  memoryCmd
    .command("status")
    .description("Show memory system status")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        console.log(chalk.blue("\n🧠 Memory System Status\n"));
        
        if (!config.memory?.enabled) {
          console.log(chalk.yellow("Status: Disabled"));
          console.log(chalk.gray("\nTo enable memory, set:"));
          console.log(chalk.cyan("  memory.enabled = true"));
          console.log(chalk.gray("\nBackends:"));
          console.log(chalk.gray("  • sqlite - Local SQLite with vector support"));
          console.log(chalk.gray("  • lancedb - LanceDB vector database"));
        } else {
          console.log(chalk.green("Status: Enabled"));
          console.log(chalk.gray(`Backend: ${config.memory.backend || "sqlite"}`));
          console.log(chalk.gray(`Citations: ${config.memory.citations ? "enabled" : "disabled"}`));
          
          if (config.memory.path) {
            console.log(chalk.gray(`Path: ${config.memory.path}`));
          }
        }
        
        console.log();
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}