/**
 * Configuration Loader
 * Supports JSON5, $include, and environment variable substitution
 */

import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { MiniConfigSchema, type MiniConfig } from "./schema.js";



export class ConfigLoader {
  private configPath: string;
  private loadedFiles: Set<string> = new Set();

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
  }

  /**
   * Load configuration with $include support
   */
  async load(): Promise<MiniConfig> {
    this.loadedFiles.clear();
    const raw = await this.loadFile(this.configPath);
    
    // Substitute environment variables
    const withEnv = this.substituteEnvVars(raw);
    
    // Validate with Zod
    const result = MiniConfigSchema.safeParse(withEnv);
    
    if (!result.success) {
      throw new ConfigValidationError(
        "Configuration validation failed",
        result.error.errors
      );
    }
    
    return result.data;
  }

  /**
   * Load a config file with $include resolution
   */
  private async loadFile(filePath: string): Promise<unknown> {
    if (this.loadedFiles.has(filePath)) {
      throw new Error(`Circular include detected: ${filePath}`);
    }
    
    this.loadedFiles.add(filePath);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Config file not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON5.parse(content);
    
    // Process $include
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

  /**
   * Substitute environment variables ${VAR}
   */
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

  /**
   * Deep merge two objects
   */
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

export class ConfigValidationError extends Error {
  public errors: Array<{ path: string; message: string }>;

  constructor(message: string, zodErrors: Array<{ path: (string | number)[]; message: string }>) {
    super(message);
    this.name = "ConfigValidationError";
    this.errors = zodErrors.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    }));
  }
}
