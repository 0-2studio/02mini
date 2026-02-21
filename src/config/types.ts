/**
 * 02mini Configuration Types
 * Complete type definitions matching OpenClaw
 */

// ==================== Base Types ====================

export type LogLevel = "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";
export type ReplyMode = "text" | "command";
export type TypingMode = "never" | "instant" | "thinking" | "message";
export type SessionScope = "per-sender" | "global";
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
export type GroupPolicy = "open" | "disabled" | "allowlist";
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

// ==================== Session Types ====================

export type SessionResetMode = "daily" | "idle";

export interface SessionResetConfig {
  mode?: SessionResetMode;
  atHour?: number;
  idleMinutes?: number;
}

export interface SessionResetByTypeConfig {
  direct?: SessionResetConfig;
  dm?: SessionResetConfig;
  group?: SessionResetConfig;
  thread?: SessionResetConfig;
}

export type SessionSendPolicyAction = "allow" | "deny";

export interface SessionSendPolicyMatch {
  channel?: string;
  chatType?: string;
  keyPrefix?: string;
  rawKeyPrefix?: string;
}

export interface SessionSendPolicyRule {
  action: SessionSendPolicyAction;
  match?: SessionSendPolicyMatch;
}

export interface SessionSendPolicyConfig {
  default?: SessionSendPolicyAction;
  rules?: SessionSendPolicyRule[];
}

export interface SessionMaintenanceConfig {
  mode?: "enforce" | "warn";
  pruneAfter?: string | number;
  pruneDays?: number;
  maxEntries?: number;
  rotateBytes?: number | string;
}

export interface SessionConfig {
  scope?: SessionScope;
  dmScope?: DmScope;
  identityLinks?: Record<string, string[]>;
  resetTriggers?: string[];
  idleMinutes?: number;
  idleTimeoutMinutes?: number;
  maxHistory?: number;
  reset?: SessionResetConfig;
  resetByType?: SessionResetByTypeConfig;
  resetByChannel?: Record<string, SessionResetConfig>;
  store?: string;
  typingIntervalSeconds?: number;
  typingMode?: TypingMode;
  mainKey?: string;
  sendPolicy?: SessionSendPolicyConfig;
  agentToAgent?: {
    maxPingPongTurns?: number;
  };
  maintenance?: SessionMaintenanceConfig;
}

// ==================== Logging & Diagnostics ====================

export interface DiagnosticsOtelConfig {
  enabled?: boolean;
  endpoint?: string;
  protocol?: "http/protobuf" | "grpc";
  headers?: Record<string, string>;
  serviceName?: string;
  traces?: boolean;
  metrics?: boolean;
  logs?: boolean;
  sampleRate?: number;
  flushIntervalMs?: number;
}

export interface DiagnosticsCacheTraceConfig {
  enabled?: boolean;
  filePath?: string;
  includeMessages?: boolean;
  includePrompt?: boolean;
  includeSystem?: boolean;
}

export interface DiagnosticsConfig {
  enabled?: boolean;
  flags?: string[];
  otel?: DiagnosticsOtelConfig;
  cacheTrace?: DiagnosticsCacheTraceConfig;
}

export interface LoggingConfig {
  level?: LogLevel;
  file?: string;
  consoleLevel?: LogLevel;
  consoleStyle?: "pretty" | "compact" | "json";
  redactSensitive?: "off" | "tools";
  redactPatterns?: string[];
}

// ==================== Gateway Types ====================

export interface GatewayAuthConfig {
  type: "none" | "token" | "password";
  token?: string;
  password?: string;
}

export interface GatewayTlsConfig {
  enabled?: boolean;
  cert?: string;
  key?: string;
}

export interface GatewayConfig {
  port: number;
  host?: string;
  bind?: "loopback" | "lan" | "tailnet" | "auto";
  auth: GatewayAuthConfig;
  tls?: GatewayTlsConfig;
  heartbeatInterval?: number;
  controlUi?: {
    enabled?: boolean;
  };
  http?: {
    endpoints?: {
      chatCompletions?: { enabled?: boolean };
      responses?: { enabled?: boolean };
    };
  };
}

// ==================== AI Provider Types ====================

export type AiProviderType = 
  | "openai" 
  | "anthropic" 
  | "gemini" 
  | "bedrock" 
  | "azure" 
  | "ollama"
  | "openrouter"
  | "together"
  | "custom";

export interface AiProviderConfig {
  type: AiProviderType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  organization?: string;
  region?: string;
}

export interface ModelProfile {
  name: string;
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ModelsConfig {
  default?: string;
  profiles?: ModelProfile[];
}

// ==================== Channel Types ====================

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  allowedUsers?: string[];
  allowedGroups?: string[];
  webhook?: {
    enabled?: boolean;
    url?: string;
    port?: number;
  };
}

export interface DiscordConfig {
  enabled: boolean;
  botToken: string;
  dmPolicy?: DmPolicy;
  guildPolicy?: GroupPolicy;
  allowedUsers?: string[];
  allowedGuilds?: string[];
  intents?: string[];
}

