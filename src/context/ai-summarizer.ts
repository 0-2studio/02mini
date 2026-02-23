/**
 * AI Summarizer
 * Uses AI to intelligently summarize conversation context
 */

import type { ChatMessage } from '../ai/client.js';
import { globalApiLock } from '../ai/api-lock.js';
import type { SummaryBlock } from './types.js';
import { countMessageTokens, countConversationTokens } from './tokens.js';

/**
 * Build summarization prompt for AI
 */
function buildSummarizationPrompt(messages: ChatMessage[]): string {
  const conversationText = messages.map((msg, idx) => {
    const role = msg.role === 'user' ? 'User' : 
                 msg.role === 'assistant' ? 'Assistant' : 
                 msg.role === 'system' ? 'System' : 'Tool';
    const content = msg.content?.slice(0, 500) || '';
    if (msg.content && msg.content.length > 500) {
      return `[${idx}] ${role}: ${content}... (truncated)`;
    }
    return `[${idx}] ${role}: ${content}`;
  }).join('\n\n');

  return `Please summarize the following conversation history into a concise summary.

The summary should:
1. Preserve the user's original request/intent
2. Include key decisions made during the conversation
3. Include important intermediate results or findings
4. Note any user preferences or requirements mentioned
5. Indicate the current state/progress of the task
6. Be concise but comprehensive (aim for 200-400 tokens)

Conversation history:
${conversationText}

Please provide the summary in this format:
[CONVERSATION SUMMARY]
- Original request: [what the user asked for]
- Key decisions: [important choices made]
- Progress so far: [what has been completed]
- Current state: [where we are now]
- User preferences: [any preferences noted]
- Pending items: [what still needs to be done]`;
}

/**
 * Summarize a group of messages using AI
 * Note: This is a simplified version that returns a structured summary
 * In production, this would call the actual AI API
 */
export async function summarizeWithAI(
  messages: ChatMessage[],
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<{ summary: string; tokenCount: number; keyFacts: string[] }> {
  // If no AI client provided, fall back to simple summarization
  if (!aiClient) {
    return createSimpleSummary(messages);
  }

  try {
    const promptMessage: ChatMessage = {
      role: 'user',
      content: buildSummarizationPrompt(messages),
    };

    // Call AI to generate summary with global lock
    let response = await globalApiLock.withLock(() =>
      aiClient.chatCompletion([
        {
          role: 'system',
          content: 'You are a helpful assistant that summarizes conversations. Be concise but comprehensive.',
        },
        promptMessage,
      ])
    );

    // Handle rate limit error (449) - skip without waiting
    if (response?.status === '449') {
      console.log('[AI Summarizer] Rate limit hit (449), skipping AI summary');
      return createSimpleSummary(messages);
    }

    // Retry with global lock
    if (response?.status === '449') {
      console.log('[AI Summarizer] Retrying summary with lock...');
      response = await globalApiLock.withLock(() =>
        aiClient.chatCompletion([
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes conversations. Be concise but comprehensive.',
          },
          promptMessage,
        ])
      );
    }

    if (response?.choices?.[0]?.message?.content) {
      const summary = response.choices[0].message.content;
      const tokenCount = countMessageTokens({ role: 'assistant', content: summary });

      // Extract key facts from the summary
      const keyFacts = extractKeyFactsFromSummary(summary);

      return { summary, tokenCount, keyFacts };
    }
  } catch (error) {
    console.error('[AI Summarizer] Failed to generate AI summary:', error);
  }

  // Fallback to simple summarization on error
  return createSimpleSummary(messages);
}

/**
 * Create a simple summary without AI (fallback)
 */
function createSimpleSummary(messages: ChatMessage[]): { 
  summary: string; 
  tokenCount: number; 
  keyFacts: string[] 
} {
  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  
  // Extract topics from user messages
  const topics = userMsgs.slice(-3).map(m => {
    const content = m.content || '';
    const firstSentence = content.split(/[.!?。！？]/)[0];
    return firstSentence.slice(0, 50) + (firstSentence.length > 50 ? '...' : '');
  });

  // Count tool calls
  const toolCalls = messages.filter(m => 
    m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0
  ).length;

  const summary = `[${messages.length} messages summarized]
Topics: ${topics.join('; ')}
${toolCalls > 0 ? `Tool calls made: ${toolCalls}` : ''}`;

  const tokenCount = countMessageTokens({ role: 'assistant', content: summary });
  
  // Extract simple key facts
  const keyFacts: string[] = [];
  for (const msg of userMsgs) {
    const content = msg.content || '';
    if (content.match(/(important|remember|critical|preference)/i)) {
      keyFacts.push(content.slice(0, 100));
    }
  }

  return { summary, tokenCount, keyFacts };
}

/**
 * Extract key facts from AI-generated summary
 */
function extractKeyFactsFromSummary(summary: string): string[] {
  const facts: string[] = [];
  
  // Look for bullet points or key lines
  const lines = summary.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || 
        trimmed.match(/^(Original request|Key decisions|Progress|Current state|User preferences|Pending items):/i)) {
      facts.push(trimmed.replace(/^[-•]\s*/, ''));
    }
  }
  
  return facts.slice(0, 10); // Limit to 10 facts
}

/**
 * Select messages for AI summarization
 * Keeps recent messages intact, summarizes older ones
 */
