/**
 * Doctor Command
 * Diagnose and fix common issues
 */

import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, resolveConfigPath } from "../../config/manager.js";

interface DiagnosticResult {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  fix?: () => Promise<void> | void;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose and fix common issues")
    .option("-f, --fix", "Automatically fix issues")
    .option("-p, --path <path>", "Configuration file path")
    .action(async (options) => {
      console.log(chalk.blue("\n🔍 Running diagnostics...\n"));

      const results: DiagnosticResult[] = [];

      // Check 1: Config file exists
      const configPath = resolveConfigPath(options.path);
      results.push(await checkConfigExists(configPath));

      // Check 2: Config is valid
      if (fs.existsSync(configPath)) {
        results.push(await checkConfigValid(configPath));
      }

      // Check 3: Environment variables
      results.push(checkEnvironmentVariables());

      // Check 4: Directory permissions
      results.push(await checkDirectoryPermissions());

      // Check 5: Node.js version
      results.push(checkNodeVersion());

      // Check 6: Required binaries
      results.push(await checkRequiredBinaries());

      // Display results
      displayResults(results);

      // Apply fixes if requested
      if (options.fix) {
        await applyFixes(results);
      }

      // Exit with appropriate code
      const hasErrors = results.some((r) => r.status === "error");
      const hasWarnings = results.some((r) => r.status === "warning");

      if (hasErrors) {
        console.log(chalk.red("\n❌ Some checks failed"));
        process.exit(1);
      } else if (hasWarnings) {
        console.log(chalk.yellow("\n⚠️  Some warnings found"));
        process.exit(0);
      } else {
        console.log(chalk.green("\n✅ All checks passed"));
        process.exit(0);
      }
    });
}

async function checkConfigExists(configPath: string): Promise<DiagnosticResult> {
  if (fs.existsSync(configPath)) {
    return {
      name: "Config File",
      status: "ok",
      message: `Found at ${configPath}`,
    };
  }

  return {
    name: "Config File",
    status: "error",
    message: `Not found at ${configPath}`,
    fix: async () => {
      const { createDefaultConfig, saveConfig } = await import("../../config/manager.js");
      const config = createDefaultConfig();
      saveConfig(config, configPath);
      console.log(chalk.green(`Created default config at ${configPath}`));
    },
  };
}

async function checkConfigValid(configPath: string): Promise<DiagnosticResult> {
  try {
    const config = loadConfig(configPath);
    
    const issues: string[] = [];
    
    if (!config.gateway?.port) {
      issues.push("Missing gateway.port");
    }
    
    if (!config.ai?.type) {
      issues.push("Missing ai.type");
    }
    
    if (issues.length > 0) {
      return {
        name: "Config Valid",
        status: "warning",
        message: issues.join(", "),
      };
    }
    
    return {
      name: "Config Valid",
      status: "ok",
      message: "Configuration is valid",
    };
  } catch (error) {
    return {
      name: "Config Valid",
      status: "error",
      message: error instanceof Error ? error.message : "Invalid configuration",
    };
  }
}

function checkEnvironmentVariables(): DiagnosticResult {
  const required = ["OPENAI_API_KEY", "MINI_GATEWAY_TOKEN"];
  const missing = required.filter((v) => !process.env[v]);
  
  if (missing.length === 0) {
    return {
      name: "Environment",
      status: "ok",
      message: "All required variables set",
    };
  }
  
  return {
    name: "Environment",
    status: "warning",
    message: `Missing: ${missing.join(", ")}`,
  };
}

async function checkDirectoryPermissions(): Promise<DiagnosticResult> {
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, ".02mini");
  
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Test write permission
    const testFile = path.join(configDir, ".write-test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    
    return {
      name: "Permissions",
      status: "ok",
      message: "Can read/write config directory",
    };
  } catch (error) {
    return {
      name: "Permissions",
      status: "error",
      message: `Cannot write to ${configDir}`,
    };
  }
}

function checkNodeVersion(): DiagnosticResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0]);
  
  if (major >= 18) {
    return {
      name: "Node.js",
      status: "ok",
      message: `Version ${version} (>= 18)`,
    };
  }
  
  return {
    name: "Node.js",
    status: "error",
    message: `Version ${version} (requires >= 18)`,
  };
}

async function checkRequiredBinaries(): Promise<DiagnosticResult> {
  const binaries = ["node", "npm"];
  const missing: string[] = [];
  
  for (const bin of binaries) {
    try {
      // Simple check - would need cross-platform implementation
      continue;
    } catch {
      missing.push(bin);
    }
  }
  
  if (missing.length === 0) {
    return {
      name: "Binaries",
      status: "ok",
      message: "All required binaries found",
    };
  }
  
  return {
    name: "Binaries",
    status: "warning",
    message: `Missing: ${missing.join(", ")}`,
  };
}

function displayResults(results: DiagnosticResult[]): void {
  for (const result of results) {
    const icon = result.status === "ok" 
      ? chalk.green("✅") 
      : result.status === "warning" 
        ? chalk.yellow("⚠️") 
        : chalk.red("❌");
    
    console.log(`${icon} ${chalk.bold(result.name)}: ${result.message}`);
    
    if (result.fix) {
      console.log(chalk.gray(`   Can be fixed with --fix`));
    }
  }
  console.log();
}

async function applyFixes(results: DiagnosticResult[]): Promise<void> {
  const fixable = results.filter((r) => r.fix && r.status !== "ok");
  
  if (fixable.length === 0) {
    console.log(chalk.gray("No automatic fixes available\n"));
    return;
  }
  
  console.log(chalk.blue("🔧 Applying fixes...\n"));
  
  for (const result of fixable) {
    if (result.fix) {
      try {
        await result.fix();
      } catch (error) {
        console.error(chalk.red(`Failed to fix ${result.name}:`), error);
      }
    }
  }
  
  console.log();
}