/**
 * Configuration Manager
 * Complete configuration management with JSON5 support
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import JSON5 from "json5";
import type { MiniConfig } from "./types.js";

const CONFIG_VERSION = "1.0.0";
const DEFAULT_CONFIG_NAME = "02mini.json";

export function getDefaultConfigPath(): string {
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, ".02mini");
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  return path.join(configDir, DEFAULT_CONFIG_NAME);
}

export function resolveConfigPath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  
  if (process.env.MINI_CONFIG_PATH) {
    return path.resolve(process.env.MINI_CONFIG_PATH);
  }
  
  return getDefaultConfigPath();
}

export class ConfigLoader {
  private configPath: string;
  private loadedFiles: Set<string> = new Set();

  constructor(configPath?: string) {
    this.configPath = resolveConfigPath(configPath);
  }

  async load(): Promise<MiniConfig> {
    this.loadedFiles.clear();
    
    if (!fs.existsSync(this.configPath)) {
      throw new ConfigError(
        `Configuration file not found: ${this.configPath}\n` +
        `Run '02mini setup' to create a new configuration.`
      );
    }
    
    const raw = await this.loadFile(this.configPath);
    const withEnv = this.substituteEnvVars(raw);
    
    return withEnv as MiniConfig;
  }

  private async loadFile(filePath: string): Promise<unknown> {
    if (this.loadedFiles.has(filePath)) {
      throw new Error(`Circular include detected: ${filePath}`);
    }
    
    this.loadedFiles.add(filePath);
    
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON5.parse(content);
    
    if (parsed.$include) {
      const includes = Array.isArray(parsed.$include) 
        ? parsed.$include 
        : [parsed.$include];
      
      delete parsed.$include;
      
      for (const include of includes) {
        const includePath = path.resolve(path.dirname(filePath), include);
        const included = await this.loadFile(includePath);
        Object.assign(parsed, this.deepMerge(parsed, included));
      }
    }
    
    return parsed;
  }

  private substituteEnvVars(obj: unknown): unknown {
    if (typeof obj === "string") {
      return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
        const value = process.env[varName];
        if (value === undefined) {
          console.warn(`[config] Environment variable ${varName} not found`);
          return match;
        }
        return value;
      });
    }
    
    if (Array.isArray(obj)) {
      return obj.map((item) => this.substituteEnvVars(item));
    }
    
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.substituteEnvVars(value);
      }
      return result;
    }
    
    return obj;
  }

  private deepMerge(target: Record<string, unknown>, source: unknown): Record<string, unknown> {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return target;
    }
    
    const result = { ...target };
    
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (
        value && 
        typeof value === "object" && 
        !Array.isArray(value) &&
        key in result &&
        result[key] &&
        typeof result[key] === "object" &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          value
        );
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }
}

export async function loadConfigAsync(configPath?: string): Promise<MiniConfig> {
  return new ConfigLoader(configPath).load();
}

export function loadConfig(configPath?: string): MiniConfig {
  // Synchronous load for simplicity
  const resolvedPath = resolveConfigPath(configPath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new ConfigError(
      `Configuration file not found: ${resolvedPath}\n` +
      `Run '02mini setup' to create a new configuration.`
    );
  }
  
  const content = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = JSON5.parse(content);
  const withEnv = substituteEnvVars(parsed);
  
  // Apply environment variable overrides for AI configuration
  const config = withEnv as MiniConfig;
  applyEnvOverrides(config);
  
  return config;
}

function applyEnvOverrides(config: MiniConfig): void {
  // AI Provider Type
  if (process.env.AI_PROVIDER_TYPE) {
    config.ai.type = process.env.AI_PROVIDER_TYPE as typeof config.ai.type;
  }
  
  // AI API Key
  if (process.env.OPENAI_API_KEY && config.ai.type === "openai") {
    config.ai.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY && config.ai.type === "anthropic") {
    config.ai.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  
  // AI Base URL
  if (process.env.OPENAI_BASE_URL && config.ai.type === "openai") {
    config.ai.baseUrl = process.env.OPENAI_BASE_URL;
  }
  if (process.env.ANTHROPIC_BASE_URL && config.ai.type === "anthropic") {
    config.ai.baseUrl = process.env.ANTHROPIC_BASE_URL;
  }
  
  // AI Model
  if (process.env.OPENAI_MODEL && config.ai.type === "openai") {
    config.ai.model = process.env.OPENAI_MODEL;
  }
  if (process.env.ANTHROPIC_MODEL && config.ai.type === "anthropic") {
    config.ai.model = process.env.ANTHROPIC_MODEL;
  }
  
  // AI Parameters
  if (process.env.AI_MAX_TOKENS) {
    config.ai.maxTokens = parseInt(process.env.AI_MAX_TOKENS);
  }
  if (process.env.AI_TEMPERATURE) {
    config.ai.temperature = parseFloat(process.env.AI_TEMPERATURE);
  }
  
  // OpenAI Organization
  if (process.env.OPENAI_ORGANIZATION) {
    config.ai.organization = process.env.OPENAI_ORGANIZATION;
  }
  
  // Gateway Configuration
  if (process.env.GATEWAY_PORT) {
    config.gateway.port = parseInt(process.env.GATEWAY_PORT);
  }
  if (process.env.GATEWAY_HOST) {
    config.gateway.host = process.env.GATEWAY_HOST;
  }
}

function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        console.warn(`[config] Environment variable ${varName} not found`);
        return match;
      }
      return value;
    });
  }
  
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteEnvVars(item));
  }
  
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  
  return obj;
}

export function saveConfig(config: MiniConfig, configPath?: string): void {
  const resolvedPath = resolveConfigPath(configPath);
  const configDir = path.dirname(resolvedPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  const configToSave = {
    ...config,
    version: CONFIG_VERSION,
    meta: {
      ...config.meta,
      lastTouchedAt: new Date().toISOString(),
    },
  };
  
  fs.writeFileSync(
    resolvedPath,
    JSON.stringify(configToSave, null, 2),
    "utf-8"
  );
}

export function createDefaultConfig(): MiniConfig {
  // Read AI configuration from environment variables
  const aiProvider = process.env.AI_PROVIDER_TYPE || "openai";
  const aiApiKey = aiProvider === "anthropic" 
    ? (process.env.ANTHROPIC_API_KEY || "")
    : (process.env.OPENAI_API_KEY || "");
  const aiBaseUrl = aiProvider === "anthropic"
    ? process.env.ANTHROPIC_BASE_URL
    : process.env.OPENAI_BASE_URL;
  const aiModel = process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || 
    (aiProvider === "anthropic" ? "claude-3-haiku-20240307" : "gpt-4o-mini");
  const aiMaxTokens = process.env.AI_MAX_TOKENS ? parseInt(process.env.AI_MAX_TOKENS) : 2000;
  const aiTemperature = process.env.AI_TEMPERATURE ? parseFloat(process.env.AI_TEMPERATURE) : 0.7;

  // Read gateway configuration from environment variables
  const gatewayPort = process.env.GATEWAY_PORT ? parseInt(process.env.GATEWAY_PORT) : 18789;
  const gatewayHost = process.env.GATEWAY_HOST || "127.0.0.1";

  return {
    version: CONFIG_VERSION,
    name: "02mini Gateway",
    logging: {
      level: "info",
      consoleStyle: "pretty",
    },
    gateway: {
      port: gatewayPort,
      host: gatewayHost,
      auth: {
        type: "none",
      },
    },
    ai: {
      type: aiProvider as "openai" | "anthropic",
      apiKey: aiApiKey || "${OPENAI_API_KEY}",
      baseUrl: aiBaseUrl,
      model: aiModel,
      maxTokens: aiMaxTokens,
      temperature: aiTemperature,
      organization: process.env.OPENAI_ORGANIZATION,
    },
    channels: {
      telegram: {
        enabled: false,
        botToken: "${TELEGRAM_BOT_TOKEN}",
        dmPolicy: "open",
        groupPolicy: "disabled",
      },
      discord: {
        enabled: false,
        botToken: "${DISCORD_BOT_TOKEN}",
        dmPolicy: "open",
        guildPolicy: "disabled",
      },
      slack: {
        enabled: false,
        botToken: "${SLACK_BOT_TOKEN}",
        dmPolicy: "open",
        channelPolicy: "disabled",
      },
      whatsapp: {
        enabled: false,
        dmPolicy: "open",
        groupPolicy: "disabled",
      },
      signal: {
        enabled: false,
        dmPolicy: "open",
        groupPolicy: "disabled",
      },
      imessage: {
        enabled: false,
        dmPolicy: "open",
        groupPolicy: "disabled",
      },
    },
    session: {
      scope: "per-sender",
      dmScope: "main",
      maxHistory: 50,
      idleTimeoutMinutes: 60,
      maintenance: {
        mode: "warn",
        pruneAfter: "30d",
        maxEntries: 500,
        rotateBytes: "10mb",
      },
    },
    tools: {
      bash: {
        enabled: true,
        timeout: 30000,
        requireApproval: true,
      },
      file: {
        enabled: true,
        requireApproval: true,
      },
      browser: {
        enabled: false,
        headless: true,
      },
      web: {
        enabled: true,
        timeout: 30000,
      },
    },
    memory: {
      enabled: false,
      backend: "sqlite",
      citations: true,
    },
    cron: {
      enabled: false,
      jobs: [],
    },
    plugins: {
      entries: {},
    },
    approvals: {
      enabled: true,
      tools: ["bash", "file", "browser"],
    },
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export { CONFIG_VERSION, DEFAULT_CONFIG_NAME };
