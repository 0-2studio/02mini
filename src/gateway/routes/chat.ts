/**
 * Chat Routes
 * OpenAI-compatible chat completion API
 */

import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../types.js';
import { randomUUID } from 'crypto';

export function createChatRoutes(context: GatewayContext) {
  return async function (app: FastifyInstance) {
    // POST /v1/chat/completions (OpenAI compatible)
    app.post('/chat/completions', async (request, reply) => {
      const startTime = Date.now();
      const body = request.body as {
        model?: string;
        messages: Array<{
          role: 'system' | 'user' | 'assistant' | 'tool';
          content: string;
        }>;
        stream?: boolean;
        temperature?: number;
        max_tokens?: number;
      };

      try {
        // Validate messages
        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
          reply.status(400).send({
            error: 'Bad Request',
            message: 'messages array is required and must not be empty',
          });
          return;
        }

        // Get the last user message
        const lastUserMessage = [...body.messages]
          .reverse()
          .find((m) => m.role === 'user');

        if (!lastUserMessage) {
          reply.status(400).send({
            error: 'Bad Request',
            message: 'At least one user message is required',
          });
          return;
        }

        // Process through engine
        const response = await context.engine.processUserInput(lastUserMessage.content);

        // Build OpenAI-compatible response
        const completion = {
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion' as const,
          created: Math.floor(Date.now() / 1000),
          model: body.model || '02mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: response,
              },
              finish_reason: 'stop' as const,
            },
          ],
          usage: {
            prompt_tokens: lastUserMessage.content.length / 4, // Rough estimate
            completion_tokens: response.length / 4,
            total_tokens: (lastUserMessage.content.length + response.length) / 4,
          },
        };

        reply.send(completion);
      } catch (error) {
        console.error('[Gateway] Chat completion error:', error);
        reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Processing failed',
        });
      }
    });

    // POST /api/send (Simple message API)
    app.post('/send', async (request, reply) => {
      const startTime = Date.now();
      const body = request.body as {
        message: string;
        sessionId?: string;
        useHistory?: boolean;
      };

      try {
        if (!body.message || typeof body.message !== 'string') {
          reply.status(400).send({
            error: 'Bad Request',
            message: 'message is required and must be a string',
          });
          return;
        }

        // Generate or use session ID
        const sessionId = body.sessionId || randomUUID();

        // Process through engine
        const response = await context.engine.processUserInput(body.message);

        reply.send({
          success: true,
          response,
          sessionId,
          processingTime: Date.now() - startTime,
        });
      } catch (error) {
        console.error('[Gateway] Send error:', error);
        reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Processing failed',
        });
      }
    });
  };
}
