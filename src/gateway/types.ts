/**
 * Gateway Types
 * Type definitions for the Gateway API
 */

import type { CoreEngine } from '../core/engine.js';
import type { CronScheduler } from '../cron/index.js';

/** Gateway configuration */
export interface GatewayConfig {
  port: number;
  host: string;
  authToken?: string;
  enableCORS: boolean;
  maxRequestSize: number; // in MB
}

/** Gateway session */
export interface GatewaySession {
  id: string;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
}

/** Chat completion request (OpenAI compatible) */
export interface ChatCompletionRequest {
  model?: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

/** Chat completion response */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Send message request */
export interface SendMessageRequest {
  message: string;
  sessionId?: string;
  useHistory?: boolean;
}

/** Send message response */
export interface SendMessageResponse {
  success: boolean;
  response: string;
  sessionId: string;
  processingTime: number;
}

/** System status response */
export interface SystemStatusResponse {
  status: 'running' | 'error' | 'initializing';
  version: string;
  uptime: number;
  context: {
    totalMessages: number;
    status: string;
    compressionCount: number;
  };
  cron: {
    enabled: boolean;
    jobCount: number;
    nextJobAt?: number;
  };
  autonomous: {
    enabled: boolean;
    lastHeartbeat?: number;
    proactiveCountThisHour: number;
  };
}

/** Proactive message from AI */
export interface ProactiveMessage {
  type: 'proactive';
  content: string;
  timestamp: number;
  reason: string;
}

/** WebSocket message types */
export type WebSocketMessage =
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'message'; content: string; sessionId: string }
  | { type: 'response'; content: string; sessionId: string }
  | ProactiveMessage
  | { type: 'error'; message: string };

/** Gateway context for routes */
export interface GatewayContext {
  engine: CoreEngine;
  cronScheduler: CronScheduler;
  config: GatewayConfig;
  sessions: Map<string, GatewaySession>;
  broadcast: (message: ProactiveMessage) => void;
}
