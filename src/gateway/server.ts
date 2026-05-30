/**
 * Gateway Server
 * HTTP API and WebSocket gateway for 02mini
 */

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { CoreEngine } from '../core/engine.js';
import { stripMessageMarker } from '../core/engine.js';
import type { CronScheduler } from '../cron/index.js';
import type {
  GatewayConfig,
  GatewayContext,
  ProactiveMessage,
  WebSocketMessage,
} from './types.js';
import { createChatRoutes } from './routes/chat.js';
import { createStatusRoutes } from './routes/status.js';
import { createSessionRoutes } from './routes/session.js';

export type { GatewayConfig } from './types.js';

export class GatewayServer {
  private app: ReturnType<typeof Fastify>;
  private config: GatewayConfig;
  private context: GatewayContext;
  private clients: Set<WebSocket> = new Set();
  private started: boolean = false;
  private readonly allowedOrigins: string[];

  constructor(
    config: Partial<GatewayConfig>,
    engine: CoreEngine,
    cronScheduler: CronScheduler
  ) {
    this.config = {
      port: config.port ?? 3000,
      host: config.host || '127.0.0.1',
      authToken: config.authToken,
      enableCORS: config.enableCORS ?? true,
      maxRequestSize: config.maxRequestSize || 10,
    };
    this.allowedOrigins = (process.env.GATEWAY_CORS_ORIGINS || 'http://localhost,http://127.0.0.1')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);

    this.context = {
      engine,
      cronScheduler,
      config: this.config,
      sessions: new Map(),
      broadcast: (message: ProactiveMessage) => this.broadcast(message),
    };

    // Initialize Fastify
    this.app = Fastify({
      logger: false,
      bodyLimit: this.config.maxRequestSize * 1024 * 1024,
    });
  }

  /**
   * Start the gateway server
   */
  async start(): Promise<void> {
    if (this.started) {
      console.log('[Gateway] Already started');
      return;
    }

    // Register plugins
    await this.registerPlugins();

    // Register routes
    await this.registerRoutes();

    // Start listening
    try {
      await this.app.listen({
        port: this.config.port,
        host: this.config.host,
      });

      this.started = true;
      console.log(`[Gateway] Server running on http://${this.config.host}:${this.config.port}`);
      console.log(`[Gateway] WebSocket endpoint: ws://${this.config.host}:${this.config.port}/ws`);
    } catch (error) {
      console.error('[Gateway] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the gateway server
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // Close all WebSocket connections
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();

    // Close server
    await this.app.close();
    this.started = false;
    console.log('[Gateway] Server stopped');
  }

  /**
   * Register Fastify plugins
   */
  private async registerPlugins(): Promise<void> {
    // CORS
    if (this.config.enableCORS) {
      await this.app.register(cors, {
        origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) {
            cb(null, true);
            return;
          }
          const allowed = this.isAllowedOrigin(origin);
          cb(allowed ? null : new Error('CORS origin denied'), allowed);
        },
        credentials: true,
      });
    }

    // WebSocket
    await this.app.register(websocket);

    // Authentication hook
    if (this.config.authToken) {
      this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!this.isAuthorized(request)) {
          reply.status(401).send({ error: 'Unauthorized' });
        }
      });
    }
  }

  /**
   * Register all routes
   */
  private async registerRoutes(): Promise<void> {
    // Health check
    this.app.get('/health', async () => ({
      status: 'ok',
      timestamp: Date.now(),
    }));

    // API routes
    await this.app.register(createChatRoutes(this.context), { prefix: '/v1' });
    await this.app.register(createStatusRoutes(this.context), { prefix: '/api' });
    await this.app.register(createSessionRoutes(this.context), { prefix: '/api' });

    // WebSocket endpoint
    this.app.get('/ws', { websocket: true }, (socket: any, req: FastifyRequest) => {
      if (this.config.authToken && !this.isAuthorized(req)) {
        socket.close(1008, 'Unauthorized');
        return;
      }

      console.log('[Gateway] WebSocket client connected');
      this.clients.add(socket);

      // Send welcome message
      this.sendToSocket(socket, {
        type: 'response',
        content: 'Connected to 02mini Gateway',
        sessionId: 'ws',
      });

      // Handle messages
      socket.on('message', async (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString()) as WebSocketMessage;
          await this.handleWebSocketMessage(socket, data);
        } catch (error) {
          this.sendToSocket(socket, {
            type: 'error',
            message: 'Invalid message format',
          });
        }
      });

      // Handle close
      socket.on('close', () => {
        console.log('[Gateway] WebSocket client disconnected');
        this.clients.delete(socket);
      });

      // Handle errors
      socket.on('error', (error: Error) => {
        console.error('[Gateway] WebSocket error:', error);
        this.clients.delete(socket);
      });
    });

    // 404 handler
    this.app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      reply.status(404).send({
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`,
        available: [
          'GET /health',
          'POST /v1/chat/completions',
          'POST /api/send',
          'GET /api/status',
          'GET /api/sessions',
          'WS /ws',
        ],
      });
    });
  }

  private isAuthorized(request: FastifyRequest): boolean {
    if (!this.config.authToken) return true;

    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    const url = new URL(request.url, 'http://localhost');
    const queryToken = url.searchParams.get('token') || undefined;
    return bearerToken === this.config.authToken || queryToken === this.config.authToken;
  }

  private isAllowedOrigin(origin: string): boolean {
    let requestOrigin: string;
    try {
      requestOrigin = new URL(origin).origin;
    } catch {
      return false;
    }

    return this.allowedOrigins.some((allowedOrigin) => {
      try {
        return new URL(allowedOrigin).origin === requestOrigin;
      } catch {
        return false;
      }
    });
  }

  /**
   * Handle WebSocket messages
   */
  private async handleWebSocketMessage(
    socket: WebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    switch (message.type) {
      case 'ping':
        this.sendToSocket(socket, { type: 'pong' });
        break;

      case 'message':
        // Process message through engine
        try {
          this.context.recordActivity?.('gateway', message.sessionId || 'ws');
          const rawResponse = await this.context.engine.processUserInput(
            `[Gateway WebSocket Source session=${message.sessionId || 'default'}]\n${message.content}`
          );
          // Strip message marker if present (prevents [MSG_ALREADY_SHOWN] from being sent)
          const response = stripMessageMarker(rawResponse);
          this.sendToSocket(socket, {
            type: 'response',
            content: response,
            sessionId: message.sessionId,
          });
        } catch (error) {
          this.sendToSocket(socket, {
            type: 'error',
            message: error instanceof Error ? error.message : 'Processing failed',
          });
        }
        break;

      default:
        this.sendToSocket(socket, {
          type: 'error',
          message: `Unknown message type: ${(message as any).type}`,
        });
    }
  }

  /**
   * Send message to a specific socket
   */
  private sendToSocket(socket: WebSocket, message: WebSocketMessage): void {
    try {
      if (socket.readyState === 1) { // OPEN
        socket.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('[Gateway] Failed to send message:', error);
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: ProactiveMessage): void {
    const messageStr = JSON.stringify(message);
    for (const client of this.clients) {
      try {
        if (client.readyState === 1) { // OPEN
          client.send(messageStr);
        }
      } catch {
        // Ignore send errors
      }
    }
  }

  /**
   * Get context for external use (e.g., autonomous runner)
   */
  getContext(): GatewayContext {
    return this.context;
  }

  setActivityRecorder(recorder: (channel: 'gateway', session?: string) => void): void {
    this.context.recordActivity = recorder;
  }
}
