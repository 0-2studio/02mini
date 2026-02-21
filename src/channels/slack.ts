/**
 * Slack Channel Implementation
 * Simplified version avoiding ESM/CJS issues
 */

import type { Channel, ChannelMessage, ChannelType } from "./types.js";
import type { SlackConfig } from "../config/types.js";

export class SlackChannel implements Channel {
  readonly type: ChannelType = "slack";
  private config: SlackConfig;
  private messageCallback?: (message: ChannelMessage) => void;
  private connected = false;
  private app: unknown;

  constructor(config: SlackConfig) {
    this.config = config;
    
    if (!config.botToken) {
      throw new Error("Slack bot token is required");
    }
  }

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Dynamically import @slack/bolt to avoid ESM issues
      const bolt = await import("@slack/bolt");
      const { App, LogLevel } = bolt;

      this.app = new App({
        token: this.config.botToken,
        signingSecret: this.config.signingSecret,
        socketMode: this.config.socketMode,
        appToken: this.config.appToken,
        logLevel: LogLevel.INFO,
      });

      // Handle direct messages
      (this.app as { message: (callback: (args: Record<string, unknown>) => Promise<void>) => void }).message(
        async (args: Record<string, unknown>) => {
          if (!this.messageCallback) return;

          const message = args.message as Record<string, unknown>;

          // Filter only user messages
          if (message.subtype || message.bot_id) return;

          const userId = message.user as string;

          // Check policies
          if (!this.shouldProcessMessage("dm", userId)) {
            return;
          }

          const channelMessage: ChannelMessage = {
            id: message.ts as string,
            channelType: "slack",
            senderId: userId,
            chatId: message.channel as string,
            chatType: "dm",
            content: (message.text as string) || "",
            timestamp: parseInt((message.ts as string).split(".")[0]) * 1000,
            metadata: {
              channelType: message.channel_type as string,
            },
          };

          this.messageCallback(channelMessage);
        }
      );

      await (this.app as { start: () => Promise<void> }).start();
      this.connected = true;
      console.log("[slack] App started");
    } catch (error) {
      console.error("[slack] Failed to start:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.connected || !this.app) {
      return;
    }

    try {
      await (this.app as { stop: () => Promise<void> }).stop();
      this.connected = false;
      console.log("[slack] App stopped");
    } catch (error) {
      console.error("[slack] Error stopping:", error);
    }
  }

  async sendMessage(
    chatId: string, 
    content: string, 
    options?: { replyTo?: string }
  ): Promise<void> {
    try {
      if (!this.app) {
        throw new Error("Slack app not initialized");
      }

      await (this.app as { client: { chat: { postMessage: (args: Record<string, unknown>) => Promise<void> } } }).client.chat.postMessage({
        channel: chatId,
        text: content,
        thread_ts: options?.replyTo,
      });
    } catch (error) {
      console.error("[slack] Failed to send message:", error);
      throw error;
    }
  }

  onMessage(callback: (message: ChannelMessage) => void): void {
    this.messageCallback = callback;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private shouldProcessMessage(
    type: "dm" | "channel", 
    userId: string
  ): boolean {
    if (type === "dm") {
      const dmPolicy = this.config.dmPolicy || "open";
      
      if (dmPolicy === "disabled") {
        return false;
      }
      
      if (dmPolicy === "allowlist") {
        return (this.config.allowedUsers || []).includes(userId);
      }
      
      return true;
    }

    const channelPolicy = this.config.channelPolicy || "disabled";
    
    if (channelPolicy === "disabled") {
      return false;
    }
    
    return true;
  }
}