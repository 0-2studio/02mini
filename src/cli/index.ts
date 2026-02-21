/**
 * 02mini CLI Entry Point
 * Complete command-line interface
 */

// Load environment variables from .env file
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

// Try to load .env from current directory
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // Try to load from 02mini directory
  const envPath2 = path.resolve(process.cwd(), "02mini", ".env");
  if (fs.existsSync(envPath2)) {
    dotenv.config({ path: envPath2 });
  }
}

import { Command } from "commander";
import chalk from "chalk";
import { registerSetupCommand } from "./commands/setup.js";
import { registerStartCommand } from "./commands/start.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerGatewayCommand } from "./commands/gateway.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSendCommand } from "./commands/send.js";
import { registerOnboardCommand } from "./commands/onboard.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerChannelsCommand } from "./commands/channels.js";
import { registerMemoryCommand } from "./commands/memory.js";

const program = new Command();

program
  .name("02mini")
  .description("Complete multi-channel AI gateway")
  .version("1.0.0");

// Register all commands
registerStartCommand(program);
registerSetupCommand(program);
registerOnboardCommand(program);
registerConfigCommand(program);
registerDoctorCommand(program);
registerGatewayCommand(program);
registerStatusCommand(program);
registerSendCommand(program);
registerHealthCommand(program);
registerSessionsCommand(program);
registerChannelsCommand(program);
registerMemoryCommand(program);

// Global error handling
program.configureOutput({
  writeErr: (str) => process.stderr.write(chalk.red(str)),
  outputError: (str, write) => write(chalk.red(str)),
});

// Parse arguments
program.parse();
