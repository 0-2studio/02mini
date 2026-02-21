/**
 * Discord Channel Implementation
 * Simplified version avoiding ESM/CJS issues
 */

import type { Channel, ChannelMessage, ChannelType } from "./types.js";
import type { DiscordConfig } from "../config/types.js";

export class DiscordChannel implements Channel {
  readonly type: ChannelType = "discord";
  private config: DiscordConfig;
  private messageCallback?: (message: ChannelMessage) => void;
  private connected = false;
  private client: unknown;

  constructor(config: DiscordConfig) {
    this.config = config;
    
    if (!config.botToken) {
      throw new Error("Discord bot token is required");
    }
  }

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Dynamically import discord.js to avoid ESM issues
      const discord = await import("discord.js");
      const { Client, Events, GatewayIntentBits, Partials } = discord;

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel],
      });

      // Handle ready event
      (this.client as { once: (event: string, callback: (c: Record<string, unknown>) => void) => void }).once(
        Events.ClientReady,
        (c: Record<string, unknown>) => {
          console.log(`[discord] Logged in as ${(c.user as Record<string, unknown>)?.tag}`);
          this.connected = true;
        }
      );

      // Handle messages
      (this.client as { on: (event: string, callback: (message: Record<string, unknown>) => void) => void }).on(
        Events.MessageCreate,
        (message: Record<string, unknown>) => {
          if (!this.messageCallback) return;

          // Ignore own messages
          if ((message.author as Record<string, unknown>)?.bot) return;

          const userId = (message.author as Record<string, unknown>)?.id as string;

          // Check policies
          if (!this.shouldProcessMessage(message)) {
            return;
          }

          const channelMessage: ChannelMessage = {
            id: message.id as string,
            channelType: "discord",
            senderId: userId,
            senderName: (message.author as Record<string, unknown>)?.username as string,
            chatId: message.channelId as string,
            chatType: message.guild ? "group" : "dm",
            content: (message.content as string) || "",
            timestamp: message.createdTimestamp as number,
            replyTo: (message.reference as Record<string, unknown>)?.messageId as string | undefined,
            metadata: {
              guildId: message.guildId as string | undefined,
            },
          };

          this.messageCallback(channelMessage);
        }
      );

      // Handle errors
      (this.client as { on: (event: string, callback: (error: Error) => void) => void }).on(
        Events.Error,
        (error: Error) => {
          console.error("[discord] Client error:", error);
        }
      );

      await (this.client as { login: (token: string) => Promise<void> }).login(this.config.botToken);
    } catch (error) {
      console.error("[discord] Failed to start:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      (this.client as { destroy: () => void }).destroy();
      this.connected = false;
      console.log("[discord] Client stopped");
    } catch (error) {
      console.error("[discord] Error stopping:", error);
    }
  }

  async sendMessage(
    chatId: string, 
    content: string, 
    options?: { replyTo?: string }
  ): Promise<void> {
    try {
      if (!this.client) {
        throw new Error("Discord client not initialized");
      }

      // Use REST API to send messages
      await (this.client as { rest: { post: (path: string, options: Record<string, unknown>) => Promise<void> } }).rest.post(
        `/channels/${chatId}/messages`,
        {
          body: options?.replyTo
            ? {
                content,
                message_reference: { message_id: options.replyTo },
              }
            : { content },
        }
      );
    } catch (error) {
      console.error("[discord] Failed to send message:", error);
      throw error;
    }
  }

  onMessage(callback: (message: ChannelMessage) => void): void {
    this.messageCallback = callback;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private shouldProcessMessage(message: Record<string, unknown>): boolean {
    const isDM = !message.guild;
    const userId = (message.author as Record<string, unknown>)?.id as string;

    // Check DM policy
    if (isDM) {
      const dmPolicy = this.config.dmPolicy || "open";
      
      if (dmPolicy === "disabled") {
        return false;
      }
      
      if (dmPolicy === "allowlist") {
        const allowed = this.config.allowedUsers || [];
        return allowed.includes(userId);
      }
      
      return true;
    }

    // Check guild policy
    const guildPolicy = this.config.guildPolicy || "disabled";
    
    if (guildPolicy === "disabled") {
      return false;
    }
    
    if (guildPolicy === "allowlist") {
      const allowed = this.config.allowedGuilds || [];
      return allowed.includes(message.guildId as string);
    }
    
    return true;
  }
}