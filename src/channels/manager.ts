/**
 * Channel Manager
 * Manages all message channels
 */

import type { Channel, ChannelMessage } from "./types.js";
import type { MiniConfig } from "../config/types.js";
import { TelegramChannel } from "./telegram.js";
import { DiscordChannel } from "./discord.js";
import { SlackChannel } from "./slack.js";

export class ChannelManager {
  private channels: Map<string, Channel> = new Map();
  private config: MiniConfig;
  private messageCallback?: (message: ChannelMessage) => void;

  constructor(config: MiniConfig) {
    this.config = config;
    this.initializeChannels();
  }

  private initializeChannels(): void {
    const { channels } = this.config;
    if (!channels) return;

    // Initialize Telegram
    if (channels.telegram?.enabled) {
      try {
        const telegram = new TelegramChannel(channels.telegram);
        telegram.onMessage((msg) => this.handleMessage(msg));
        this.channels.set("telegram", telegram);
        console.log("[channels] Telegram initialized");
      } catch (error) {
        console.error("[channels] Failed to initialize Telegram:", error);
      }
    }

    // Initialize Discord
    if (channels.discord?.enabled) {
      try {
        const discord = new DiscordChannel(channels.discord);
        discord.onMessage((msg) => this.handleMessage(msg));
        this.channels.set("discord", discord);
        console.log("[channels] Discord initialized");
      } catch (error) {
        console.error("[channels] Failed to initialize Discord:", error);
      }
    }

    // Initialize Slack
    if (channels.slack?.enabled) {
      try {
        const slack = new SlackChannel(channels.slack);
        slack.onMessage((msg) => this.handleMessage(msg));
        this.channels.set("slack", slack);
        console.log("[channels] Slack initialized");
      } catch (error) {
        console.error("[channels] Failed to initialize Slack:", error);
      }
    }

    // Note: WhatsApp, Signal, iMessage require additional setup
    // and will be implemented separately
  }

  private handleMessage(message: ChannelMessage): void {
    if (this.messageCallback) {
      this.messageCallback(message);
    }
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, channel] of this.channels) {
      promises.push(
        channel.start().catch((error) => {
          console.error(`[channels] Failed to start ${name}:`, error);
        })
      );
    }

    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, channel] of this.channels) {
      promises.push(
        channel.stop().catch((error) => {
          console.error(`[channels] Failed to stop ${name}:`, error);
        })
      );
    }

    await Promise.all(promises);
    this.channels.clear();
  }

  getChannel(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  getConnectedChannels(): string[] {
    return Array.from(this.channels.entries())
      .filter(([_, channel]) => channel.isConnected)
      .map(([name, _]) => name);
  }

  onMessage(callback: (message: ChannelMessage) => void): void {
    this.messageCallback = callback;
  }

  getStats(): { total: number; connected: number } {
    const total = this.channels.size;
    const connected = this.getConnectedChannels().length;
    return { total, connected };
  }
}
