/**
 * Message Pruner
 * Basic message pruning without AI summarization
 * Based on OpenClaw's context window guard
 */

import type { ChatMessage } from '../ai/client.js';
import type { 
  MessageWithMetadata, 
  ProtectionRules, 
  CompactionResult,
  CompactionLevel,
} from './types.js';
import { 
  countMessageTokens, 
  countConversationTokens,
  TOKEN_CONFIG,
} from './tokens.js';

/**
 * Analyze message importance
 */
function analyzeMessageImportance(
  message: ChatMessage,
  index: number,
  totalMessages: number,
  rules: ProtectionRules
): MessageWithMetadata {
  const tokenCount = countMessageTokens(message);
  
  // Determine importance
  let importance: MessageWithMetadata['importance'] = 'medium';
  let isProtected = false;
  let canSummarize = true;
  
  // System messages are critical
  if (message.role === 'system') {
    importance = 'critical';
    isProtected = rules.protectSystem;
    canSummarize = false;
  }
  
  // Recent messages are high importance
  if (index >= totalMessages - rules.protectRecent) {
    importance = 'high';
    isProtected = true;
  }
  
  // Tool calls and results need special handling
  if (message.role === 'assistant' && message.tool_calls) {
    importance = 'high';
    canSummarize = true; // Can summarize the result
  }
  
  if (message.role === 'tool') {
    importance = 'medium';
    canSummarize = true; // Tool results can be summarized
  }
  
  // Check for protected keywords
  const content = message.content?.toLowerCase() || '';
  if (rules.protectKeywords.some(kw => content.includes(kw.toLowerCase()))) {
    importance = 'high';
    isProtected = true;
  }
  
  // First user message is often important (contains task)
  if (index === 0 && message.role === 'user') {
    importance = 'high';
  }
  
  return {
    message,
    index,
    importance,
    tokenCount,
    isProtected,
    canSummarize,
  };
}

/**
 * Find incomplete tool chains that need protection
 */
function findIncompleteToolChains(messages: ChatMessage[]): Set<number> {
  const protectedIndices = new Set<number>();
  const pendingToolCalls = new Map<string, number>(); // tool_call_id -> message index
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Assistant makes tool calls
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tool of msg.tool_calls) {
        pendingToolCalls.set(tool.id, i);
      }
    }
    
    // Tool responds
    if (msg.role === 'tool' && msg.tool_call_id) {
      if (pendingToolCalls.has(msg.tool_call_id)) {
        // Complete chain, remove from pending
        pendingToolCalls.delete(msg.tool_call_id);
      }
    }
  }
  
  // Protect all pending tool calls and their responses
  if (pendingToolCalls.size > 0) {
    for (const [toolCallId, assistantIndex] of pendingToolCalls) {
      protectedIndices.add(assistantIndex);
      // Find the tool response if it exists
      for (let i = assistantIndex + 1; i < messages.length; i++) {
        if (messages[i].role === 'tool' && messages[i].tool_call_id === toolCallId) {
          protectedIndices.add(i);
          break;
        }
      }
    }
  }
  
  return protectedIndices;
}

/**
 * Simple pruning - remove oldest low-importance messages
 */
export function pruneMessages(
  messages: ChatMessage[],
  targetTokens: number,
  rules: ProtectionRules
): CompactionResult {
  const { total: originalTokens } = countConversationTokens(messages);
  const originalMessages = messages.length;
  
  // Find incomplete tool chains
  const incompleteChains = findIncompleteToolChains(messages);
  
  // Analyze all messages
  const analyzed = messages.map((msg, idx) => {
    const meta = analyzeMessageImportance(msg, idx, messages.length, rules);
    // Mark incomplete chains as protected
    if (rules.protectIncompleteToolChains && incompleteChains.has(idx)) {
      meta.isProtected = true;
      meta.importance = 'critical';
    }
    return meta;
  });
  
  // Separate protected and removable messages
  const protected_messages: MessageWithMetadata[] = [];
  const removable: MessageWithMetadata[] = [];
  
  for (const meta of analyzed) {
    if (meta.isProtected) {
      protected_messages.push(meta);
    } else {
      removable.push(meta);
    }
  }
  
  // Sort removable by importance (low -> high) and index (old -> new)
  removable.sort((a, b) => {
    const importanceOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    if (importanceOrder[a.importance] !== importanceOrder[b.importance]) {
      return importanceOrder[a.importance] - importanceOrder[b.importance];
    }
    return a.index - b.index;
  });
  
  // Calculate how many tokens we need to remove
  const protectedTokens = protected_messages.reduce((sum, m) => sum + m.tokenCount, 0);
  let tokensToRemove = protectedTokens + removable.reduce((sum, m) => sum + m.tokenCount, 0) - targetTokens;
  
  // Select messages to remove
  const removedIndices: number[] = [];
  const keptMessages: ChatMessage[] = [];
  
  // Always keep protected messages
  for (const meta of protected_messages) {
    keptMessages[meta.index] = meta.message;
  }
  
  // Remove low-importance messages until under budget
  for (const meta of removable) {
    if (keptMessages.filter(m => m !== undefined).length >= rules.minMessagesToKeep && tokensToRemove > 0) {
      removedIndices.push(meta.index);
      tokensToRemove -= meta.tokenCount;
    } else {
      keptMessages[meta.index] = meta.message;
    }
  }
  
  // Reconstruct message array in order
  const finalMessages = keptMessages.filter((m): m is ChatMessage => m !== undefined);
  
  const { total: compressedTokens } = countConversationTokens(finalMessages);
  
  return {
    level: 'light',
    originalMessages,
    compressedMessages: finalMessages.length,
    originalTokens,
    compressedTokens,
    removedIndices,
    summarizedBlocks: [],
    success: compressedTokens <= targetTokens || compressedTokens < originalTokens,
  };
}

/**
 * Emergency pruning - keep only most critical messages
 */
export function emergencyPrune(
  messages: ChatMessage[],
  maxTokens: number,
  minMessages: number = 2
): CompactionResult {
  const { total: originalTokens } = countConversationTokens(messages);
  
  // Always keep system messages
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  
  // Keep recent messages
  const recentToKeep = Math.max(minMessages, Math.floor(nonSystemMessages.length * 0.3));
  const recentMessages = nonSystemMessages.slice(-recentToKeep);
  
  const keptMessages = [...systemMessages, ...recentMessages];
  const removedIndices = messages
    .map((_, idx) => idx)
    .filter(idx => !keptMessages.includes(messages[idx]));
  
  const { total: compressedTokens } = countConversationTokens(keptMessages);
  
  return {
    level: 'emergency',
    originalMessages: messages.length,
    compressedMessages: keptMessages.length,
    originalTokens,
    compressedTokens,
    removedIndices,
    summarizedBlocks: [],
    success: true,
  };
}

/**
 * Check if messages form a complete tool call chain
 */
export function isCompleteToolChain(messages: ChatMessage[], startIndex: number): boolean {
  const msg = messages[startIndex];
  if (!msg.tool_calls || msg.tool_calls.length === 0) return true;
  
  const toolCallIds = new Set(msg.tool_calls.map(t => t.id));
  
  // Check if all tool calls have responses
  for (let i = startIndex + 1; i < messages.length; i++) {
    if (messages[i].role === 'tool' && messages[i].tool_call_id) {
      toolCallIds.delete(messages[i].tool_call_id);
    }
  }
  
  return toolCallIds.size === 0;
}
