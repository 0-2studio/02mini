/**
 * Gateway Server
 * WebSocket and HTTP server for handling messages and events
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import express, { Request, Response, NextFunction } from "express";
import type { MiniConfig, Message } from "../config/types.js";
import { SessionManager } from "../utils/session.js";
import { generateId } from "../utils/id.js";
import { createAiProvider } from "../ai/factory.js";
import { ChannelManager } from "../channels/manager.js";

interface AuthenticatedRequest extends Request {
  auth?: {
    type: string;
    valid: boolean;
  };
}

export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export class GatewayServer implements Gateway {
  private config: MiniConfig;
  private sessionManager: SessionManager;
  private aiProvider: ReturnType<typeof createAiProvider>;
  private channelManager: ChannelManager;
  
  private httpServer?: http.Server;
  private wsServer?: WebSocketServer;
  private app: express.Application;
  
  private running = false;
  private clients = new Set<WebSocket>();
  private heartbeatInterval?: NodeJS.Timeout;
  private startTime: number = Date.now();

  constructor(config: MiniConfig) {
    this.config = config;
    this.sessionManager = new SessionManager(config.session || {});
    this.aiProvider = createAiProvider(config.ai);
    this.channelManager = new ChannelManager(config);
    
    // Setup channel message handler
    this.channelManager.onMessage((message) => this.handleChannelMessage(message));
    
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));
    this.app.use(this.authMiddleware.bind(this));
    this.app.use(this.corsMiddleware.bind(this));
    this.app.use(this.requestLogger.bind(this));
  }

  private authMiddleware(
    req: AuthenticatedRequest, 
    res: Response, 
    next: NextFunction
  ): void {
    const auth = this.config.gateway.auth;
    
    if (auth.type === "none") {
      req.auth = { type: "none", valid: true };
      next();
      return;
    }
    
    if (auth.type === "token") {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (token === auth.token) {
        req.auth = { type: "token", valid: true };
        next();
        return;
      }
    }
    
    if (auth.type === "password") {
      const password = req.headers["x-password"] as string;
      if (password === auth.password) {
        req.auth = { type: "password", valid: true };
        next();
        return;
      }
    }
    
    res.status(401).json({ error: "Unauthorized" });
  }

  private corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Password");
    
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }
    
    next();
  }

  private requestLogger(req: Request, _res: Response, next: NextFunction): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({
        status: "ok",
        version: "1.0.0",
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        sessions: this.sessionManager.getStats(),
        channels: this.channelManager.getStats(),
      });
    });

    // Status endpoint
    this.app.get("/api/status", (_req: Request, res: Response) => {
      res.json({
        status: "running",
        version: "1.0.0",
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        gateway: {
          port: this.config.gateway.port,
          host: this.config.gateway.host,
          auth: this.config.gateway.auth.type,
        },
        ai: {
          type: this.config.ai.type,
          model: this.config.ai.model,
        },
        sessions: this.sessionManager.getStats(),
        channels: this.channelManager.getStats(),
      });
    });

    // Chat endpoint
    this.app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
      try {
        const { messages, sessionId, stream } = req.body;
        
        console.log("[gateway] Chat request received:", { sessionId, stream, messageCount: messages?.length });
        
        if (!messages || !Array.isArray(messages)) {
          console.error("[gateway] Invalid request:", req.body);
          res.status(400).json({ 
            error: "Missing or invalid messages", 
            expected: "Array of {role, content}",
            received: typeof messages 
          });
          return;
        }

        const sid = sessionId || "default";
        const conversationId = `web:${sid}`;

        // Add user message to session
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === "user") {
          this.sessionManager.addMessage(conversationId, {
            id: generateId(),
            role: "user",
            content: lastMessage.content,
            timestamp: Date.now(),
          });
        }

        // Get conversation history
        const history = this.sessionManager.getMessages(conversationId);
        console.log("[gateway] Sending to AI:", { provider: this.config.ai.type, model: this.config.ai.model, historyLength: history.length });

        if (stream) {
          // Stream response
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          let fullContent = "";
          let chunkCount = 0;
          
          try {
            await this.aiProvider.chatStream(
              history,
              (chunk) => {
                chunkCount++;
                fullContent += chunk;
                const data = JSON.stringify({ content: chunk });
                res.write(`data: ${data}\n\n`);
                // Flush to ensure data is sent immediately
                if ("flush" in res && typeof res.flush === "function") {
                  res.flush();
                }
              }
            );
            console.log("[gateway] Stream completed:", { chunks: chunkCount, totalLength: fullContent.length });
          } catch (streamError) {
            console.error("[gateway] Stream error:", streamError);
            const errorData = JSON.stringify({ error: streamError instanceof Error ? streamError.message : "Stream error" });
            res.write(`data: ${errorData}\n\n`);
          }

          // Save assistant message
          if (fullContent) {
            this.sessionManager.addMessage(conversationId, {
              id: generateId(),
              role: "assistant",
              content: fullContent,
              timestamp: Date.now(),
            });
          }

          res.write(`data: [DONE]\n\n`);
          res.end();
        } else {
          // Non-stream response
          const response = await this.aiProvider.chat(history);
          console.log("[gateway] AI response:", { contentLength: response.content?.length, hasUsage: !!response.usage });

          // Save assistant message
          this.sessionManager.addMessage(conversationId, {
            id: generateId(),
            role: "assistant",
            content: response.content,
            timestamp: Date.now(),
          });

          res.json({
            content: response.content,
            usage: response.usage,
          });
        }
      } catch (error) {
        console.error("[gateway] Chat error:", error);
        res.status(500).json({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Conversations endpoints
    this.app.get("/api/conversations", (_req: Request, res: Response) => {
      const conversations = this.sessionManager.listConversations().map((id) => ({
        id,
        messageCount: this.sessionManager.getMessages(id).length,
      }));
      
      res.json({ conversations });
    });

    this.app.get("/api/conversations/:id", (req: Request, res: Response): void => {
      const { id } = req.params;
      const messages = this.sessionManager.getMessages(id);
      
      if (!messages || messages.length === 0) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      
      res.json({ id, messages });
    });

    this.app.delete("/api/conversations/:id", (req: Request, res: Response): void => {
      const { id } = req.params;
      const success = this.sessionManager.clearConversation(id);
      
      if (!success) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      
      res.json({ success: true });
    });

    // OpenAI-compatible endpoint
    this.app.post("/v1/chat/completions", async (req: Request, res: Response): Promise<void> => {
      try {
        const { messages, stream = false } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
          res.status(400).json({ error: "Missing or invalid messages" });
          return;
        }

        const formattedMessages: Message[] = messages.map((m: { role: string; content: string }) => ({
          id: generateId(),
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          timestamp: Date.now(),
        }));

        if (stream) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          let fullContent = "";
          const id = generateId();
          
          await this.aiProvider.chatStream(
            formattedMessages,
            (chunk) => {
              fullContent += chunk;
              res.write(`data: ${JSON.stringify({
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: this.config.ai.model,
                choices: [{ delta: { content: chunk } }],
              })}

`);
            }
          );

          res.write(`data: [DONE]

`);
          res.end();
        } else {
          const aiResponse = await this.aiProvider.chat(formattedMessages);
          
          res.json({
            id: generateId(),
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: this.config.ai.model,
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: aiResponse.content,
              },
              finish_reason: "stop",
            }],
            usage: aiResponse.usage,
          });
        }
      } catch (error) {
        console.error("[gateway] Completions error:", error);
        res.status(500).json({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Models endpoint (OpenAI compatible)
    this.app.get("/v1/models", (_req: Request, res: Response) => {
      res.json({
        object: "list",
        data: [
          {
            id: this.config.ai.model,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: this.config.ai.type,
          },
        ],
      });
    });

    // Static files (Web UI)
    this.app.use(express.static("web"));
    
    // Default route - serve index.html
    this.app.get("/", (_req: Request, res: Response) => {
      res.sendFile("index.html", { root: "web" });
    });

    // Error handling
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error("[gateway] Error:", err);
      res.status(500).json({ error: err.message });
    });
  }

  private setupWebSocket(): void {
    this.wsServer = new WebSocketServer({ noServer: true });

    this.wsServer.on("connection", (ws: WebSocket) => {
      console.log("[gateway] WebSocket client connected");
      this.clients.add(ws);

      // Send welcome message
      ws.send(JSON.stringify({
        type: "connected",
        timestamp: Date.now(),
      }));

      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === "chat") {
            const { content, sessionId = "default" } = message;
            const conversationId = `ws:${sessionId}`;

            // Add user message
            this.sessionManager.addMessage(conversationId, {
              id: generateId(),
              role: "user",
              content,
              timestamp: Date.now(),
            });

            // Get history
            const history = this.sessionManager.getMessages(conversationId);

            // Stream response
            let fullContent = "";
            
            await this.aiProvider.chatStream(history, (chunk) => {
              fullContent += chunk;
              ws.send(JSON.stringify({
                type: "chunk",
                content: chunk,
              }));
            });

            // Save assistant message
            this.sessionManager.addMessage(conversationId, {
              id: generateId(),
              role: "assistant",
              content: fullContent,
              timestamp: Date.now(),
            });

            // Send done
            ws.send(JSON.stringify({
              type: "done",
            }));
          }
        } catch (error) {
          console.error("[gateway] WebSocket error:", error);
          ws.send(JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          }));
        }
      });

      ws.on("close", () => {
        console.log("[gateway] WebSocket client disconnected");
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("[gateway] WebSocket error:", error);
        this.clients.delete(ws);
      });
    });
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Gateway is already running");
    }

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(this.app);

      // Handle WebSocket upgrade
      this.httpServer.on("upgrade", (request, socket, head) => {
        this.wsServer?.handleUpgrade(request, socket, head, (ws) => {
          this.wsServer?.emit("connection", ws, request);
        });
      });

      const port = this.config.gateway.port;
      const host = this.config.gateway.host || "127.0.0.1";

      this.httpServer.listen(port, host, async () => {
        this.running = true;
        console.log(`[gateway] Server listening on http://${host}:${port}`);
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Start channels
        try {
          await this.channelManager.startAll();
        } catch (error) {
          console.error("[gateway] Failed to start some channels:", error);
        }
        
        resolve();
      });

      this.httpServer.on("error", (error) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log("[gateway] Shutting down...");

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Stop channels
    await this.channelManager.stopAll();

    // Close all WebSocket connections
    this.clients.forEach((ws) => {
      ws.close();
    });
    this.clients.clear();

    // Close WebSocket server
    this.wsServer?.close();

    // Close HTTP server with timeout
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log("[gateway] Force closing connections...");
        // Force close all sockets
        this.httpServer?.emit("close");
        resolve();
      }, 2000);

      this.httpServer?.close(() => {
        clearTimeout(timeout);
        this.running = false;
        console.log("[gateway] Server stopped");
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  private async handleChannelMessage(message: import("../channels/types.js").ChannelMessage): Promise<void> {
    console.log(`[gateway] Received message from ${message.channelType}: ${message.senderName || message.senderId}`);
    
    const conversationId = `${message.channelType}:${message.chatId}`;
    
    // Add user message to session
    this.sessionManager.addMessage(conversationId, {
      id: message.id,
      role: "user",
      content: message.content,
      timestamp: message.timestamp,
      metadata: message.metadata,
    });

    try {
      // Get AI response
      const history = this.sessionManager.getMessages(conversationId);
      const response = await this.aiProvider.chat(history);

      // Save assistant message
      this.sessionManager.addMessage(conversationId, {
        id: generateId(),
        role: "assistant",
        content: response.content,
        timestamp: Date.now(),
      });

      // Send response back to channel
      const channel = this.channelManager.getChannel(message.channelType);
      if (channel) {
        await channel.sendMessage(message.chatId, response.content, {
          replyTo: message.id,
        });
      }
    } catch (error) {
      console.error("[gateway] Error handling channel message:", error);
    }
  }

  private startHeartbeat(): void {
    const interval = this.config.gateway.heartbeatInterval || 30000;
    
    this.heartbeatInterval = setInterval(() => {
      const heartbeat = {
        type: "heartbeat",
        timestamp: Date.now(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
      };

      this.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(heartbeat));
        }
      });
    }, interval);
  }
}