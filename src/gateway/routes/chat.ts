/**
 * Chat Routes
 * OpenAI-compatible chat completion API
 */

import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../types.js';
import { stripMessageMarker } from '../../core/engine.js';
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
        tools?: unknown[];
        stream?: boolean;
        temperature?: number;
        max_tokens?: number;
      };

      try {
        if (body.stream) {
          reply.status(501).send({
            error: 'Not Implemented',
            message: 'Streaming chat completions are not supported yet',
          });
          return;
        }

        if (body.tools && body.tools.length > 0) {
          reply.status(400).send({
            error: 'Bad Request',
            message: 'Custom tools are not supported by the 02mini agent gateway; built-in MCP/cron/skill tools are used automatically',
          });
          return;
        }

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

        const transcript = body.messages
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n');

        // Process the full caller-provided transcript through the 02mini agent engine.
        context.recordActivity?.('gateway', 'chat-completions');
        const rawResponse = await context.engine.processUserInput(`[Gateway ChatCompletions Source]\n${transcript}`);
        // Strip message marker if present (prevents [MSG_ALREADY_SHOWN] from being sent)
        const response = stripMessageMarker(rawResponse);

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
            prompt_tokens: body.messages.reduce((sum, m) => sum + m.content.length, 0) / 4, // Rough estimate
            completion_tokens: response.length / 4,
            total_tokens: (body.messages.reduce((sum, m) => sum + m.content.length, 0) + response.length) / 4,
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
        const session = context.sessions.get(sessionId) || {
          id: sessionId,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          messageCount: 0,
          messages: [],
        };
        session.lastActivity = Date.now();
        session.messageCount++;
        session.messages.push({ role: 'user', content: body.message, timestamp: Date.now() });
        context.sessions.set(sessionId, session);
        context.recordActivity?.('gateway', sessionId);

        // Process through engine
        const rawResponse = await context.engine.processUserInput(`[Gateway Send Source session=${sessionId}]\n${body.message}`);
        // Strip message marker if present
        const response = stripMessageMarker(rawResponse);
        session.messages.push({ role: 'assistant', content: response, timestamp: Date.now() });

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
