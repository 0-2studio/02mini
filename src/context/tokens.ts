/**
 * Token Utilities
 * Token counting and budget management for context compression
 * Based on OpenClaw's context management
 */

import { encodingForModel, type TiktokenModel } from 'js-tiktoken';
import type { ChatMessage } from '../ai/client.js';

// Token budget configuration
export const TOKEN_CONFIG = {
  // Total context window size (adjust based on model)
  maxContextTokens: 8000,
  
  // Reserve tokens for system prompt
  systemPromptReserve: 2000,
  
  // Reserve tokens for response
  responseReserve: 1000,
  
  // Available tokens for conversation history
  get maxHistoryTokens(): number {
    return this.maxContextTokens - this.systemPromptReserve - this.responseReserve;
  },
  
  // Warning threshold (80% of max history)
  get warningThreshold(): number {
    return Math.floor(this.maxHistoryTokens * 0.8);
  },
  
  // Critical threshold (95% of max history) - trigger aggressive compression
  get criticalThreshold(): number {
    return Math.floor(this.maxHistoryTokens * 0.95);
  },
  
  // Target tokens after compression (50% of max history)
  get targetTokensAfterCompression(): number {
    return Math.floor(this.maxHistoryTokens * 0.5);
  },
};

// Model encoding cache
const encodingCache = new Map<string, ReturnType<typeof encodingForModel>>();

/**
 * Get encoding for a model
 */
function getEncoding(model: string): ReturnType<typeof encodingForModel> {
  // Map common model names to tiktoken models
  const modelMapping: Record<string, TiktokenModel> = {
    'gpt-4': 'gpt-4',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    'claude': 'gpt-4', // Fallback to gpt-4 encoding for Claude
    'glm': 'gpt-4',    // Fallback for GLM models
  };
  
  // Find matching model
  let tiktokenModel: TiktokenModel = 'gpt-4'; // Default fallback
  for (const [prefix, mapped] of Object.entries(modelMapping)) {
    if (model.toLowerCase().includes(prefix.toLowerCase())) {
      tiktokenModel = mapped;
      break;
    }
  }
  
  // Use cached encoding or create new
  if (!encodingCache.has(tiktokenModel)) {
    encodingCache.set(tiktokenModel, encodingForModel(tiktokenModel));
  }
  
  return encodingCache.get(tiktokenModel)!;
}

/**
 * Count tokens in a single message
 */
export function countMessageTokens(message: ChatMessage, model: string = 'gpt-4'): number {
  const encoding = getEncoding(model);
  
  // Base tokens per message (formatting overhead)
  // Every message follows <|start|>{role}\n{content}<|end|>\n
  const baseTokens = 4; 
  
  // Count role tokens
  const roleTokens = encoding.encode(message.role).length;
  
  // Count content tokens
  const contentTokens = encoding.encode(message.content || '').length;
  
  // Count tool_calls if present
  let toolTokens = 0;
  if (message.tool_calls) {
    for (const tool of message.tool_calls) {
      toolTokens += encoding.encode(tool.function.name || '').length;
      toolTokens += encoding.encode(tool.function.arguments || '').length;
      toolTokens += 4; // Overhead per tool call
    }
  }
  
  // Count tool_call_id if present
  let toolCallIdTokens = 0;
  if (message.tool_call_id) {
    toolCallIdTokens = encoding.encode(message.tool_call_id).length + 2;
  }
  
  return baseTokens + roleTokens + contentTokens + toolTokens + toolCallIdTokens;
}

/**
 * Count total tokens in a conversation
 */
export function countConversationTokens(
  messages: ChatMessage[],
  model: string = 'gpt-4'
): { total: number; breakdown: number[] } {
  const breakdown = messages.map(msg => countMessageTokens(msg, model));
  const total = breakdown.reduce((sum, count) => sum + count, 0);
  
  return { total, breakdown };
}

/**
 * Get token usage status
 */
export function getTokenStatus(
  messages: ChatMessage[],
  model: string = 'gpt-4'
): {
  used: number;
  max: number;
  remaining: number;
  percentage: number;
  status: 'ok' | 'warning' | 'critical';
} {
  const { total } = countConversationTokens(messages, model);
  const max = TOKEN_CONFIG.maxHistoryTokens;
  const remaining = max - total;
  const percentage = (total / max) * 100;
  
  let status: 'ok' | 'warning' | 'critical' = 'ok';
  if (total >= TOKEN_CONFIG.criticalThreshold) {
    status = 'critical';
  } else if (total >= TOKEN_CONFIG.warningThreshold) {
    status = 'warning';
  }
  
  return {
    used: total,
    max,
    remaining,
    percentage,
    status,
  };
}

/**
 * Simple string-based token estimation (fallback when tiktoken fails)
 * Rough estimate: ~4 characters per token for English/Chinese
 */
export function estimateTokens(text: string): number {
  // Count Unicode characters and divide by average chars per token
  const charCount = Array.from(text).length;
  return Math.ceil(charCount / 4);
}

/**
 * Format token count for display
 */
export function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

/**
 * Check if compaction is needed
 */
export function checkCompactionNeeded(
  messages: ChatMessage[],
  model: string = 'gpt-4'
): { needed: boolean; level: 'none' | 'light' | 'medium' | 'heavy'; stats: ReturnType<typeof getTokenStatus> } {
  const stats = getTokenStatus(messages, model);
  
  if (stats.status === 'critical') {
    return { needed: true, level: 'heavy', stats };
  } else if (stats.status === 'warning') {
    return { needed: true, level: 'medium', stats };
  } else if (stats.percentage > 60) {
    return { needed: true, level: 'light', stats };
  }
  
  return { needed: false, level: 'none', stats };
}