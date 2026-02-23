/**
 * Tool Result Truncation
 * Limits tool result size to prevent context overflow
 * Based on OpenClaw's tool-result-truncation.ts
 */

import type { ChatMessage } from '../ai/client.js';

// Constants for truncation (from OpenClaw)
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3; // Max 30% of context window per tool result
const MAX_TOOL_RESULT_CHARS_ABSOLUTE = 100000; // Absolute max ~25K tokens
const DEFAULT_CONTEXT_WINDOW_TOKENS = 8000;

export interface TruncationConfig {
  contextWindowTokens?: number;
  maxShare?: number; // 0.0 - 1.0
  headChars?: number;
  tailChars?: number;
}

/**
 * Calculate maximum characters allowed for a tool result
 */
export function calculateMaxToolResultChars(
  contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW_TOKENS,
  maxShare: number = MAX_TOOL_RESULT_CONTEXT_SHARE
): number {
  const maxTokens = Math.floor(contextWindowTokens * maxShare);
  return Math.min(
    maxTokens * CHARS_PER_TOKEN_ESTIMATE,
    MAX_TOOL_RESULT_CHARS_ABSOLUTE
  );
}

/**
 * Truncate tool result content using head+tail strategy
 * Keeps beginning and end, removes middle
 */
export function truncateToolResult(
  content: string,
  maxChars: number,
  headRatio: number = 0.3,
  tailRatio: number = 0.3
): string {
  if (!content || content.length <= maxChars) {
    return content;
  }

  const headChars = Math.floor(maxChars * headRatio);
  const tailChars = Math.floor(maxChars * tailRatio);

  if (headChars + tailChars >= content.length) {
    return content;
  }

  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const omitted = content.length - headChars - tailChars;

  return `${head}\n\n[...${omitted} characters omitted...]\n\n${tail}`;
}

/**
 * Truncate a single message if it's a tool result
 */
export function truncateMessageIfToolResult(
  message: ChatMessage,
  config?: TruncationConfig
): ChatMessage {
  if (message.role !== 'tool') {
    return message;
  }

  const maxChars = calculateMaxToolResultChars(
    config?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    config?.maxShare ?? MAX_TOOL_RESULT_CONTEXT_SHARE
  );

  if (!message.content || message.content.length <= maxChars) {
    return message;
  }

  return {
    ...message,
    content: truncateToolResult(
      message.content,
      maxChars,
      (config?.headChars ?? 0.3),
      (config?.tailChars ?? 0.3)
    ),
  };
}

/**
 * Truncate all tool results in a message array
 */
export function truncateToolResults(
  messages: ChatMessage[],
  config?: TruncationConfig
): ChatMessage[] {
  return messages.map(msg => truncateMessageIfToolResult(msg, config));
}

/**
 * Estimate if a message would exceed size limit
 */
export function isOversizedToolResult(
  message: ChatMessage,
  contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW_TOKENS
): boolean {
  if (message.role !== 'tool') {
    return false;
  }

  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  return (message.content?.length ?? 0) > maxChars;
}

/**
 * Soft trim tool results - keep head and tail, add note
 * Similar to OpenClaw's softTrimToolResultMessage
 */
export function softTrimToolResult(
  content: string,
  maxChars: number,
  headChars: number = 2000,
  tailChars: number = 2000
): string {
  if (!content || content.length <= maxChars) {
    return content;
  }

  // Ensure head + tail doesn't exceed max
  const actualHeadChars = Math.min(headChars, Math.floor(maxChars * 0.5));
  const actualTailChars = Math.min(tailChars, Math.floor(maxChars * 0.5));

  if (actualHeadChars + actualTailChars >= content.length) {
    return content;
  }

  const head = content.slice(0, actualHeadChars);
  const tail = content.slice(-actualTailChars);
  const omitted = content.length - actualHeadChars - actualTailChars;

  return `${head}\n\n[Tool result trimmed: kept first ${actualHeadChars} and last ${actualTailChars} chars of ${content.length}. ${omitted} chars omitted.]\n\n${tail}`;
}

/**
 * Hard clear tool result - replace with placeholder
 * Similar to OpenClaw's hard clear
 */
export function hardClearToolResult(
  content: string,
  placeholder: string = '[Tool result cleared to save context space]'
): string {
  return placeholder;
}