/**
 * Configuration Schema
 * Complete Zod schema definitions matching OpenClaw
 */

import { z } from "zod";

// ==================== Base Types ====================

export const LogLevelSchema = z.enum([
  "silent",
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);

export const ReplyModeSchema = z.enum(["text", "command"]);
export const TypingModeSchema = z.enum(["never", "instant", "thinking", "message"]);
export const SessionScopeSchema = z.enum(["per-sender", "global"]);
export const DmScopeSchema = z.enum([
  "main",
  "per-peer",
  "per-channel-peer",
  "per-account-channel-peer",
]);
export const GroupPolicySchema = z.enum(["open", "disabled", "allowlist"]);
export const DmPolicySchema = z.enum(["pairing", "allowlist", "open", "disabled"]);

// ==================== Session Config ====================

export const SessionResetModeSchema = z.enum(["daily", "idle"]);

export const SessionResetConfigSchema = z.object({
  mode: SessionResetModeSchema.optional(),
  atHour: z.number().min(0).max(23).optional(),
  idleMinutes: z.number().optional(),
});

export const SessionResetByTypeConfigSchema = z.object({
  direct: SessionResetConfigSchema.optional(),
  dm: SessionResetConfigSchema.optional(),
  group: SessionResetConfigSchema.optional(),
  thread: SessionResetConfigSchema.optional(),
});

export const SessionSendPolicyActionSchema = z.enum(["allow", "deny"]);

export const SessionSendPolicyMatchSchema = z.object({
  channel: z.string().optional(),
  chatType: z.string().optional(),
  keyPrefix: z.string().optional(),
  rawKeyPrefix: z.string().optional(),
});

export const SessionSendPolicyRuleSchema = z.object({
  action: SessionSendPolicyActionSchema,
  match: SessionSendPolicyMatchSchema.optional(),
});

export const SessionSendPolicyConfigSchema = z.object({
  default: SessionSendPolicyActionSchema.optional(),
  rules: z.array(SessionSendPolicyRuleSchema).optional(),
});

export const SessionMaintenanceConfigSchema = z.object({
  mode: z.enum(["enforce", "warn"]).optional(),
  pruneAfter: z.union([z.string(), z.number()]).optional(),
  pruneDays: z.number().optional(),
  maxEntries: z.number().optional(),
  rotateBytes: z.union([z.number(), z.string()]).optional(),
});

export const SessionConfigSchema = z.object({
  scope: SessionScopeSchema.optional(),
  dmScope: DmScopeSchema.optional(),
  identityLinks: z.record(z.array(z.string())).optional(),
  resetTriggers: z.array(z.string()).optional(),
  idleMinutes: z.number().optional(),
  reset: SessionResetConfigSchema.optional(),
  resetByType: SessionResetByTypeConfigSchema.optional(),
  resetByChannel: z.record(SessionResetConfigSchema).optional(),
  store: z.string().optional(),
  typingIntervalSeconds: z.number().optional(),
  typingMode: TypingModeSchema.optional(),
  mainKey: z.string().optional(),
  sendPolicy: SessionSendPolicyConfigSchema.optional(),
  agentToAgent: z.object({
    maxPingPongTurns: z.number().optional(),
  }).optional(),
  maintenance: SessionMaintenanceConfigSchema.optional(),
});

// ==================== Logging & Diagnostics ====================

export const DiagnosticsOtelConfigSchema = z.object({
  enabled: z.boolean().optional(),
  endpoint: z.string().optional(),
  protocol: z.enum(["http/protobuf", "grpc"]).optional(),
  headers: z.record(z.string()).optional(),
  serviceName: z.string().optional(),
  traces: z.boolean().optional(),
  metrics: z.boolean().optional(),
  logs: z.boolean().optional(),
  sampleRate: z.number().optional(),
  flushIntervalMs: z.number().optional(),
});

export const DiagnosticsCacheTraceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  filePath: z.string().optional(),
  includeMessages: z.boolean().optional(),
  includePrompt: z.boolean().optional(),
  includeSystem: z.boolean().optional(),
});

