/**
 * AI Provider Factory
 * Creates appropriate AI provider based on configuration
 */

import type { AiProviderConfig } from "../config/types.js";
import type { AiProvider } from "./types.js";
import { OpenAIProvider, type OpenAIConfig } from "./openai.js";
import { AnthropicProvider, type AnthropicConfig } from "./anthropic.js";

export function createAiProvider(config: AiProviderConfig): AiProvider {
  switch (config.type) {
    case "openai":
      return new OpenAIProvider(config as OpenAIConfig);
    case "anthropic":
      return new AnthropicProvider(config as AnthropicConfig);
    default:
      throw new Error(`Unsupported AI provider: ${config.type}`);
  }
}

export function getAvailableProviders(): string[] {
  return ["openai", "anthropic"];
}

export function getProviderModels(provider: string): string[] {
  switch (provider) {
    case "openai":
      return [
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-4",
        "gpt-3.5-turbo",
      ];
    case "anthropic":
      return [
        "claude-3-5-sonnet-20241022",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
      ];
    default:
      return [];
  }
}

export function getDefaultModel(provider: string): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-haiku-20240307";
    default:
      return "gpt-4o-mini";
  }
}

export function validateProviderConfig(config: AiProviderConfig): string[] {
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push("apiKey is required");
  }

  if (!config.model) {
    errors.push("model is required");
  }

  const validTypes = ["openai", "anthropic", "gemini", "bedrock", "azure", "ollama", "openrouter", "together", "custom"];
  if (!validTypes.includes(config.type)) {
    errors.push(`type must be one of: ${validTypes.join(", ")}`);
  }

  if (config.maxTokens !== undefined && (config.maxTokens < 1 || config.maxTokens > 100000)) {
    errors.push("maxTokens must be between 1 and 100000");
  }

  if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
    errors.push("temperature must be between 0 and 2");
  }

  return errors;
}
