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
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> };
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
  private aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> };

  // Compaction blocking mechanism
  private isCompacting: boolean = false;
  private compactionResolvers: (() => void)[] = [];

  constructor(options: ContextManagerOptions = {}) {
    this.maxTokens = options.maxTokens || TOKEN_CONFIG.maxHistoryTokens;
    this.enableAutoCompaction = options.enableAutoCompaction ?? true;
    this.minMessagesBeforeCompaction = options.minMessagesBeforeCompaction || 10;
    this.aiClient = options.aiClient;
  }
  
  // Queue for pending compaction requests
  private compactionQueue: (() => void)[] = [];
  private isProcessingCompaction = false;

  /**
   * Check if compaction is needed and perform it
   * CRITICAL: This method ensures atomic compaction - only one at a time
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
    // If already compacting, wait for it to complete and return
    if (this.isCompacting || this.isProcessingCompaction) {
      await this.waitForCompaction();
      // After waiting, return without compacting (someone else just did it)
      return { messages, compacted: false };
    }

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

    // ATOMIC: Set flags immediately to prevent other concurrent compactions
    this.isProcessingCompaction = true;
    this.isCompacting = true;

    try {
      // Perform compaction (pass AI client for intelligent summarization)
      const result = await incrementalCompaction(messages, this.maxTokens, this.aiClient);

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
    } finally {
      // CRITICAL: Always end compaction - unblock waiting operations
      this.endCompaction();
    }
  }
  
  /**
   * Rebuild message array from compaction result
   * CRITICAL: Preserves system messages and maintains proper message order
   */
  private rebuildMessages(
    originalMessages: ChatMessage[],
    result: CompactionResult
  ): ChatMessage[] {
    // Separate system messages (always preserve)
    const systemMessages = originalMessages.filter(m => m.role === 'system');
    
    // Get non-system messages that weren't removed
    const removedSet = new Set(result.removedIndices);
    const keptMessages = originalMessages.filter((msg, idx) => 
      msg.role !== 'system' && !removedSet.has(idx)
    );
    
    // If we have a summary, add it as a system message at the start of conversation
    const summaryMessages: ChatMessage[] = [];
    if (result.summarizedBlocks.length > 0) {
      const summaryContent = result.summarizedBlocks
        .map(block => block.summary)
        .join('\n\n---\n\n');
      
      // Add post-compaction context reminder as a system message
      summaryMessages.push({
        role: 'system',
        content: `[CONTEXT COMPACTED - ${result.level.toUpperCase()}]\n\n` +
                 `Previous conversation has been summarized to save space.\n` +
                 `Summary of earlier messages:\n\n${summaryContent}\n\n` +
                 `Key facts preserved: ${result.summarizedBlocks.flatMap(b => b.keyFacts).slice(0, 5).join('; ') || 'None'}`,
      });
    }
    
    // Rebuild: System messages + Summary (if any) + Kept messages
    // System messages go first, then summary, then kept conversation
    return [
      ...systemMessages,
      ...summaryMessages,
      ...keptMessages,
    ];
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
   * Set AI client for intelligent summarization
   */
  setAIClient(aiClient: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }): void {
    this.aiClient = aiClient;
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

  /**
   * Check if compaction is currently in progress
   */
  isCompactionInProgress(): boolean {
    return this.isCompacting;
  }

  /**
   * Wait for compaction to complete
   * Returns immediately if not compacting
   */
  async waitForCompaction(): Promise<void> {
    if (!this.isCompacting) {
      return;
    }

    return new Promise((resolve) => {
      this.compactionResolvers.push(resolve);
    });
  }

  /**
   * Start compaction - blocks other operations
   */
  private startCompaction(): void {
    this.isCompacting = true;
    console.log('[Context] Compaction started - blocking other operations');
  }

  /**
   * End compaction - unblock waiting operations
   */
  private endCompaction(): void {
    // Reset all flags atomically
    this.isCompacting = false;
    this.isProcessingCompaction = false;
    console.log('[Context] Compaction completed - unblocking operations');

    // Resolve all waiting promises
    while (this.compactionResolvers.length > 0) {
      const resolve = this.compactionResolvers.shift();
      resolve?.();
    }
  }
}