export const DiagnosticsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  flags: z.array(z.string()).optional(),
  otel: DiagnosticsOtelConfigSchema.optional(),
  cacheTrace: DiagnosticsCacheTraceConfigSchema.optional(),
});

export const LoggingConfigSchema = z.object({
  level: LogLevelSchema.optional(),
  file: z.string().optional(),
  consoleLevel: LogLevelSchema.optional(),
  consoleStyle: z.enum(["pretty", "compact", "json"]).optional(),
  redactSensitive: z.enum(["off", "tools"]).optional(),
  redactPatterns: z.array(z.string()).optional(),
});

// ==================== Gateway Config ====================

export const GatewayAuthConfigSchema = z.object({
  type: z.enum(["none", "token", "password"]),
  token: z.string().optional(),
  password: z.string().optional(),
});

export const GatewayTlsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  cert: z.string().optional(),
  key: z.string().optional(),
});

export const GatewayBindModeSchema = z.enum(["loopback", "lan", "tailnet", "auto"]);

export const GatewayConfigSchema = z.object({
  port: z.number().default(18789),
  host: z.string().optional(),
  bind: GatewayBindModeSchema.optional(),
  auth: GatewayAuthConfigSchema,
  tls: GatewayTlsConfigSchema.optional(),
  heartbeatInterval: z.number().optional(),
  controlUi: z.object({
    enabled: z.boolean().optional(),
  }).optional(),
  http: z.object({
    endpoints: z.object({
      chatCompletions: z.object({ enabled: z.boolean().optional() }).optional(),
      responses: z.object({ enabled: z.boolean().optional() }).optional(),
    }).optional(),
  }).optional(),
});

// ==================== AI Provider Config ====================

export const AiProviderTypeSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "bedrock",
  "azure",
  "ollama",
  "openrouter",
  "together",
  "custom",
]);

export const AiProviderConfigSchema = z.object({
  type: AiProviderTypeSchema,
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  model: z.string(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  organization: z.string().optional(),
});

export const ModelProfileSchema = z.object({
  name: z.string(),
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
});

export const ModelsConfigSchema = z.object({
  default: z.string().optional(),
  profiles: z.array(ModelProfileSchema).optional(),
});

// ==================== Channel Configs ====================

export const TelegramConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string(),
  dmPolicy: DmPolicySchema.optional(),
  groupPolicy: GroupPolicySchema.optional(),
  allowedUsers: z.array(z.string()).optional(),
  allowedGroups: z.array(z.string()).optional(),
  webhook: z.object({
    enabled: z.boolean().optional(),
    url: z.string().optional(),
    port: z.number().optional(),
  }).optional(),
});

export const DiscordConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string(),
  dmPolicy: DmPolicySchema.optional(),
  guildPolicy: GroupPolicySchema.optional(),
  allowedUsers: z.array(z.string()).optional(),
  allowedGuilds: z.array(z.string()).optional(),
  intents: z.array(z.string()).optional(),
});

export const SlackConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string(),
  signingSecret: z.string().optional(),
  appToken: z.string().optional(),
  socketMode: z.boolean().optional(),
  dmPolicy: DmPolicySchema.optional(),
  channelPolicy: GroupPolicySchema.optional(),
});

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean(),
  sessionName: z.string().optional(),
  dmPolicy: DmPolicySchema.optional(),
  groupPolicy: GroupPolicySchema.optional(),
});

export const SignalConfigSchema = z.object({
  enabled: z.boolean(),
  phoneNumber: z.string().optional(),
  dmPolicy: DmPolicySchema.optional(),
  groupPolicy: GroupPolicySchema.optional(),
});

export const IMessageConfigSchema = z.object({
  enabled: z.boolean(),
  dmPolicy: DmPolicySchema.optional(),
  groupPolicy: GroupPolicySchema.optional(),
});

export const WebChatConfigSchema = z.object({
  enabled: z.boolean(),
  port: z.number().optional(),
  cors: z.array(z.string()).optional(),
});

export const ChannelsConfigSchema = z.object({
  telegram: TelegramConfigSchema.optional(),
  discord: DiscordConfigSchema.optional(),
  slack: SlackConfigSchema.optional(),
  whatsapp: WhatsAppConfigSchema.optional(),
  signal: SignalConfigSchema.optional(),
  imessage: IMessageConfigSchema.optional(),
  webchat: WebChatConfigSchema.optional(),
});

