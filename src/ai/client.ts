/**
 * AI Client
 * OpenAI-compatible API client with tool calling support
 */

export interface AIConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCallRequest[];
  tool_call_id?: string;
}

export interface ToolCallRequest {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCallRequest[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  status?: string;
  msg?: string;
}

export class AIClient {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  static fromEnv(): AIClient {
    const baseURL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = process.env.AI_API_KEY || '';
    const model = process.env.AI_MODEL || 'gpt-4o-mini';
    const temperature = parseFloat(process.env.AI_TEMPERATURE || '0.7');
    const maxTokens = parseInt(process.env.AI_MAX_TOKENS || '4096', 10);

    if (!apiKey) {
      console.warn('[AI] No API key found in environment');
    }

    return new AIClient({
      baseURL,
      apiKey,
      model,
      temperature,
      maxTokens,
    });
  }

  async chatCompletion(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    abortSignal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    if (!this.config.apiKey) {
      throw new Error('No API key configured. Set AI_API_KEY in .env file.');
    }

    // Check if aborted before making request
    if (abortSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const requestBody: Record<string, unknown> = {
        model: this.config.model,
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      };

      if (tools && tools.length > 0) {
        requestBody.tools = tools;
        requestBody.tool_choice = 'auto';
      }

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      };

      // Add abort signal if provided
      if (abortSignal) {
        fetchOptions.signal = abortSignal as any;
      }

      const response = await fetch(`${this.config.baseURL}/chat/completions`, fetchOptions);

      if (!response.ok) {
        // Check for rate limit error (status 449)
        if (response.status === 449) {
          console.log('[AI] Rate limit hit (status 449)');
          return {
            choices: [],
            status: '449',
            msg: 'You exceeded your current rate limit',
          };
        }
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      return await response.json() as ChatCompletionResponse;
    } catch (error) {
      // Check if it's an abort error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DOMException('Aborted', 'AbortError');
      }
      console.error('[AI] Request failed:', error);
      throw error;
    }
  }

  getModel(): string {
    return this.config.model;
  }
}