/**
 * Context Manager
 * Central manager for context window and compression
 * Integrates token counting, pruning, and compaction
 */

import type { ChatMessage } from '../ai/client.js';
import type { CompactionResult, CompactionLevel, ContextWindowStats } from './types.js';
import { 
  countConversationTokens, 
  checkCompactionNeeded,
  getTokenStatus,
  formatTokenCount,
  TOKEN_CONFIG,
} from './tokens.js';
import { incrementalCompaction, compactContext, extractKeyFacts } from './compaction.js';
import type { AIClient } from '../ai/client.js';

export interface ContextManagerOptions {
  maxTokens?: number;
  enableAutoCompaction?: boolean;
  compactionThreshold?: number;
  minMessagesBeforeCompaction?: number;
  preserveSystemMessages?: boolean;
}

export interface CompressionReport {
  timestamp: number;
  level: CompactionLevel;
  originalMessages: number;
  compressedMessages: number;
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  savedPercentage: number;
}

export class ContextManager {
  private maxTokens: number;
  private enableAutoCompaction: boolean;
  private minMessagesBeforeCompaction: number;
  private compressionHistory: CompressionReport[] = [];
  private lastCompactionTime: number = 0;
  private compactionCooldownMs: number = 5000; // 5 seconds between compactions
  
  constructor(options: ContextManagerOptions = {}) {
    this.maxTokens = options.maxTokens || TOKEN_CONFIG.maxHistoryTokens;
    this.enableAutoCompaction = options.enableAutoCompaction ?? true;
    this.minMessagesBeforeCompaction = options.minMessagesBeforeCompaction || 10;
  }
  
  /**
   * Check if compaction is needed and perform it
   */
  async checkAndCompact(
    messages: ChatMessage[],
    options: {
      forceLevel?: CompactionLevel;
      silent?: boolean;
    } = {}
  ): Promise<{ 
    messages: ChatMessage[]; 
    compacted: boolean; 
    report?: CompressionReport;
  }> {
    // Don't compact if disabled
    if (!this.enableAutoCompaction && !options.forceLevel) {
      return { messages, compacted: false };
    }
    
    // Don't compact if too few messages
    if (messages.length < this.minMessagesBeforeCompaction && !options.forceLevel) {
      return { messages, compacted: false };
    }
    
    // Check cooldown
    const now = Date.now();
    if (now - this.lastCompactionTime < this.compactionCooldownMs && !options.forceLevel) {
      return { messages, compacted: false };
    }
    
    // Determine compaction level
    let level: CompactionLevel;
    if (options.forceLevel) {
      level = options.forceLevel;
    } else {
      const check = checkCompactionNeeded(messages);
      if (!check.needed) {
        return { messages, compacted: false };
      }
      level = check.level;
    }
    
    // Perform compaction
    const result = await incrementalCompaction(messages, this.maxTokens);
    
    // If compaction didn't help much, return original
    if (result.compressedTokens >= result.originalTokens * 0.95) {
      return { messages, compacted: false };
    }
    
    // Update state
    this.lastCompactionTime = now;
    
    // Build report
    const report: CompressionReport = {
      timestamp: now,
      level: result.level,
      originalMessages: result.originalMessages,
      compressedMessages: result.compressedMessages,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      savedTokens: result.originalTokens - result.compressedTokens,
      savedPercentage: ((result.originalTokens - result.compressedTokens) / result.originalTokens) * 100,
    };
    
    this.compressionHistory.push(report);
    
    // Keep only last 20 reports
    if (this.compressionHistory.length > 20) {
      this.compressionHistory = this.compressionHistory.slice(-20);
    }
    
    // Log if not silent
    if (!options.silent) {
      console.log(
        `[Context] Compacted ${report.originalMessages}→${report.compressedMessages} messages ` +
        `(${formatTokenCount(report.originalTokens)}→${formatTokenCount(report.compressedTokens)} tokens, ` +
        `-${report.savedPercentage.toFixed(1)}%)`
      );
    }
    
    return {
      messages: result.removedIndices.length > 0 
        ? this.rebuildMessages(messages, result)
        : messages,
      compacted: true,
      report,
    };
  }
  
  /**
   * Rebuild message array from compaction result
   */
  private rebuildMessages(
    originalMessages: ChatMessage[],
    result: CompactionResult
  ): ChatMessage[] {
    // If we have summary blocks, use them
    if (result.summarizedBlocks.length > 0) {
      const newMessages: ChatMessage[] = [];
      const removedSet = new Set(result.removedIndices);
      
      // Add system messages first
      for (let i = 0; i < originalMessages.length; i++) {
        if (!removedSet.has(i) || originalMessages[i].role === 'system') {
          newMessages.push(originalMessages[i]);
        }
      }
      
      return newMessages;
    }
    
    // Simple filtering
    const removedSet = new Set(result.removedIndices);
    return originalMessages.filter((_, idx) => !removedSet.has(idx));
  }
  
  /**
   * Get current token stats
   */
  getStats(messages: ChatMessage[]): ContextWindowStats {
    const { total } = countConversationTokens(messages);
    
    return {
      totalMessages: messages.length,
      totalTokens: total,
      systemMessages: messages.filter(m => m.role === 'system').length,
      userMessages: messages.filter(m => m.role === 'user').length,
      assistantMessages: messages.filter(m => m.role === 'assistant').length,
      toolMessages: messages.filter(m => m.role === 'tool').length,
      oldestMessageAge: messages.length > 0 
        ? Date.now() - this.lastCompactionTime 
        : 0,
      compressionCount: this.compressionHistory.length,
    };
  }
  
  /**
   * Get token status display
   */
  getStatusDisplay(messages: ChatMessage[]): string {
    const status = getTokenStatus(messages);
    const stats = this.getStats(messages);
    
    const percentage = status.percentage.toFixed(1);
    const statusEmoji = status.status === 'critical' ? '🔴' : 
                       status.status === 'warning' ? '🟡' : '🟢';
    
    return `${statusEmoji} Context: ${stats.totalMessages} msgs, ${formatTokenCount(status.used)}/${formatTokenCount(status.max)} tokens (${percentage}%)`;
  }
  
  /**
   * Get compression history
   */
  getCompressionHistory(): CompressionReport[] {
    return [...this.compressionHistory];
  }
  
  /**
   * Force compaction at specific level
   */
  async forceCompaction(
    messages: ChatMessage[],
    level: CompactionLevel
  ): Promise<{ messages: ChatMessage[]; report?: CompressionReport }> {
    const result = await this.checkAndCompact(messages, { forceLevel: level });
    return { messages: result.messages, report: result.report };
  }
  
  /**
   * Extract and save key facts
   */
  extractKeyFacts(messages: ChatMessage[]): string[] {
    const facts = extractKeyFacts(messages);
    return facts.map(f => f.fact);
  }
  
  /**
   * Check if compaction is currently on cooldown
   */
  isOnCooldown(): boolean {
    return Date.now() - this.lastCompactionTime < this.compactionCooldownMs;
  }
  
  /**
   * Reset compression history
   */
  resetHistory(): void {
    this.compressionHistory = [];
    this.lastCompactionTime = 0;
  }
}
