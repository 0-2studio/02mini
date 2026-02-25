/**
 * QQ Config Manager
 * Manages QQ bot configuration and permissions
 */

import fs from 'fs/promises';
import path from 'path';
import type { QQConfig, QQPermissions } from './types.js';
import { DEFAULT_QQ_CONFIG } from './types.js';

export interface QQConfigData {
  config: QQConfig;
  permissions: {
    allowedUsers: number[];
    blockedUsers: number[];
    allowAllPrivate: boolean;
    allowedGroups: number[];
    blockedGroups: number[];
    allowAllGroups: boolean;
    adminUsers: number[];
  };
}

export class QQConfigManager {
  private workingDir: string;
  private configPath: string;
  private config: QQConfig;
  private permissions: QQPermissions;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.configPath = path.join(workingDir, 'important', 'qq-config.json');
    this.config = { ...DEFAULT_QQ_CONFIG };
    this.permissions = {
      allowedUsers: new Set(),
      blockedUsers: new Set(),
      allowAllPrivate: true,
      allowedGroups: new Set(),
      blockedGroups: new Set(),
      allowAllGroups: false,
      adminUsers: new Set(),
    };
  }

  /**
   * Load configuration from file and environment variables
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const parsed: QQConfigData = JSON.parse(data);
      
      // Merge with defaults
      this.config = { ...DEFAULT_QQ_CONFIG, ...parsed.config };
      
      // Restore sets from arrays
      this.permissions.allowedUsers = new Set(parsed.permissions?.allowedUsers || []);
      this.permissions.blockedUsers = new Set(parsed.permissions?.blockedUsers || []);
      this.permissions.allowAllPrivate = parsed.permissions?.allowAllPrivate ?? true;
      this.permissions.allowedGroups = new Set(parsed.permissions?.allowedGroups || []);
      this.permissions.blockedGroups = new Set(parsed.permissions?.blockedGroups || []);
      this.permissions.allowAllGroups = parsed.permissions?.allowAllGroups ?? false;
      this.permissions.adminUsers = new Set(parsed.permissions?.adminUsers || []);
      
      console.log('[QQ] Configuration loaded from file');
      console.log(`[QQ] allowAllPrivate: ${this.permissions.allowAllPrivate}, allowAllGroups: ${this.permissions.allowAllGroups}`);
      console.log(`[QQ] allowedUsers: ${this.permissions.allowedUsers.size}, blockedUsers: ${this.permissions.blockedUsers.size}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, use defaults
        console.log('[QQ] No config file found, using defaults');
      } else {
        console.error('[QQ] Error loading config:', error);
      }
    }

    // Override with environment variables
    this.loadFromEnv();
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnv(): void {
    const env = process.env;
    let hasEnvConfig = false;

    if (env.QQ_ENABLED !== undefined) {
      this.config.enabled = env.QQ_ENABLED === 'true';
      hasEnvConfig = true;
    }

    if (env.QQ_PORT) {
      this.config.port = parseInt(env.QQ_PORT, 10);
      hasEnvConfig = true;
    }

    if (env.QQ_HOST) {
      this.config.host = env.QQ_HOST;
      hasEnvConfig = true;
    }

    if (env.QQ_TOKEN) {
      this.config.accessToken = env.QQ_TOKEN;
      hasEnvConfig = true;
    }

    if (env.QQ_MODE) {
      this.config.mode = env.QQ_MODE as 'websocket-server' | 'websocket-client';
      hasEnvConfig = true;
    }

    if (env.QQ_AT_REQUIRED !== undefined) {
      this.config.atRequiredInGroup = env.QQ_AT_REQUIRED === 'true';
      hasEnvConfig = true;
    }

    if (env.QQ_NAPCAT_URL) {
      this.config.napcatWsUrl = env.QQ_NAPCAT_URL;
      hasEnvConfig = true;
    }

    if (env.QQ_PARALLEL_PROCESSING !== undefined) {
      this.config.parallelProcessing = env.QQ_PARALLEL_PROCESSING === 'true';
      hasEnvConfig = true;
    }

    if (env.QQ_ACCUMULATION_DELAY) {
      const delay = parseInt(env.QQ_ACCUMULATION_DELAY, 10);
      if (!isNaN(delay) && delay >= 0) {
        this.config.accumulationDelay = delay;
        hasEnvConfig = true;
      }
    }

    if (hasEnvConfig) {
      console.log('[QQ] Configuration overridden from environment variables');
      console.log(`[QQ] parallelProcessing: ${this.config.parallelProcessing}, accumulationDelay: ${this.config.accumulationDelay}ms`);
    }
  }

  /**
   * Save configuration to file
   */
  async save(): Promise<void> {
    try {
      const data: QQConfigData = {
        config: this.config,
        permissions: {
          allowedUsers: Array.from(this.permissions.allowedUsers),
          blockedUsers: Array.from(this.permissions.blockedUsers),
          allowAllPrivate: this.permissions.allowAllPrivate,
          allowedGroups: Array.from(this.permissions.allowedGroups),
          blockedGroups: Array.from(this.permissions.blockedGroups),
          allowAllGroups: this.permissions.allowAllGroups,
          adminUsers: Array.from(this.permissions.adminUsers),
        },
      };
      
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify(data, null, 2));
      console.log('[QQ] Configuration saved');
    } catch (error) {
      console.error('[QQ] Error saving config:', error);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): QQConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<QQConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.save();
  }

  /**
   * Check if user is allowed to chat privately
   */
  isUserAllowed(userId: number): boolean {
    if (this.permissions.blockedUsers.has(userId)) return false;
    if (this.permissions.allowAllPrivate) return true;
    return this.permissions.allowedUsers.has(userId);
  }

  /**
   * Check if group is allowed
   */
  isGroupAllowed(groupId: number): boolean {
    if (this.permissions.blockedGroups.has(groupId)) return false;
    if (this.permissions.allowAllGroups) return true;
    return this.permissions.allowedGroups.has(groupId);
  }

  /**
   * Check if user is admin
   */
  isAdmin(userId: number): boolean {
    return this.permissions.adminUsers.has(userId);
  }

  /**
   * Allow a user
   */
  async allowUser(userId: number): Promise<void> {
    this.permissions.allowedUsers.add(userId);
    this.permissions.blockedUsers.delete(userId);
    await this.save();
  }

  /**
   * Block a user
   */
  async blockUser(userId: number): Promise<void> {
    this.permissions.blockedUsers.add(userId);
    this.permissions.allowedUsers.delete(userId);
    await this.save();
  }

  /**
   * Allow a group
   */
  async allowGroup(groupId: number): Promise<void> {
    this.permissions.allowedGroups.add(groupId);
    this.permissions.blockedGroups.delete(groupId);
    await this.save();
  }

  /**
   * Block a group
   */
  async blockGroup(groupId: number): Promise<void> {
    this.permissions.blockedGroups.add(groupId);
    this.permissions.allowedGroups.delete(groupId);
    await this.save();
  }

  /**
   * Add admin user
   */
  async addAdmin(userId: number): Promise<void> {
    this.permissions.adminUsers.add(userId);
    await this.save();
  }

  /**
   * Remove admin user
   */
  async removeAdmin(userId: number): Promise<void> {
    this.permissions.adminUsers.delete(userId);
    await this.save();
  }

  /**
   * Set allow all private
   */
  async setAllowAllPrivate(allow: boolean): Promise<void> {
    this.permissions.allowAllPrivate = allow;
    await this.save();
  }

  /**
   * Set allow all groups
   */
  async setAllowAllGroups(allow: boolean): Promise<void> {
    this.permissions.allowAllGroups = allow;
    await this.save();
  }

  /**
   * Get permissions summary
   */
  getPermissionsSummary(): {
    allowedUsers: number[];
    blockedUsers: number[];
    allowedGroups: number[];
    blockedGroups: number[];
    adminUsers: number[];
    allowAllPrivate: boolean;
    allowAllGroups: boolean;
  } {
    return {
      allowedUsers: Array.from(this.permissions.allowedUsers),
      blockedUsers: Array.from(this.permissions.blockedUsers),
      allowedGroups: Array.from(this.permissions.allowedGroups),
      blockedGroups: Array.from(this.permissions.blockedGroups),
      adminUsers: Array.from(this.permissions.adminUsers),
      allowAllPrivate: this.permissions.allowAllPrivate,
      allowAllGroups: this.permissions.allowAllGroups,
    };
  }

  /**
   * Enable QQ bot
   */
  async enable(): Promise<void> {
    await this.updateConfig({ enabled: true });
  }

  /**
   * Disable QQ bot
   */
  async disable(): Promise<void> {
    await this.updateConfig({ enabled: false });
  }
}
