/**
 * Channels Module
 * Export all channel implementations
 */

export { ChannelManager } from "./manager.js";
export { TelegramChannel } from "./telegram.js";
export { DiscordChannel } from "./discord.js";
export { SlackChannel } from "./slack.js";
export type { Channel, ChannelMessage, ChannelType, ChannelConfig } from "./types.js";
