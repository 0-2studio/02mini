/**
 * Config Command
 * Manage configuration settings
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, resolveConfigPath } from "../../config/manager.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage configuration settings");

  // Show current config
  configCmd
    .command("show")
    .description("Display current configuration")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        console.log(chalk.blue("\n📋 Current Configuration:\n"));
        console.log(JSON.stringify(config, null, 2));
      } catch (error) {
        console.error(chalk.red("❌ Failed to load config:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Get config value
  configCmd
    .command("get <key>")
    .description("Get a configuration value (dot notation)")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (key: string, options) => {
      try {
        const config = loadConfig(options.path);
        const value = getNestedValue(configToRecord(config), key);
        
        if (value === undefined) {
          console.log(chalk.yellow(`Key '${key}' not found`));
          process.exit(1);
        }
        
        if (typeof value === "object") {
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.log(value);
        }
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Set config value
  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value (dot notation)")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (key: string, value: string, options) => {
      try {
        const config = loadConfig(options.path);
        const parsedValue = parseValue(value);
        
        setNestedValue(configToRecord(config), key, parsedValue);
        saveConfig(config, options.path);
        
        console.log(chalk.green(`✅ Set ${key} = ${value}`));
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Unset config value
  configCmd
    .command("unset <key>")
    .description("Remove a configuration value")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (key: string, options) => {
      try {
        const config = loadConfig(options.path);
        
        unsetNestedValue(configToRecord(config), key);
        saveConfig(config, options.path);
        
        console.log(chalk.green(`✅ Removed ${key}`));
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Edit config in default editor
  configCmd
    .command("edit")
    .description("Open configuration in default editor")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      const configPath = resolveConfigPath(options.path);
      const editor = process.env.EDITOR || "notepad";
      
      import("node:child_process").then(({ spawn }) => {
        const child = spawn(editor, [configPath], {
          stdio: "inherit",
        });
        
        child.on("exit", (code) => {
          if (code === 0) {
            console.log(chalk.green("✅ Editor closed"));
          } else {
            console.log(chalk.yellow(`Editor exited with code ${code}`));
          }
        });
      });
    });

  // Validate config
  configCmd
    .command("validate")
    .description("Validate configuration file")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      try {
        const config = loadConfig(options.path);
        
        // Basic validation
        const errors: string[] = [];
        
        if (!config.gateway) {
          errors.push("Missing required field: gateway");
        } else {
          if (typeof config.gateway.port !== "number") {
            errors.push("gateway.port must be a number");
          }
          if (!config.gateway.auth) {
            errors.push("gateway.auth is required");
          }
        }
        
        if (!config.ai) {
          errors.push("Missing required field: ai");
        } else {
          const validProviders = ["openai", "anthropic", "gemini", "bedrock", "azure", "ollama", "openrouter", "together", "custom"];
          if (!validProviders.includes(config.ai.type)) {
            errors.push(`ai.type must be one of: ${validProviders.join(", ")}`);
          }
          if (!config.ai.apiKey) {
            errors.push("ai.apiKey is required");
          }
          if (!config.ai.model) {
            errors.push("ai.model is required");
          }
        }
        
        if (errors.length > 0) {
          console.log(chalk.red("\n❌ Validation failed:"));
          errors.forEach((err) => console.log(chalk.red(`   • ${err}`)));
          process.exit(1);
        }
        
        console.log(chalk.green("\n✅ Configuration is valid"));
        
      } catch (error) {
        console.error(chalk.red("❌ Validation error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

// Helper functions
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  
  current[keys[keys.length - 1]] = value;
}

function unsetNestedValue(obj: Record<string, unknown>, path: string): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object") {
      return;
    }
    current = current[key] as Record<string, unknown>;
  }
  
  delete current[keys[keys.length - 1]];
}

// Type helper to convert MiniConfig to Record
function configToRecord(config: unknown): Record<string, unknown> {
  return config as Record<string, unknown>;
}

function parseValue(value: string): unknown {
  // Try to parse as JSON
  try {
    return JSON.parse(value);
  } catch {
    // Return as string
    return value;
  }
}
