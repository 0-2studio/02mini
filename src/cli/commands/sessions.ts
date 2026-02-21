/**
 * Sessions Command
 * List and manage conversation sessions
 */

import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface SessionData {
  [key: string]: {
    messages: Array<{ role: string; content: string; timestamp: number }>;
    createdAt: number;
    updatedAt: number;
  };
}

function getSessionsPath(configPath?: string): string {
  if (configPath) {
    const dir = path.dirname(configPath);
    return path.join(dir, "sessions.json");
  }
  return path.join(os.homedir(), ".02mini", "sessions.json");
}

export function registerSessionsCommand(program: Command): void {
  const sessionsCmd = program
    .command("sessions")
    .description("List and manage conversation sessions");

  // List sessions
  sessionsCmd
    .command("list")
    .description("List all sessions")
    .option("-p, --path <path>", "Configuration file path")
    .option("-l, --limit <n>", "Limit number of sessions", "10")
    .action(async (options) => {
      try {
        const sessionsPath = getSessionsPath(options.path);
        
        if (!fs.existsSync(sessionsPath)) {
          console.log(chalk.yellow("No sessions found."));
          return;
        }
        
        const data: SessionData = JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
        const sessions = Object.entries(data);
        
        if (sessions.length === 0) {
          console.log(chalk.yellow("No sessions found."));
          return;
        }
        
        // Sort by updatedAt
        sessions.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
        
        const limit = parseInt(options.limit);
        const limited = sessions.slice(0, limit);
        
        console.log(chalk.blue(`\n📂 Sessions (${sessions.length} total, showing ${limited.length})\n`));
        
        for (const [id, session] of limited) {
          const messageCount = session.messages?.length || 0;
          const lastUpdate = new Date(session.updatedAt).toLocaleString();
          
          console.log(chalk.bold(`${id}`));
          console.log(chalk.gray(`  Messages: ${messageCount}`));
          console.log(chalk.gray(`  Last update: ${lastUpdate}`));
          console.log();
        }
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show session details
  sessionsCmd
    .command("show <id>")
    .description("Show session details")
    .option("-p, --path <path>", "Configuration file path")
    .option("-n, --messages <n>", "Number of recent messages to show", "10")
    .action(async (id: string, options) => {
      try {
        const sessionsPath = getSessionsPath(options.path);
        
        if (!fs.existsSync(sessionsPath)) {
          console.log(chalk.yellow("No sessions found."));
          return;
        }
        
        const data: SessionData = JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
        const session = data[id];
        
        if (!session) {
          console.log(chalk.yellow(`Session '${id}' not found.`));
          return;
        }
        
        console.log(chalk.blue(`\n📂 Session: ${id}\n`));
        console.log(chalk.gray(`Created: ${new Date(session.createdAt).toLocaleString()}`));
        console.log(chalk.gray(`Updated: ${new Date(session.updatedAt).toLocaleString()}`));
        console.log(chalk.gray(`Messages: ${session.messages?.length || 0}\n`));
        
        const limit = parseInt(options.messages);
        const messages = session.messages?.slice(-limit) || [];
        
        for (const msg of messages) {
          const roleColor = msg.role === "user" ? chalk.blue : msg.role === "assistant" ? chalk.cyan : chalk.gray;
          console.log(roleColor(`${msg.role}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? "..." : ""}`));
        }
        
        console.log();
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Clear session
  sessionsCmd
    .command("clear [id]")
    .description("Clear a session or all sessions")
    .option("-p, --path <path>", "Configuration file path")
    .option("-a, --all", "Clear all sessions")
    .action(async (id: string | undefined, options) => {
      try {
        const sessionsPath = getSessionsPath(options.path);
        
        if (!fs.existsSync(sessionsPath)) {
          console.log(chalk.yellow("No sessions to clear."));
          return;
        }
        
        if (options.all) {
          fs.unlinkSync(sessionsPath);
          console.log(chalk.green("✅ All sessions cleared."));
        } else if (id) {
          const data: SessionData = JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
          
          if (!data[id]) {
            console.log(chalk.yellow(`Session '${id}' not found.`));
            return;
          }
          
          delete data[id];
          fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
          console.log(chalk.green(`✅ Session '${id}' cleared.`));
        } else {
          console.log(chalk.yellow("Please specify a session ID or use --all"));
          process.exit(1);
        }
        
      } catch (error) {
        console.error(chalk.red("❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}