export interface SlackConfig {
  enabled: boolean;
  botToken: string;
  signingSecret?: string;
  appToken?: string;
  socketMode?: boolean;
  dmPolicy?: DmPolicy;
  channelPolicy?: GroupPolicy;
  allowedUsers?: string[];
}

export interface WhatsAppConfig {
  enabled: boolean;
  sessionName?: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
}

export interface SignalConfig {
  enabled: boolean;
  phoneNumber?: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
}

export interface IMessageConfig {
  enabled: boolean;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
}

export interface WebChatConfig {
  enabled: boolean;
  port?: number;
  cors?: string[];
}

export interface ChannelsConfig {
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  slack?: SlackConfig;
  whatsapp?: WhatsAppConfig;
  signal?: SignalConfig;
  imessage?: IMessageConfig;
  webchat?: WebChatConfig;
}

// ==================== Tool Types ====================

export interface BashToolConfig {
  enabled: boolean;
  allowedCommands?: string[];
  timeout?: number;
  requireApproval?: boolean;
}

export interface FileToolConfig {
  enabled: boolean;
  allowedPaths?: string[];
  requireApproval?: boolean;
}

export interface BrowserToolConfig {
  enabled: boolean;
  headless?: boolean;
  executablePath?: string;
  requireApproval?: boolean;
}

export interface WebToolConfig {
  enabled: boolean;
  timeout?: number;
}

export interface ToolsConfig {
  bash?: BashToolConfig;
  file?: FileToolConfig;
  browser?: BrowserToolConfig;
  web?: WebToolConfig;
}

// ==================== Memory Types ====================

export interface MemoryConfig {
  enabled?: boolean;
  backend?: "sqlite" | "lancedb";
  path?: string;
  citations?: boolean;
  qmd?: {
    enabled?: boolean;
    endpoint?: string;
  };
}

// ==================== Cron Types ====================

export interface CronJob {
  name: string;
  schedule: string;
  command: string;
  timezone?: string;
  enabled?: boolean;
}

export interface CronConfig {
  enabled?: boolean;
  jobs?: CronJob[];
}

// ==================== Plugin Types ====================

export interface PluginEntry {
  name: string;
  enabled?: boolean;
  path?: string;
  config?: Record<string, unknown>;
}

export interface PluginsConfig {
  entries?: Record<string, PluginEntry>;
}

// ==================== Security Types ====================

export interface ApprovalsConfig {
  enabled?: boolean;
  tools?: string[];
  autoApprove?: string[];
}

// ==================== Browser Types ====================

export interface BrowserConfig {
  enabled?: boolean;
  headless?: boolean;
  executablePath?: string;
  userDataDir?: string;
}

// ==================== Agent Types ====================

export interface AgentBinding {
  agentId: string;
  channel?: string;
  pattern?: string;
}

export interface AgentConfig {
  id: string;
  name?: string;
  model?: string;
  systemPrompt?: string;
  tools?: string[];
  workspace?: string;
}

export interface AgentsConfig {
  defaults?: Partial<AgentConfig>;
  list?: AgentConfig[];
}

// ==================== Main Config ====================

export interface MiniConfig {
  version?: string;
  name?: string;
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  env?: {
    shellEnv?: {
      enabled?: boolean;
      timeoutMs?: number;
    };
    vars?: Record<string, string>;
  };
  wizard?: {
    lastRunAt?: string;
    lastRunVersion?: string;
  };
  logging?: LoggingConfig;
  diagnostics?: DiagnosticsConfig;
  update?: {
    channel?: "stable" | "beta" | "dev";
    checkOnStart?: boolean;
  };
  gateway: GatewayConfig;
  ai: AiProviderConfig;
  models?: ModelsConfig;
  channels?: ChannelsConfig;
  session?: SessionConfig;
  tools?: ToolsConfig;
  browser?: BrowserConfig;
  memory?: MemoryConfig;
  cron?: CronConfig;
  plugins?: PluginsConfig;
  approvals?: ApprovalsConfig;
  agents?: AgentsConfig;
  bindings?: AgentBinding[];
  ui?: {
    seamColor?: string;
    assistant?: {
      name?: string;
      avatar?: string;
    };
  };
}

// ==================== Message Types ====================

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export type ChannelType = "telegram" | "discord" | "slack" | "whatsapp" | "signal" | "imessage" | "webchat";

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

// ==================== AI Response Types ====================

export interface AiResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ==================== Tool System Types ====================

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolContext {
  sessionId: string;
  workspace: string;
  config: MiniConfig;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

// ==================== Gateway Event Types ====================

export type GatewayEventType = 
  | "message" 
  | "response" 
  | "error" 
  | "connected" 
  | "disconnected"
  | "tool_call"
  | "tool_result";

export interface GatewayEvent {
  type: GatewayEventType;
  payload: unknown;
  timestamp: number;
}