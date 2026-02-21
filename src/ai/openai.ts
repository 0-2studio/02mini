/**
 * OpenAI Provider Implementation
 */

import type { AiProvider } from "./types.js";
import type { AiProviderConfig, Message, AiResponse } from "../config/types.js";

export interface OpenAIConfig extends AiProviderConfig {
  type: "openai";
  organization?: string;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAICompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason: string | null;
  }>;
}

export class OpenAIProvider implements AiProvider {
  private config: OpenAIConfig;
  private baseUrl: string;

  constructor(config: OpenAIConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
  }

  get model(): string {
    return this.config.model;
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          ...(this.config.organization && { "OpenAI-Organization": this.config.organization }),
        },
      });

      return response.ok;
    } catch (error) {
      console.error("[openai] Validation error:", error);
      return false;
    }
  }

  async chat(messages: Message[]): Promise<AiResponse> {
    const openaiMessages = this.formatMessages(messages);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
        ...(this.config.organization && { "OpenAI-Organization": this.config.organization }),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: openaiMessages,
        max_tokens: this.config.maxTokens || 2000,
        temperature: this.config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json() as OpenAICompletionResponse;

    return {
      content: data.choices[0]?.message?.content || "",
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  }

  async chatStream(
    messages: Message[],
    onChunk: (chunk: string) => void
  ): Promise<AiResponse> {
    const openaiMessages = this.formatMessages(messages);
    
    console.log("[openai] Sending stream request:", { 
      baseUrl: this.baseUrl, 
      model: this.config.model,
      messageCount: openaiMessages.length 
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
        ...(this.config.organization && { "OpenAI-Organization": this.config.organization }),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: openaiMessages,
        max_tokens: this.config.maxTokens || 2000,
        temperature: this.config.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[openai] API error:", { status: response.status, error: errorText });
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let chunkCount = 0;
    let buffer = "";

    console.log("[openai] Starting to read stream...");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("[openai] Stream done");
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        chunkCount++;
        buffer += chunk;
        
        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            
            if (data === "[DONE]") {
              console.log("[openai] Received [DONE]");
              continue;
            }

            try {
              const parsed: OpenAIStreamResponse = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              
              if (content) {
                fullContent += content;
                onChunk(content);
              }
            } catch (parseError) {
              console.error("[openai] Parse error:", parseError, "data:", data);
            }
          }
        }
      }
      
      // Process any remaining data in buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data && data !== "[DONE]") {
            try {
              const parsed: OpenAIStreamResponse = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                fullContent += content;
                onChunk(content);
              }
            } catch (e) {
              console.error("[openai] Final parse error:", e);
            }
          }
        }
      }
    } catch (readError) {
      console.error("[openai] Read error:", readError);
      throw readError;
    } finally {
      reader.releaseLock();
    }

    console.log("[openai] Stream completed:", { chunks: chunkCount, contentLength: fullContent.length });

    // Estimate tokens (OpenAI doesn't provide usage in stream mode)
    usage.completionTokens = Math.ceil(fullContent.length / 4);

    return {
      content: fullContent,
      usage,
    };
  }

  private formatMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }
}
