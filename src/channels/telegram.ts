/**
 * Telegram Channel Implementation
 * Using grammY library
 */

import { Bot, Context } from "grammy";
import type { Channel, ChannelMessage, ChannelType } from "./types.js";
import type { TelegramConfig } from "../config/types.js";

export class TelegramChannel implements Channel {
  readonly type: ChannelType = "telegram";
  private bot: Bot<Context>;
  private config: TelegramConfig;
  private messageCallback?: (message: ChannelMessage) => void;
  private connected = false;

  constructor(config: TelegramConfig) {
    this.config = config;
    
    if (!config.botToken) {
      throw new Error("Telegram bot token is required");
    }
    
    this.bot = new Bot(config.botToken);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle text messages
    this.bot.on("message:text", async (ctx) => {
      if (!this.messageCallback) return;

      const message = ctx.message;
      const chat = ctx.chat;
      const from = ctx.from;

      if (!message || !chat || !from) return;

      // Check policies
      if (!this.shouldProcessMessage(chat.type, from.id.toString())) {
        return;
      }

      const channelMessage: ChannelMessage = {
        id: message.message_id.toString(),
        channelType: "telegram",
        senderId: from.id.toString(),
        senderName: from.username || from.first_name,
        chatId: chat.id.toString(),
        chatType: chat.type === "private" ? "dm" : "group",
        content: message.text,
        timestamp: message.date * 1000,
        replyTo: message.reply_to_message?.message_id.toString(),
        metadata: {
          chatType: chat.type,
          language: from.language_code,
        },
      };

      this.messageCallback(channelMessage);
    });

    // Handle errors
    this.bot.catch((err) => {
      console.error("[telegram] Bot error:", err);
    });
  }

  private shouldProcessMessage(chatType: string, userId: string): boolean {
    // Check DM policy
    if (chatType === "private") {
      const dmPolicy = this.config.dmPolicy || "open";
      
      if (dmPolicy === "disabled") {
        return false;
      }
      
      if (dmPolicy === "allowlist") {
        return (this.config.allowedUsers || []).includes(userId);
      }
      
      return true;
    }

    // Check group policy
    const groupPolicy = this.config.groupPolicy || "disabled";
    
    if (groupPolicy === "disabled") {
      return false;
    }
    
    if (groupPolicy === "allowlist") {
      // For groups, we'd need to check the chat ID against allowedGroups
      // return (this.config.allowedGroups || []).includes(chatId);
      return true; // Simplified for now
    }
    
    return true;
  }

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Get bot info
      const botInfo = await this.bot.api.getMe();
      console.log(`[telegram] Starting bot: @${botInfo.username}`);

      // Start bot
      await this.bot.start({
        drop_pending_updates: true,
        onStart: () => {
          console.log("[telegram] Bot started");
          this.connected = true;
        },
      });
    } catch (error) {
      console.error("[telegram] Failed to start:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.bot.stop();
      this.connected = false;
      console.log("[telegram] Bot stopped");
    } catch (error) {
      console.error("[telegram] Error stopping:", error);
    }
  }

  async sendMessage(
    chatId: string, 
    content: string, 
    options?: { replyTo?: string }
  ): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatId, content, {
        reply_to_message_id: options?.replyTo ? parseInt(options.replyTo) : undefined,
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.error("[telegram] Failed to send message:", error);
      throw error;
    }
  }

  onMessage(callback: (message: ChannelMessage) => void): void {
    this.messageCallback = callback;
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