// ==================== Tools Config ====================

export const BashToolConfigSchema = z.object({
  enabled: z.boolean(),
  allowedCommands: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  requireApproval: z.boolean().optional(),
});

export const FileToolConfigSchema = z.object({
  enabled: z.boolean(),
  allowedPaths: z.array(z.string()).optional(),
  requireApproval: z.boolean().optional(),
});

export const BrowserToolConfigSchema = z.object({
  enabled: z.boolean(),
  headless: z.boolean().optional(),
  executablePath: z.string().optional(),
});

export const WebToolConfigSchema = z.object({
  enabled: z.boolean(),
  timeout: z.number().optional(),
});

export const ToolsConfigSchema = z.object({
  bash: BashToolConfigSchema.optional(),
  file: FileToolConfigSchema.optional(),
  browser: BrowserToolConfigSchema.optional(),
  web: WebToolConfigSchema.optional(),
});

// ==================== Memory Config ====================

export const MemoryBackendSchema = z.enum(["sqlite", "lancedb"]);

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  backend: MemoryBackendSchema.optional(),
  path: z.string().optional(),
  citations: z.boolean().optional(),
  qmd: z.object({
    enabled: z.boolean().optional(),
    endpoint: z.string().optional(),
  }).optional(),
});

// ==================== Cron Config ====================

export const CronJobSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  command: z.string(),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const CronConfigSchema = z.object({
  enabled: z.boolean().optional(),
  jobs: z.array(CronJobSchema).optional(),
});

// ==================== Plugins Config ====================

export const PluginEntrySchema = z.object({
  name: z.string(),
  enabled: z.boolean().optional(),
  path: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

export const PluginsConfigSchema = z.object({
  entries: z.record(PluginEntrySchema).optional(),
});

// ==================== Security Config ====================

export const ApprovalsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  tools: z.array(z.string()).optional(),
  autoApprove: z.array(z.string()).optional(),
});

// ==================== Browser Config ====================

export const BrowserConfigSchema = z.object({
  enabled: z.boolean().optional(),
  headless: z.boolean().optional(),
  executablePath: z.string().optional(),
  userDataDir: z.string().optional(),
});

// ==================== Main Config ====================

export const MiniConfigSchema = z.object({
  meta: z.object({
    lastTouchedVersion: z.string().optional(),
    lastTouchedAt: z.string().optional(),
  }).optional(),
  
  env: z.object({
    shellEnv: z.object({
      enabled: z.boolean().optional(),
      timeoutMs: z.number().optional(),
    }).optional(),
    vars: z.record(z.string()).optional(),
  }).optional(),
  
  wizard: z.object({
    lastRunAt: z.string().optional(),
    lastRunVersion: z.string().optional(),
  }).optional(),
  
  logging: LoggingConfigSchema.optional(),
  diagnostics: DiagnosticsConfigSchema.optional(),
  
  update: z.object({
    channel: z.enum(["stable", "beta", "dev"]).optional(),
    checkOnStart: z.boolean().optional(),
  }).optional(),
  
  gateway: GatewayConfigSchema,
  ai: AiProviderConfigSchema,
  models: ModelsConfigSchema.optional(),
  
  channels: ChannelsConfigSchema.optional(),
  session: SessionConfigSchema.optional(),
  
  tools: ToolsConfigSchema.optional(),
  browser: BrowserConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  cron: CronConfigSchema.optional(),
  plugins: PluginsConfigSchema.optional(),
  approvals: ApprovalsConfigSchema.optional(),
  
  ui: z.object({
    seamColor: z.string().optional(),
    assistant: z.object({
      name: z.string().optional(),
      avatar: z.string().optional(),
    }).optional(),
  }).optional(),
});

// ==================== Type Exports ====================

export type MiniConfig = z.infer<typeof MiniConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type DiagnosticsConfig = z.infer<typeof DiagnosticsConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type CronConfig = z.infer<typeof CronConfigSchema>;
export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
export type ApprovalsConfig = z.infer<typeof ApprovalsConfigSchema>;
