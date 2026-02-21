/**
 * Session Management
 * Handles conversation history and context
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Message, SessionConfig } from "../config/types.js";

interface SessionStorage {
  [conversationId: string]: {
    messages: Message[];
    createdAt: number;
    updatedAt: number;
  };
}

export class SessionManager {
  private storage: SessionStorage = {};
  private config: SessionConfig;
  private storagePath: string;
  private dirty = false;
  private saveInterval?: NodeJS.Timeout;

  constructor(config: SessionConfig, storagePath?: string) {
    this.config = config;
    
    const defaultPath = path.join(os.homedir(), ".02mini", "sessions.json");
    this.storagePath = storagePath || defaultPath;
    
    this.loadFromDisk();
    this.startAutoSave();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const content = fs.readFileSync(this.storagePath, "utf-8");
        this.storage = JSON.parse(content);
        console.log(`[session] Loaded ${Object.keys(this.storage).length} conversations`);
      }
    } catch (error) {
      console.error("[session] Failed to load sessions:", error);
      this.storage = {};
    }
  }

  private startAutoSave(): void {
    // Auto-save every 30 seconds if dirty
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this.saveToDisk();
      }
    }, 30000);
  }

  saveToDisk(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(this.storage, null, 2),
        "utf-8"
      );
      
      this.dirty = false;
      console.log("[session] Saved to disk");
    } catch (error) {
      console.error("[session] Failed to save:", error);
    }
  }

  destroy(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.saveToDisk();
  }

  addMessage(conversationId: string, message: Message): void {
    let conversation = this.storage[conversationId];
    
    if (!conversation) {
      const now = Date.now();
      conversation = {
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      this.storage[conversationId] = conversation;
    }
    
    conversation.messages.push(message);
    conversation.updatedAt = Date.now();
    
    // Trim to max history
    const maxHistory = this.config.maxHistory || 50;
    if (conversation.messages.length > maxHistory) {
      conversation.messages = conversation.messages.slice(-maxHistory);
    }
    
    this.dirty = true;
  }

  getMessages(conversationId: string): Message[] {
    return this.storage[conversationId]?.messages || [];
  }

  clearConversation(conversationId: string): boolean {
    if (this.storage[conversationId]) {
      delete this.storage[conversationId];
      this.dirty = true;
      return true;
    }
    return false;
  }

  listConversations(): string[] {
    return Object.keys(this.storage);
  }

  getStats(): { total: number; totalMessages: number } {
    const total = Object.keys(this.storage).length;
    const totalMessages = Object.values(this.storage).reduce(
      (acc, conv) => acc + conv.messages.length,
      0
    );
    
    return { total, totalMessages };
  }

  cleanup(): number {
    const idleTimeout = this.config.idleTimeoutMinutes;
    if (!idleTimeout) return 0;
    
    const now = Date.now();
    const timeoutMs = idleTimeout * 60 * 1000;
    let removed = 0;
    
    for (const [id, conversation] of Object.entries(this.storage)) {
      if (now - conversation.updatedAt > timeoutMs) {
        delete this.storage[id];
        removed++;
      }
    }
    
    if (removed > 0) {
      this.dirty = true;
      console.log(`[session] Cleaned up ${removed} idle conversations`);
    }
    
    return removed;
  }
}