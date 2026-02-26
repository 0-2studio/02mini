/**
 * Context Compaction
 * AI-powered intelligent summarization for context compression
 * Based on OpenClaw's compaction system
 */

import type { ChatMessage } from '../ai/client.js';
import type { 
  CompactionResult, 
  SummaryBlock, 
  CompactionLevel,
  CompactionStrategy,
} from './types.js';
import { COMPACTION_STRATEGIES, type KeyFact } from './types.js';
import { countConversationTokens, countMessageTokens, TOKEN_CONFIG } from './tokens.js';
import { aiMediumCompaction, aiHeavyCompaction, aiLightCompaction, aiEmergencyCompaction } from './ai-summarizer.js';

/**
 * Simple summarization without AI (for fallback)
 */
function createSimpleSummary(messages: ChatMessage[]): string {
  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  
  const topics = userMsgs.slice(-3).map(m => {
    const content = m.content || '';
    // Extract first sentence or first 50 chars
    const firstSentence = content.split(/[.!?。！？]/)[0];
    return firstSentence.slice(0, 50) + (firstSentence.length > 50 ? '...' : '');
  });
  
  return `[${messages.length} messages summarized] Topics: ${topics.join('; ')}`;
}

/**
 * Extract key facts from messages (simple version)
 */
export function extractKeyFacts(messages: ChatMessage[]): KeyFact[] {
  const facts: KeyFact[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = msg.content || '';
    
    // Look for facts in user messages
    if (msg.role === 'user') {
      // Extract preferences
      if (content.match(/i (like|prefer|want|need|hate)/i)) {
        facts.push({
          fact: `User preference: ${content.slice(0, 100)}`,
          timestamp: Date.now(),
          importance: 'high',
          sourceMessageIndex: i,
        });
      }
      
      // Extract important instructions
      if (content.match(/(remember|don't forget|important|critical)/i)) {
        facts.push({
          fact: `Important: ${content.slice(0, 100)}`,
          timestamp: Date.now(),
          importance: 'critical',
          sourceMessageIndex: i,
        });
      }
    }
    
    // Extract decisions/confirmations from assistant
    if (msg.role === 'assistant' && content.match(/(done|completed|finished|success)/i)) {
      facts.push({
        fact: `Completed: ${content.slice(0, 100)}`,
        timestamp: Date.now(),
        importance: 'medium',
        sourceMessageIndex: i,
      });
    }
  }
  
  return facts;
}

/**
 * Group consecutive messages for summarization
 */
function groupMessagesForSummarization(
  messages: ChatMessage[],
  groupSize: number = 6
): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  
  for (let i = 0; i < messages.length; i += groupSize) {
    // Skip system messages (keep them as is)
    const group = messages.slice(i, i + groupSize);
    if (group.some(m => m.role !== 'system')) {
      groups.push(group);
    }
  }
  
  return groups;
}

/**
 * Create summary blocks from message groups
 */
async function createSummaryBlocks(
  groups: ChatMessage[][]
): Promise<SummaryBlock[]> {
  const blocks: SummaryBlock[] = [];
  
  for (const group of groups) {
    // Find original indices
    // This is a simplification - in real implementation we'd track indices properly
    const summary = createSimpleSummary(group);
    const keyFacts = extractKeyFacts(group);
    
    blocks.push({
      originalRange: [0, group.length - 1], // Will be fixed by caller
      summary,
      tokenCount: countMessageTokens({ role: 'assistant', content: summary }),
      keyFacts: keyFacts.map(f => f.fact),
    });
  }
  
  return blocks;
}

/**
 * Medium compression - AI-powered summarization
 * Uses AI to intelligently summarize older messages
 */
export async function mediumCompaction(
  messages: ChatMessage[],
  targetTokens: number = TOKEN_CONFIG.targetTokensAfterCompression,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<CompactionResult> {
  const { total: originalTokens } = countConversationTokens(messages);
  
  // Use AI for intelligent summarization
  const { summaryMessage, keptMessages, summaryBlocks } = await aiMediumCompaction(
    messages,
    targetTokens,
    aiClient
  );
  
  // Combine summary with kept messages
  const finalMessages = [summaryMessage, ...keptMessages.filter(m => m.role !== 'system')];
  const { total: compressedTokens } = countConversationTokens(finalMessages);
  
  // Calculate removed indices
  const keptSet = new Set(keptMessages);
  const removedIndices = messages
    .map((_, idx) => idx)
    .filter(idx => !keptSet.has(messages[idx]) && messages[idx].role !== 'system');
  
  return {
    level: 'medium',
    originalMessages: messages.length,
    compressedMessages: finalMessages.length,
    originalTokens,
    compressedTokens,
    removedIndices,
    summarizedBlocks: summaryBlocks,
    success: compressedTokens <= targetTokens * 1.2,
  };
}

/**
 * Heavy compression - AI-powered aggressive summarization
 */
export async function heavyCompaction(
  messages: ChatMessage[],
  targetTokens: number = TOKEN_CONFIG.targetTokensAfterCompression * 0.8,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<CompactionResult> {
  const { total: originalTokens } = countConversationTokens(messages);
  
  // Use AI for aggressive summarization
  const { summaryMessage, keptMessages, summaryBlocks } = await aiHeavyCompaction(
    messages,
    targetTokens,
    aiClient
  );
  
  // Combine summary with kept messages
  const finalMessages = [summaryMessage, ...keptMessages.filter(m => m.role !== 'system')];
  const { total: compressedTokens } = countConversationTokens(finalMessages);
  
  // Calculate removed indices
  const keptSet = new Set(keptMessages);
  const removedIndices = messages
    .map((_, idx) => idx)
    .filter(idx => !keptSet.has(messages[idx]) && messages[idx].role !== 'system');
  
  return {
    level: 'heavy',
    originalMessages: messages.length,
    compressedMessages: finalMessages.length,
    originalTokens,
    compressedTokens,
    removedIndices,
    summarizedBlocks: summaryBlocks,
    success: compressedTokens <= targetTokens * 1.2,
  };
}

/**
 * Light compression - AI-powered gentle summarization
 * Preserves more context, only summarizes very old messages
 */
export async function lightCompaction(
  messages: ChatMessage[],
  targetTokens: number = TOKEN_CONFIG.targetTokensAfterCompression,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<CompactionResult> {
  const { total: originalTokens } = countConversationTokens(messages);
  
  // Use AI for gentle summarization
  const { summaryMessage, keptMessages, summaryBlocks } = await aiLightCompaction(
    messages,
    targetTokens,
    aiClient
  );
  
  // Combine summary with kept messages
  const finalMessages = [summaryMessage, ...keptMessages.filter(m => m.role !== 'system')];
  const { total: compressedTokens } = countConversationTokens(finalMessages);
  
  // Calculate removed indices (all non-system messages that were summarized)
  const keptSet = new Set(keptMessages);
  const removedIndices = messages
    .map((_, idx) => idx)
    .filter(idx => !keptSet.has(messages[idx]) && messages[idx].role !== 'system');
  
  return {
    level: 'light',
    originalMessages: messages.length,
    compressedMessages: finalMessages.length,
    originalTokens,
    compressedTokens,
    removedIndices,
    summarizedBlocks: summaryBlocks,
    success: compressedTokens <= targetTokens * 1.2,
  };
}

/**
 * Emergency compression - AI-powered minimalist summarization
 * Used when context is at critical level
 */
export async function emergencyCompaction(
  messages: ChatMessage[],
  maxTokens: number = TOKEN_CONFIG.maxHistoryTokens,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<CompactionResult> {
  const { total: originalTokens } = countConversationTokens(messages);
  
  // Use AI for minimalist summarization
  const { summaryMessage, keptMessages, summaryBlocks } = await aiEmergencyCompaction(
    messages,
    maxTokens,
    aiClient
  );
  
  // Combine summary with kept messages
  const finalMessages = [summaryMessage, ...keptMessages.filter(m => m.role !== 'system')];
  const { total: compressedTokens } = countConversationTokens(finalMessages);
  
  // Calculate removed indices
  const keptSet = new Set(keptMessages);
  const removedIndices = messages
    .map((_, idx) => idx)
    .filter(idx => !keptSet.has(messages[idx]) && messages[idx].role !== 'system');
  
  return {
    level: 'emergency',
    originalMessages: messages.length,
    compressedMessages: finalMessages.length,
    originalTokens,
    compressedTokens,
    removedIndices,
    summarizedBlocks: summaryBlocks,
    success: compressedTokens <= maxTokens,
  };
}

/**
 * Main compaction function - chooses appropriate strategy
 * ALL levels now use AI-powered summarization (no message deletion)
 */
export async function compactContext(
  messages: ChatMessage[],
  level: CompactionLevel = 'medium',
  customTargetTokens?: number,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<CompactionResult> {
  const strategy = COMPACTION_STRATEGIES[level];
  const targetTokens = customTargetTokens || strategy.targetTokens;
  
  switch (level) {
    case 'none':
      return {
        level: 'none',
        originalMessages: messages.length,
        compressedMessages: messages.length,
        originalTokens: countConversationTokens(messages).total,
        compressedTokens: countConversationTokens(messages).total,
        removedIndices: [],
        summarizedBlocks: [],
        success: true,
      };
    
    case 'light':
      return lightCompaction(messages, targetTokens, aiClient);
    
    case 'medium':
      return mediumCompaction(messages, targetTokens, aiClient);
    
    case 'heavy':
      return heavyCompaction(messages, targetTokens, aiClient);
    
    case 'emergency':
      return emergencyCompaction(messages, strategy.maxTokens, aiClient);
    
    default:
      return lightCompaction(messages, targetTokens, aiClient);
  }
}

/**
 * Incremental compaction - try levels progressively
 * ALL levels now use AI-powered summarization (no message deletion)
 * New thresholds:
 * - <=50%: No compaction
 * - 50-70%: Light compression (AI gentle summarization)
 * - 70-85%: Medium compression (AI summarization)
 * - 85-100%: Heavy compression (AI aggressive summarization)
 * - >=100%: Emergency compression (AI minimalist summarization)
 */
export async function incrementalCompaction(
  messages: ChatMessage[],
  maxTokens: number = TOKEN_CONFIG.maxHistoryTokens,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<CompactionResult> {
  const { total } = countConversationTokens(messages);
  const percentage = total / maxTokens;

  if (percentage <= 0.5) {
    // No compaction needed (<50%)
    return {
      level: 'none',
      originalMessages: messages.length,
      compressedMessages: messages.length,
      originalTokens: total,
      compressedTokens: total,
      removedIndices: [],
      summarizedBlocks: [],
      success: true,
    };
  }

  // Light compression at 50-70% (AI gentle summarization)
  if (percentage <= 0.7) {
    return lightCompaction(messages, TOKEN_CONFIG.targetTokensAfterCompression, aiClient);
  }

  // Medium compression at 70-85% (AI summarization)
  if (percentage <= 0.85) {
    return mediumCompaction(messages, TOKEN_CONFIG.targetTokensAfterCompression, aiClient);
  }

  // Heavy compression at 85-100% (AI aggressive summarization)
  if (percentage < 1.0) {
    return heavyCompaction(messages, TOKEN_CONFIG.targetTokensAfterCompression * 0.8, aiClient);
  }

  // Emergency compression at >=100% (AI minimalist summarization)
  return emergencyCompaction(messages, maxTokens, aiClient);
}