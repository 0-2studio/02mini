/**
 * QQ Adapter - OneBot 11 Protocol (Simplified)
 * Simple message queue and processing loop
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import type { CoreEngine } from '../core/engine.js';
import { stripMessageMarker } from '../core/engine.js';
import type { QQConfigManager } from './config.js';
import type {
  OneBotMessageEvent,
  OneBotMetaEvent,
  OneBotEvent,
  MessageSegment,
  QQContext,
  QQSession,
} from './types.js';

export interface QQAdapterOptions {
  workingDir: string;
  engine: CoreEngine;
  configManager: QQConfigManager;
}

// Simple message queue item
interface QueueItem {
  event: OneBotMessageEvent;
  ws?: WebSocket;
  timestamp: number;
}

// Session message group
interface SessionMessages {
  sessionId: string;
  type: 'private' | 'group';
  userId: number;
  groupId?: number;
  groupName?: string;
  messages: Array<{
    id: number;
    senderName: string;
    senderId: number;
    content: string;
    timestamp: number;
  }>;
}

export class QQAdapter extends EventEmitter {
  private engine: CoreEngine;
  private configManager: QQConfigManager;
  private workingDir: string;

  private wsServer?: WebSocket.Server;
  private wsClient?: WebSocket;
  private sessions: Map<string, QQSession> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private selfId?: number;
  private groupNameCache: Map<number, string> = new Map();

  // Simple queue - just an array
  private messageQueue: QueueItem[] = [];
  private isProcessing: boolean = false;

  // Track if AI is in the middle of a conversation
  private activeSessions: Set<string> = new Set();

  constructor(options: QQAdapterOptions) {
    super();
    this.engine = options.engine;
    this.configManager = options.configManager;
    this.workingDir = options.workingDir;
  }

  /**
   * Start the QQ adapter
   */
  async start(): Promise<void> {
    const config = this.configManager.getConfig();

    // Log configuration
    console.log('[QQ] Configuration:');
    console.log(`  - Enabled: ${config.enabled}`);
    console.log(`  - Mode: ${config.mode}`);
    console.log(`  - URL: ${config.napcatWsUrl || 'ws://127.0.0.1:3001'}`);
    console.log(`  - Port: ${config.port || 3002}`);
    console.log(`  - Has Token: ${config.accessToken ? 'Yes' : 'No'}`);

    if (!config.enabled) {
      console.log('[QQ] Adapter is disabled');
      return;
    }

    if (this.isRunning) {
      console.log('[QQ] Adapter already running');
      return;
    }

    try {
      if (config.mode === 'websocket-server') {
        await this.startWebSocketServer();
      } else {
        await this.startWebSocketClient();
      }

      this.isRunning = true;
      console.log('[QQ] Adapter started successfully');

      // Start the processing loop
      this.processLoop();
    } catch (error) {
      console.error('[QQ] Failed to start adapter:', error);
      console.log('[QQ] Please check:');
      console.log('  1. NapCat is running on the configured port');
      console.log('  2. The URL and token are correct');
      console.log('  3. No firewall is blocking the connection');
    }
  }

  /**
   * Stop the QQ adapter
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    this.stopHeartbeat();

    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = undefined;
    }

    if (this.wsClient) {
      try {
        this.wsClient.close();
      } catch (error) {
        // Ignore close errors
      }
      this.wsClient = undefined;
    }

    console.log('[QQ] Adapter stopped');
  }

  /**
   * Pause message processing
   */
  pause(): void {
    this.isPaused = true;
    console.log('[QQ] Message processing paused');
  }

  /**
   * Resume message processing
   */
  resume(): void {
    this.isPaused = false;
    console.log('[QQ] Message processing resumed');
  }

  /**
   * Check if paused
   */
  isProcessingPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Clear all pending messages
   */
  clearMessageQueue(): number {
    const count = this.messageQueue.length;
    this.messageQueue = [];
    return count;
  }

  /**
   * Get total queued messages
   */
  getTotalQueuedMessages(): number {
    return this.messageQueue.length;
  }

  // ==================== WebSocket Connection ====================

  private async startWebSocketServer(): Promise<void> {
    const config = this.configManager.getConfig();
    const port = config.port || 3002;

    return new Promise((resolve) => {
      this.wsServer = new WebSocket.Server({ port, host: config.host || '0.0.0.0' });

      this.wsServer.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress || 'unknown';
        console.log(`[QQ] NapCat connected from ${clientIp}`);
        this.wsClient = ws;
        this.setupWebSocketHandlers(ws);
      });

      this.wsServer.on('listening', () => {
        console.log(`[QQ] WebSocket server listening on port ${port}`);
        resolve();
      });

      this.wsServer.on('error', (error) => {
        console.error('[QQ] Server error:', error);
      });
    });
  }

  private async startWebSocketClient(): Promise<void> {
    const config = this.configManager.getConfig();
    const wsUrl = config.napcatWsUrl || 'ws://127.0.0.1:3001';
    const token = config.accessToken;

    console.log(`[QQ] Connecting to NapCat at ${wsUrl}`);
    if (token) {
      console.log('[QQ] Using authentication token');
    }

    return new Promise((resolve, reject) => {
      try {
        // Create WebSocket with auth headers if token is provided
        const wsOptions: any = {};
        if (token) {
          wsOptions.headers = {
            'Authorization': `Bearer ${token}`
          };
        }

        const ws = new WebSocket(wsUrl, wsOptions);

        ws.on('open', () => {
          console.log('[QQ] WebSocket connection established');
          this.wsClient = ws;
          this.setupWebSocketHandlers(ws);
          resolve();
        });

        ws.on('error', (error) => {
          console.error('[QQ] WebSocket error:', error);
          reject(error);
        });

        // Timeout if connection takes too long
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            console.error('[QQ] Connection timeout - check if NapCat is running on the configured port');
            ws.terminate();
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        console.error('[QQ] Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  private setupWebSocketHandlers(ws: WebSocket): void {
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as OneBotEvent;
        this.handleEvent(event, ws);
      } catch (error) {
        console.error('[QQ] Failed to parse message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[QQ] Connection closed. Code: ${code}, Reason: ${reason || 'none'}`);
      this.wsClient = undefined;
      this.stopHeartbeat();
    });

    ws.on('error', (error) => {
      console.error('[QQ] WebSocket error:', error);
    });

    ws.on('ping', () => {
      ws.pong();
    });

    // Start heartbeat
    this.startHeartbeat(ws);
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: 'get_version' }));
        } catch (error) {
          console.error('[QQ] Heartbeat failed:', error);
        }
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  // ==================== Event Handling ====================

  private handleEvent(event: OneBotEvent, ws: WebSocket): void {
    // Handle meta events
    if (event.post_type === 'meta_event') {
      const metaEvent = event as OneBotMetaEvent;
      if (metaEvent.meta_event_type === 'lifecycle') {
        console.log('[QQ] Lifecycle event received');
        this.selfId = metaEvent.self_id;
      }
      return;
    }

    // Handle message events
    if (event.post_type === 'message') {
      const msgEvent = event as OneBotMessageEvent;
      this.handleMessageEvent(msgEvent, ws);
    }
  }

  private handleMessageEvent(event: OneBotMessageEvent, ws: WebSocket): void {
    // Check permissions
    if (!this.checkPermissions(event)) {
      return;
    }

    // Skip messages from self
    if (event.user_id === this.selfId) {
      return;
    }

    // Skip heartbeat/system messages
    const text = this.extractTextMessage(event.message);
    if (text === 'HEARTBEAT_OK' || text?.includes('[System Message]')) {
      return;
    }

    // Add to queue
    this.messageQueue.push({
      event,
      ws,
      timestamp: Date.now(),
    });

    console.log(`[QQ] Queued message from ${event.user_id}: ${text?.slice(0, 30) || '(empty)'}`);
  }

  // ==================== Simple Processing Loop ====================

  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      // Wait 5 seconds between iterations
      await this.sleep(5000);

      // Skip if paused
      if (this.isPaused) {
        continue;
      }

      // Skip if already processing
      if (this.isProcessing) {
        continue;
      }

      // Skip if queue is empty
      if (this.messageQueue.length === 0) {
        continue;
      }

      // Process next batch
      await this.processNextBatch();
    }
  }

  private async processNextBatch(): Promise<void> {
    // Double-check queue is not empty
    if (this.messageQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    console.log(`[QQ] Processing batch with ${this.messageQueue.length} message(s)`);

    try {
      // Group messages by session
      const sessionGroups = this.groupMessagesBySession(this.messageQueue);

      // Clear processed messages from queue
      this.messageQueue = [];

      // Process each session
      for (const session of sessionGroups) {
        console.log(`[QQ] Processing session ${session.sessionId} with ${session.messages.length} message(s)`);
        await this.processSession(session);
      }

      console.log('[QQ] Batch processing complete');
    } catch (error) {
      console.error('[QQ] Error processing batch:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private groupMessagesBySession(queue: QueueItem[]): SessionMessages[] {
    const groups = new Map<string, SessionMessages>();

    for (const item of queue) {
      const event = item.event;
      const sessionId = this.getSessionId(event);
      const text = this.extractTextMessage(event.message) || '';

      if (!groups.has(sessionId)) {
        groups.set(sessionId, {
          sessionId,
          type: event.message_type,
          userId: event.user_id,
          groupId: event.group_id,
          messages: [],
        });
      }

      const group = groups.get(sessionId)!;
      group.messages.push({
        id: event.message_id,
        senderName: event.sender.nickname || event.sender.card || 'Unknown',
        senderId: event.user_id,
        content: text,
        timestamp: event.time * 1000,
      });
    }

    return Array.from(groups.values());
  }

  private async processSession(session: SessionMessages): Promise<void> {
    // Build context
    const context = await this.buildSessionContext(session);

    // Build initial prompt with messages
    let conversationHistory = this.buildPrompt(session, context);

    // Process with AI in a loop
    let shouldContinue = true;

    while (shouldContinue) {
      // Send to AI
      const response = await this.engine.processUserInput(conversationHistory);

      // Check if AI wants to stop
      const trimmed = response.trim();
      if (trimmed === 'NO' || trimmed === '') {
        console.log('[QQ] AI decided to stop (NO)');
        shouldContinue = false;
        break;
      }

      // Check for end marker
      if (response.includes('[CONVERSATION_END]')) {
        console.log('[QQ] AI decided to stop (CONVERSATION_END)');
        shouldContinue = false;
        break;
      }

      // If we get here, AI wants to continue - add its response to history
      // The engine should have already processed any tool calls
      // We add a marker to indicate the conversation continues
      conversationHistory += `\n\n[Your last response has been processed. If you need to send another message, use the qq tool. If you're done, reply "NO".]`;

      // Small delay to prevent rapid looping
      await this.sleep(100);
    }
  }

  private async buildSessionContext(session: SessionMessages): Promise<QQContext> {
    const firstMsg = session.messages[0];

    let groupName: string | undefined;
    if (session.type === 'group' && session.groupId) {
      groupName = await this.getGroupName(session.groupId);
    }

    return {
      platform: 'qq',
      messageType: session.type,
      userId: firstMsg.senderId,
      groupId: session.groupId,
      groupName,
      senderName: firstMsg.senderName,
      isAt: false,
      sessionId: session.sessionId,
    };
  }

  private buildPrompt(session: SessionMessages, context: QQContext): string {
    let prompt = `[QQ Messages - ${session.type === 'group' ? 'Group' : 'Private'} Chat]\n\n`;

    if (session.type === 'group' && session.groupId) {
      prompt += `Group: ${context.groupName || 'Unknown'}\n`;
      prompt += `Group ID: ${session.groupId}\n\n`;
    }

    prompt += `Messages:\n`;
    for (const msg of session.messages) {
      prompt += `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.senderName} (ID: ${msg.senderId}): ${msg.content}\n`;
    }

    prompt += `\n${this.getInstructionPrompt(session.type, context)}`;

    return prompt;
  }

  private getInstructionPrompt(messageType: 'private' | 'group', context: QQContext): string {
    return `
## Instructions

You are processing QQ messages. Use the qq tool to send replies.

### When to Reply
- Answer questions directed at you
- Respond to @mentions in groups
- Help when explicitly asked

### When NOT to Reply
- Casual chat between users
- Messages not involving you
- Just say "NO" to skip

### Tool Usage
- Use qq tool with action "send_private_message" or "send_group_message"
- Include correct user_id or group_id
- Keep replies short (1-2 sentences)

### Conversation Control
- After sending a message, decide if you need to continue
- If task is complete → reply "NO"
- If more to do → use qq tool again
- qq tool parameter "end": true means stop after this message
- qq tool parameter "end": false means continue

### Reply Format
qq tool parameters:
- action: "send_private_message" or "send_group_message"
- user_id: ${context.userId} (for private)
- group_id: ${context.groupId || 'N/A'} (for group)
- message: "your reply text"
- end: true/false (whether to stop after this reply)

Now process these messages and respond appropriately.`;
  }

  // ==================== Helper Methods ====================

  private getSessionId(event: OneBotMessageEvent): string {
    if (event.message_type === 'group' && event.group_id) {
      return `group_${event.group_id}`;
    }
    return `private_${event.user_id}`;
  }

  private getOrCreateSession(session: SessionMessages): any {
    if (!this.sessions.has(session.sessionId)) {
      this.sessions.set(session.sessionId, {
        id: session.sessionId,
        type: session.type,
        userId: session.userId,
        groupId: session.groupId,
        nickname: session.messages[0]?.senderName || 'Unknown',
        lastMessageTime: Date.now(),
        messageCount: 0,
      });
    }
    return this.sessions.get(session.sessionId)!;
  }

  private extractTextMessage(message: string | MessageSegment[]): string {
    if (typeof message === 'string') {
      return message;
    }

    const texts: string[] = [];
    for (const segment of message) {
      if (segment.type === 'text' && segment.data.text) {
        texts.push(segment.data.text);
      } else if (segment.type === 'at' && segment.data.qq) {
        texts.push(`[@${segment.data.qq}]`);
      } else if (segment.type === 'face') {
        texts.push(`[表情:${segment.data.id}]`);
      }
    }
    return texts.join('');
  }

  private async getGroupName(groupId: number): Promise<string> {
    if (this.groupNameCache.has(groupId)) {
      return this.groupNameCache.get(groupId)!;
    }
    return `Group ${groupId}`;
  }

  private checkPermissions(event: OneBotMessageEvent): boolean {
    // Check blocked first
    if (this.configManager.isUserAllowed(event.user_id) === false) {
      return false;
    }

    if (event.message_type === 'private') {
      // Check private chat permission
      return this.configManager.isUserAllowed(event.user_id);
    } else {
      // Check group permission
      if (event.group_id && !this.configManager.isGroupAllowed(event.group_id)) {
        return false;
      }

      // Check if @ is required
      const config = this.configManager.getConfig();
      if (config.atRequiredInGroup && event.group_id) {
        const text = this.extractTextMessage(event.message);
        // Check for @ mention of self
        const hasAtMe = text.includes(`[@${this.selfId}]`) ||
                       (typeof event.message !== 'string' &&
                        event.message.some(seg => seg.type === 'at' && seg.data.qq === String(this.selfId)));
        if (!hasAtMe) {
          return false;
        }
      }
      return true;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== Public API for QQ Tool ====================

  async sendMessage(params: {
    action: string;
    user_id?: number;
    group_id?: number;
    message: string;
  }): Promise<string> {
    if (!this.wsClient) {
      return '[Error: WebSocket not connected - no client]';
    }

    if (this.wsClient.readyState !== WebSocket.OPEN) {
      return `[Error: WebSocket not open - state: ${this.wsClient.readyState}]`;
    }

    try {
      const apiParams: any = {
        action: params.action === 'send_private_message' ? 'send_private_msg' : 'send_group_msg',
        params: {
          message: params.message,
        },
      };

      if (params.action === 'send_private_message' && params.user_id) {
        apiParams.params.user_id = params.user_id;
      } else if (params.action === 'send_group_message' && params.group_id) {
        apiParams.params.group_id = params.group_id;
      }

      const payload = JSON.stringify(apiParams);
      console.log(`[QQ] Sending ${params.action}:`, payload.slice(0, 200));

      this.wsClient.send(payload);
      console.log(`[QQ] Message sent successfully`);
      return '[Message sent successfully]';
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[QQ] Failed to send message:', errorMsg);
      return `[Error: ${errorMsg}]`;
    }
  }

  // ==================== File Cleanup (Stub) ====================

  scheduleFileCleanup(_hours: number): void {
    // Stub method for compatibility - file cleanup not implemented in simplified version
    console.log('[QQ] File cleanup scheduled (stub)');
  }
}