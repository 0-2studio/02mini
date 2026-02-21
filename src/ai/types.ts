/**
 * AI Provider Types
 */

import type { Message, AiResponse } from "../config/types.js";

export interface AiProvider {
  chat(messages: Message[]): Promise<AiResponse>;
  chatStream(messages: Message[], onChunk: (chunk: string) => void): Promise<AiResponse>;
  validate(): Promise<boolean>;
  model: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}
