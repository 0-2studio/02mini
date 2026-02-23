/**
 * Context Module
 * Text compression and context window management for 02mini
 * Based on OpenClaw's context compaction system
 */

// Core exports
export { ContextManager } from './manager.js';
export type { ContextManagerOptions, CompressionReport } from './manager.js';

// Token utilities
export {
  TOKEN_CONFIG,
  countMessageTokens,
  countConversationTokens,
  getTokenStatus,
  estimateTokens,
  formatTokenCount,
  checkCompactionNeeded,
} from './tokens.js';

// Types
export type {
  CompactionLevel,
  MessageImportance,
  MessageWithMetadata,
  CompactionResult,
  SummaryBlock,
  ProtectionRules,
  CompactionStrategy,
  KeyFact,
  ContextWindowStats,
} from './types.js';

export {
  DEFAULT_PROTECTION_RULES,
  COMPACTION_STRATEGIES,
} from './types.js';

// Pruner
export {
  pruneMessages,
  emergencyPrune,
  isCompleteToolChain,
} from './pruner.js';

// Compaction
export {
  compactContext,
  incrementalCompaction,
  mediumCompaction,
  heavyCompaction,
  extractKeyFacts,
} from './compaction.js';

// AI Summarizer
export {
  summarizeWithAI,
  aiMediumCompaction,
  aiHeavyCompaction,
  createAISummaryBlocks,
  selectMessagesForSummarization,
} from './ai-summarizer.js';

// Tool Truncation
export {
  calculateMaxToolResultChars,
  truncateToolResult,
  truncateMessageIfToolResult,
  truncateToolResults,
  isOversizedToolResult,
  softTrimToolResult,
  hardClearToolResult,
} from './tool-truncation.js';
export type { TruncationConfig } from './tool-truncation.js';
