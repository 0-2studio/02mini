/**
 * Session Routes
 * Session management endpoints
 */

import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../types.js';
import { randomUUID } from 'crypto';

export function createSessionRoutes(context: GatewayContext) {
  return async function (app: FastifyInstance) {
    // GET /api/sessions
    app.get('/sessions', async () => {
      const sessions: Array<{
        id: string;
        createdAt: number;
        lastActivity: number;
        messageCount: number;
        historyMessages: number;
      }> = [];

      for (const [id, session] of context.sessions) {
        sessions.push({
          id,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
          messageCount: session.messageCount,
          historyMessages: session.messages.length,
        });
      }

      return { sessions };
    });

    // POST /api/sessions
    app.post('/sessions', async () => {
      const id = randomUUID();
      const session = {
        id,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        messages: [],
      };

      context.sessions.set(id, session);

      return {
        success: true,
        session: {
          id: session.id,
          createdAt: session.createdAt,
        },
      };
    });

    // GET /api/sessions/:id/history
    app.get('/sessions/:id/history', async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!context.sessions.has(id)) {
        reply.status(404).send({ error: 'Session not found' });
        return;
      }

      return {
        sessionId: id,
        messages: context.sessions.get(id)!.messages,
      };
    });

    // DELETE /api/sessions/:id
    app.delete('/sessions/:id', async (request, reply) => {
      const { id } = request.params as { id: string };

      const existed = context.sessions.has(id);
      context.sessions.delete(id);

      return {
        success: true,
        deleted: existed,
      };
    });

    // POST /api/reset
    app.post('/reset', async (request, reply) => {
      if (!context.config.authToken) {
        reply.status(401).send({ error: 'Reset requires GATEWAY_TOKEN to be configured' });
        return;
      }

      try {
        const result = await context.engine.resetAllData();
        return {
          success: result.success,
          message: result.message,
        };
      } catch (error) {
        reply.status(500).send({
          error: 'Reset failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };
}
