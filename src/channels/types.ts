/**
 * Channel Types and Interfaces
 */



export type ChannelType = "telegram" | "discord" | "slack" | "whatsapp" | "signal" | "imessage";

export interface ChannelMessage {
  id: string;
  channelType: ChannelType;
  senderId: string;
  senderName?: string;
  chatId: string;
  chatType: "dm" | "group";
  content: string;
  timestamp: number;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface Channel {
  readonly type: ChannelType;
  readonly isConnected: boolean;
  
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: string, content: string, options?: { replyTo?: string }): Promise<void>;
  onMessage(callback: (message: ChannelMessage) => void): void;
}

export interface ChannelConfig {
  enabled: boolean;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  groupPolicy?: "open" | "disabled" | "allowlist";
  allowedUsers?: string[];
  allowedGroups?: string[];
}

export type ChannelEventType = "message" | "connected" | "disconnected" | "error";

export interface ChannelEvent {
  type: ChannelEventType;
  channel: ChannelType;
  payload: unknown;
  timestamp: number;
}
