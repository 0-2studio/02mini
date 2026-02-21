/**
 * Send Command
 * Send a message to the AI
 */

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../../config/manager.js";
import { createAiProvider } from "../../ai/factory.js";

export function registerSendCommand(program: Command): void {
  program
    .command("send <message>")
    .description("Send a message to the AI")
    .option("-p, --path <path>", "Configuration file path")
    .option("-s, --system <prompt>", "System prompt")
    .option("-m, --model <model>", "Override model")
    .option("--stream", "Stream the response")
    .action(async (message: string, options) => {
      try {
        console.log(chalk.blue("\n💬 Sending message...\n"));
        
        const config = loadConfig(options.path);
        
        // Override model if specified
        if (options.model) {
          config.ai.model = options.model;
        }
        
        // Create AI provider
        const provider = createAiProvider(config.ai);
        
        // Validate provider
        const isValid = await provider.validate();
        if (!isValid) {
          console.error(chalk.red("❌ AI provider validation failed"));
          console.error(chalk.yellow("Check your API key"));
          process.exit(1);
        }
        
        // Prepare messages
        const messages = [];
        
        if (options.system) {
          messages.push({
            id: Date.now().toString(),
            role: "system" as const,
            content: options.system,
            timestamp: Date.now(),
          });
        }
        
        messages.push({
          id: (Date.now() + 1).toString(),
          role: "user" as const,
          content: message,
          timestamp: Date.now(),
        });
        
        console.log(chalk.gray(`You: ${message}\n`));
        
        if (options.stream) {
          // Stream response
          process.stdout.write(chalk.cyan("AI: "));
          
          await provider.chatStream(messages, (chunk) => {
            process.stdout.write(chunk);
          });
          
          console.log("\n");
        } else {
          // Get full response
          const response = await provider.chat(messages);
          
          console.log(chalk.cyan("AI: ") + response.content);
          
          if (response.usage) {
            console.log(chalk.gray(`\nTokens: ${response.usage.totalTokens} ` +
              `(prompt: ${response.usage.promptTokens}, ` +
              `completion: ${response.usage.completionTokens})`));
          }
          
          console.log();
        }
        
      } catch (error) {
        console.error(chalk.red("\n❌ Error:"), 
          error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
