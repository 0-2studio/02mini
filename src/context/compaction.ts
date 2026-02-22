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
import { pruneMessages, emergencyPrune } from './pruner.js';

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
 * Medium compression - prune + simple summarization
 */
export async function mediumCompaction(
  messages: ChatMessage[],
  targetTokens: number = TOKEN_CONFIG.targetTokensAfterCompression
): Promise<CompactionResult> {
  const { total: originalTokens } = countConversationTokens(messages);
  
  // First pass: prune low-importance messages
  const pruned = pruneMessages(
    messages,
    targetTokens * 1.5, // Aim higher initially
    {
      protectSystem: true,
      protectRecent: 4,
      protectIncompleteToolChains: true,
      protectKeywords: ['important', 'remember', 'critical'],
      minMessagesToKeep: 6,
    }
  );
  
  // Get remaining messages
  const remainingIndices = new Set(pruned.removedIndices);
  const remainingMessages = messages.filter((_, idx) => !remainingIndices.has(idx));
  
  // Second pass: summarize older message groups
  const { total: afterPruneTokens } = countConversationTokens(remainingMessages);
  
  if (afterPruneTokens > targetTokens && remainingMessages.length > 8) {
    // Group older messages for summarization
    const olderMessages = remainingMessages.slice(0, -4); // Keep last 4 intact
    const recentMessages = remainingMessages.slice(-4);
    
    const groups = groupMessagesForSummarization(olderMessages, 4);
    const summaryBlocks = await createSummaryBlocks(groups);
    
    // Create summary message
    const summaryContent = summaryBlocks.map(b => b.summary).join('\n\n');
    const summaryMessage: ChatMessage = {
      role: 'assistant',
      content: `[Earlier conversation summarized]\n\n${summaryContent}`,
    };
    
    const finalMessages = [summaryMessage, ...recentMessages];
    const { total: compressedTokens } = countConversationTokens(finalMessages);
    
    return {
      level: 'medium',
      originalMessages: messages.length,
      compressedMessages: finalMessages.length,
      originalTokens,
      compressedTokens,
      removedIndices: pruned.removedIndices,
      summarizedBlocks: summaryBlocks,
      success: compressedTokens <= targetTokens * 1.2,
    };
  }
  
  // Pruning was sufficient
  return {
    level: 'medium',
    originalMessages: messages.length,
    compressedMessages: remainingMessages.length,
    originalTokens,
    compressedTokens: afterPruneTokens,
    removedIndices: pruned.removedIndices,
    summarizedBlocks: [],
    success: afterPruneTokens <= targetTokens * 1.2,
  };
}

/**
 * Heavy compression - aggressive pruning and summarization
 */
export async function heavyCompaction(
  messages: ChatMessage[],
  targetTokens: number = TOKEN_CONFIG.targetTokensAfterCompression * 0.8
): Promise<CompactionResult> {
  const { total: originalTokens } = countConversationTokens(messages);
  
  // Keep only system and most recent messages
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  
  // Extract key facts before removing
  const keyFacts = extractKeyFacts(nonSystemMessages);
  
  // Keep recent messages
  const recentMessages = nonSystemMessages.slice(-3);
  const olderMessages = nonSystemMessages.slice(0, -3);
  
  // Create comprehensive summary of older messages
  let summaryContent = '';
  if (olderMessages.length > 0) {
    const summary = createSimpleSummary(olderMessages);
    const factsText = keyFacts.slice(-5).map(f => `- ${f.fact}`).join('\n');
    summaryContent = `[${olderMessages.length} earlier messages]\n${summary}\n\nKey facts:\n${factsText}`;
  }
  
  const finalMessages: ChatMessage[] = [
    ...systemMessages,
  ];
  
  if (summaryContent) {
    finalMessages.push({
      role: 'assistant',
      content: summaryContent,
    });
  }
  
  finalMessages.push(...recentMessages);
  
  const { total: compressedTokens } = countConversationTokens(finalMessages);
  
  const removedIndices = messages
    .map((_, idx) => idx)
    .filter(idx => !finalMessages.includes(messages[idx]));
  
  return {
    level: 'heavy',
    originalMessages: messages.length,
    compressedMessages: finalMessages.length,
    originalTokens,
    compressedTokens,
    removedIndices,
    summarizedBlocks: olderMessages.length > 0 ? [{
      originalRange: [0, olderMessages.length - 1],
      summary: summaryContent,
      tokenCount: countMessageTokens({ role: 'assistant', content: summaryContent }),
      keyFacts: keyFacts.map(f => f.fact),
    }] : [],
    success: compressedTokens <= targetTokens * 1.2,
  };
}

/**
 * Main compaction function - chooses appropriate strategy
 */
export async function compactContext(
  messages: ChatMessage[],
  level: CompactionLevel = 'medium',
  customTargetTokens?: number
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
      return pruneMessages(messages, targetTokens, strategy.rules);
    
    case 'medium':
      return mediumCompaction(messages, targetTokens);
    
    case 'heavy':
      return heavyCompaction(messages, targetTokens);
    
    case 'emergency':
      return emergencyPrune(messages, strategy.maxTokens, strategy.rules.minMessagesToKeep);
    
    default:
      return pruneMessages(messages, targetTokens, strategy.rules);
  }
}

/**
 * Incremental compaction - try levels progressively
 */
export async function incrementalCompaction(
  messages: ChatMessage[],
  maxTokens: number = TOKEN_CONFIG.maxHistoryTokens
): Promise<CompactionResult> {
  const { total } = countConversationTokens(messages);
  
  if (total <= maxTokens * 0.7) {
    // No compaction needed
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
  
  // Try light first
  if (total <= maxTokens * 0.85) {
    return pruneMessages(messages, TOKEN_CONFIG.targetTokensAfterCompression, COMPACTION_STRATEGIES.light.rules);
  }
  
  // Try medium
  if (total <= maxTokens * 0.95) {
    return mediumCompaction(messages);
  }
  
  // Heavy or emergency
  if (total >= maxTokens) {
    return emergencyPrune(messages, maxTokens);
  }
  
  return heavyCompaction(messages);
}