export function selectMessagesForSummarization(
  messages: ChatMessage[],
  keepRecent: number = 6
): {
  toSummarize: ChatMessage[];
  toKeep: ChatMessage[];
  summarizeIndices: number[];
} {
  // Always protect system messages and most recent messages
  const systemMessages: ChatMessage[] = [];
  const nonSystemMessages: ChatMessage[] = [];
  const systemIndices: number[] = [];
  const nonSystemIndices: number[] = [];

  messages.forEach((msg, idx) => {
    if (msg.role === 'system') {
      systemMessages.push(msg);
      systemIndices.push(idx);
    } else {
      nonSystemMessages.push(msg);
      nonSystemIndices.push(idx);
    }
  });

  // Keep the most recent N non-system messages
  const toKeep = nonSystemMessages.slice(-keepRecent);
  const toKeepIndices = nonSystemIndices.slice(-keepRecent);

  // Summarize older non-system messages
  const toSummarize = nonSystemMessages.slice(0, -keepRecent);
  const summarizeIndices = nonSystemIndices.slice(0, -keepRecent);

  return {
    toSummarize,
    toKeep: [...systemMessages, ...toKeep],
    summarizeIndices,
  };
}

/**
 * Create summary blocks using AI
 */
export async function createAISummaryBlocks(
  messages: ChatMessage[],
  groupSize: number = 10,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<SummaryBlock[]> {
  const blocks: SummaryBlock[] = [];
  
  // Group messages for summarization
  for (let i = 0; i < messages.length; i += groupSize) {
    const group = messages.slice(i, i + groupSize);
    if (group.length < 2) {
      // Too few messages to summarize, skip
      continue;
    }

    const { summary, tokenCount, keyFacts } = await summarizeWithAI(group, aiClient);

    blocks.push({
      originalRange: [i, i + group.length - 1],
      summary,
      tokenCount,
      keyFacts,
    });
  }

  return blocks;
}

/**
 * Post-compaction reminder message to re-inject critical context
 */
const POST_COMPACTION_REMINDER: ChatMessage = {
  role: 'system',
  content: '[CONTEXT COMPACTED] Conversation history has been compressed to save space. ' +
    'Remember: 1) You are 02, a self-aware AI with full system access ' +
    '2) Read memory/ files if you need forgotten details ' +
    '3) Continue naturally from where the conversation left off'
};

/**
 * AI-powered medium compression
 * Uses AI to summarize older messages while keeping recent context
 */
export async function aiMediumCompaction(
  messages: ChatMessage[],
  targetTokens: number,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<{
  summaryMessage: ChatMessage;
  keptMessages: ChatMessage[];
  summaryBlocks: SummaryBlock[];
}> {
  // Reduce keepRecent from 6 to 3 for more aggressive compression
  const { toSummarize, toKeep, summarizeIndices } = selectMessagesForSummarization(messages, 3);

  let summaryBlocks: SummaryBlock[] = [];
  let summaryContent = '';

  if (toSummarize.length > 0) {
    // Use AI to summarize older messages
    const result = await summarizeWithAI(toSummarize, aiClient);
    summaryContent = result.summary;

    summaryBlocks = [{
      originalRange: [0, summarizeIndices.length - 1],
      summary: result.summary,
      tokenCount: result.tokenCount,
      keyFacts: result.keyFacts,
    }];
  }

  const summaryMessage: ChatMessage = {
    role: 'assistant',
    content: summaryContent || '[Earlier conversation context]',
  };

  // Re-inject post-compaction reminder and reorganize messages
  const systemMessages = toKeep.filter(m => m.role === 'system');
  const nonSystemKept = toKeep.filter(m => m.role !== 'system');

  return {
    summaryMessage,
    keptMessages: [POST_COMPACTION_REMINDER, ...systemMessages, summaryMessage, ...nonSystemKept],
    summaryBlocks,
  };
}

/**
 * AI-powered heavy compression
 * More aggressive summarization with AI
 */
export async function aiHeavyCompaction(
  messages: ChatMessage[],
  targetTokens: number,
  aiClient?: { chatCompletion: (messages: ChatMessage[], tools?: any[]) => Promise<any> }
): Promise<{
  summaryMessage: ChatMessage;
  keptMessages: ChatMessage[];
  summaryBlocks: SummaryBlock[];
}> {
  // Keep fewer recent messages for heavy compression (already 3)
  const { toSummarize, toKeep, summarizeIndices } = selectMessagesForSummarization(messages, 3);

  let summaryContent = '';
  let summaryBlocks: SummaryBlock[] = [];

  if (toSummarize.length > 0) {
    // Create more detailed summary
    const result = await summarizeWithAI(toSummarize, aiClient);
    summaryContent = `[${toSummarize.length} earlier messages summarized]\n\n${result.summary}`;

    summaryBlocks = [{
      originalRange: [0, summarizeIndices.length - 1],
      summary: summaryContent,
      tokenCount: result.tokenCount + 10, // +10 for the prefix
      keyFacts: result.keyFacts,
    }];
  }

  const summaryMessage: ChatMessage = {
    role: 'assistant',
    content: summaryContent || '[Conversation context summarized]',
  };

  // Re-inject post-compaction reminder and reorganize messages
  const systemMessages = toKeep.filter(m => m.role === 'system');
  const nonSystemKept = toKeep.filter(m => m.role !== 'system');

  return {
    summaryMessage,
    keptMessages: [POST_COMPACTION_REMINDER, ...systemMessages, summaryMessage, ...nonSystemKept],
    summaryBlocks,
  };
}