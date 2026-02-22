/**
 * Context Types
 * Type definitions for context compression
 */

import type { ChatMessage } from '../ai/client.js';

/** Compaction levels */
export type CompactionLevel = 'none' | 'light' | 'medium' | 'heavy' | 'emergency';

/** Message importance for retention decisions */
export type MessageImportance = 'critical' | 'high' | 'medium' | 'low';

/** Message with metadata for compression decisions */
export interface MessageWithMetadata {
  message: ChatMessage;
  index: number;
  importance: MessageImportance;
  tokenCount: number;
  isProtected: boolean;
  canSummarize: boolean;
}

/** Compaction result */
export interface CompactionResult {
  level: CompactionLevel;
  originalMessages: number;
  compressedMessages: number;
  originalTokens: number;
  compressedTokens: number;
  removedIndices: number[];
  summarizedBlocks: SummaryBlock[];
  success: boolean;
}

/** Summary block for replaced messages */
export interface SummaryBlock {
  originalRange: [number, number]; // [start, end] inclusive
  summary: string;
  tokenCount: number;
  keyFacts: string[];
}

/** Protection rules */
export interface ProtectionRules {
  // Always protect system messages
  protectSystem: boolean;
  
  // Protect recent N messages
  protectRecent: number;
  
  // Protect incomplete tool call chains
  protectIncompleteToolChains: boolean;
  
  // Protect messages with specific keywords
  protectKeywords: string[];
  
  // Min messages to keep
  minMessagesToKeep: number;
}

/** Default protection rules */
export const DEFAULT_PROTECTION_RULES: ProtectionRules = {
  protectSystem: true,
  protectRecent: 4, // Keep last 2 exchanges (user + assistant)
  protectIncompleteToolChains: true,
  protectKeywords: ['important', 'remember', 'don\'t forget', 'critical'],
  minMessagesToKeep: 4,
};

/** Compaction strategy */
export interface CompactionStrategy {
  level: CompactionLevel;
  maxTokens: number;
  targetTokens: number;
  rules: ProtectionRules;
  useAISummarization: boolean;
  preserveToolChains: boolean;
}

/** Strategies by level */
export const COMPACTION_STRATEGIES: Record<CompactionLevel, CompactionStrategy> = {
  none: {
    level: 'none',
    maxTokens: Infinity,
    targetTokens: Infinity,
    rules: DEFAULT_PROTECTION_RULES,
    useAISummarization: false,
    preserveToolChains: true,
  },
  light: {
    level: 'light',
    maxTokens: 6000,
    targetTokens: 4000,
    rules: { ...DEFAULT_PROTECTION_RULES, protectRecent: 6 },
    useAISummarization: false,
    preserveToolChains: true,
  },
  medium: {
    level: 'medium',
    maxTokens: 7000,
    targetTokens: 3500,
    rules: { ...DEFAULT_PROTECTION_RULES, protectRecent: 4 },
    useAISummarization: true,
    preserveToolChains: true,
  },
  heavy: {
    level: 'heavy',
    maxTokens: 7500,
    targetTokens: 3000,
    rules: { ...DEFAULT_PROTECTION_RULES, protectRecent: 2, minMessagesToKeep: 3 },
    useAISummarization: true,
    preserveToolChains: false,
  },
  emergency: {
    level: 'emergency',
    maxTokens: 8000,
    targetTokens: 2500,
    rules: { ...DEFAULT_PROTECTION_RULES, protectRecent: 2, minMessagesToKeep: 2 },
    useAISummarization: false,
    preserveToolChains: false,
  },
};

/** Key fact extracted from conversation */
export interface KeyFact {
  fact: string;
  timestamp: number;
  importance: MessageImportance;
  sourceMessageIndex: number;
}

/** Context window statistics */
export interface ContextWindowStats {
  totalMessages: number;
  totalTokens: number;
  systemMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolMessages: number;
  oldestMessageAge: number; // ms since oldest message
  compressionCount: number; // How many times compressed
}
