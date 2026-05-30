export interface KukeChatConfig {
  enabled: boolean;
  baseUrl: string;
  wsUrl: string;
  botKey?: string;
  autoReconnect: boolean;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  maxMessageLength: number;
  splitLongMessages: boolean;
  replyToMessages: boolean;
  ignoreBotMessages: boolean;
}

export interface KukeChatUser {
  id?: number;
  username?: string;
  nickname?: string;
  display_name?: string;
  is_bot?: boolean;
}

export interface KukeChatMessageCreatedData {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_display_name?: string;
  sender?: KukeChatUser;
  type?: string;
  content: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface KukeChatInteractionData {
  conversation_id: number;
  message_id: number;
  user_id: number;
  user_name?: string;
  kind?: string;
  action?: string;
  component_id?: string;
  action_id?: string;
  value?: string | null;
  label?: string;
}

export type KukeChatEvent =
  | { type: 'bot.connection.ready'; data: { bot_id: number; user_id: number } }
  | { type: 'message.created'; data: KukeChatMessageCreatedData }
  | { type: 'message.interaction'; data: KukeChatInteractionData }
  | { type: string; data?: any };

export interface KukeChatToolResult {
  success: boolean;
  message: string;
}

export interface KukeChatStatus {
  enabled: boolean;
  running: boolean;
  connected: boolean;
  botUserId?: number;
  reconnectAttempts: number;
  queuedMessages: number;
}

export const DEFAULT_KUKECHAT_CONFIG: KukeChatConfig = {
  enabled: false,
  baseUrl: 'https://chat-api.kuke.ink/api/v1',
  wsUrl: 'wss://chat-api.kuke.ink/bot/ws',
  autoReconnect: true,
  reconnectInitialDelayMs: 5000,
  reconnectMaxDelayMs: 60000,
  maxMessageLength: 8000,
  splitLongMessages: true,
  replyToMessages: true,
  ignoreBotMessages: true,
};
