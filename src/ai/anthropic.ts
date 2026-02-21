/**
 * Anthropic Provider Implementation
 */

import type { AiProvider } from "./types.js";
import type { AiProviderConfig, Message, AiResponse } from "../config/types.js";

export interface AnthropicConfig extends AiProviderConfig {
  type: "anthropic";
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: {
    type: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider implements AiProvider {
  private config: AnthropicConfig;
  private baseUrl: string;

  constructor(config: AnthropicConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
  }

  get model(): string {
    return this.config.model;
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
      });

      return response.ok;
    } catch (error) {
      console.error("[anthropic] Validation error:", error);
      return false;
    }
  }

  async chat(messages: Message[]): Promise<AiResponse> {
    const { system, anthropicMessages } = this.formatMessages(messages);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 2000,
        temperature: this.config.temperature ?? 0.7,
        system,
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json() as AnthropicResponse;

    return {
      content: data.content[0]?.text || "",
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  async chatStream(
    messages: Message[],
    onChunk: (chunk: string) => void
  ): Promise<AiResponse> {
    const { system, anthropicMessages } = this.formatMessages(messages);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 2000,
        temperature: this.config.temperature ?? 0.7,
        system,
        messages: anthropicMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            try {
              const parsed: AnthropicStreamEvent = JSON.parse(data);
              
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                fullContent += parsed.delta.text;
                onChunk(parsed.delta.text);
              }
              
              if (parsed.type === "message_delta" && parsed.usage) {
                usage.promptTokens = parsed.usage.input_tokens;
                usage.completionTokens = parsed.usage.output_tokens;
                usage.totalTokens = parsed.usage.input_tokens + parsed.usage.output_tokens;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      usage,
    };
  }

  private formatMessages(messages: Message[]): { system?: string; anthropicMessages: AnthropicMessage[] } {
    let system: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        system = msg.content;
      } else {
        anthropicMessages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    return { system, anthropicMessages };
  }
}

