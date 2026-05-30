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
import { contentToText } from '../context/content.js';
import { Semaphore } from '../ai/semaphore.js';
import { globalApiLock } from '../ai/api-lock.js';
import type { QQConfigManager } from './config.js';
import type { ChatMessage } from '../ai/client.js';
import type {
  OneBotMessageEvent,
  OneBotMetaEvent,
  OneBotEvent,
  MessageSegment,
  QQContext,
  QQSession,
  QQFileInfo,
  QQMediaInfo,
  MultimodalContent,
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
  mediaFiles?: QQMediaInfo[];
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
    atList?: Array<{qq: string; name?: string}>; // List of @ mentions
    mediaFiles?: QQMediaInfo[]; // Associated media files (images only)
  }>;
}

export class QQAdapter extends EventEmitter {
  private engine: CoreEngine;
  private configManager: QQConfigManager;
  private workingDir: string;

  // Concurrency limiter for parallel session processing
  private sessionSemaphore: Semaphore;

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
  private readonly maxQueueSize: number;
  private isProcessing: boolean = false;

  // File upload directory
  private readonly fileUploadDir: string;
  private readonly fileExportDir: string;
  private readonly maxFileBytes: number;
  private readonly maxImageBytes: number;

  // Media download directory
  private readonly mediaDir: string;

  // Pending files waiting to be downloaded (file_id -> QQFileInfo)
  private pendingFiles: Map<string, QQFileInfo> = new Map();

  // Image storage for multimodal support (fileName -> {url, expireAt})
  // 5 minutes auto-cleanup
  private imageStorage: Map<string, { url: string; fileId: string; expireAt: number }> = new Map();
  private imageCleanupInterval?: NodeJS.Timeout;
  private fileCleanupInterval?: NodeJS.Timeout;

  // Reconnection state
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000; // Start with 5 seconds
  private readonly maxReconnectDelay: number = 60000; // Max 60 seconds
  private reconnectTimer?: NodeJS.Timeout;
  private isReconnecting: boolean = false;

  // QQ Context Compression
  private isCompressing: boolean = false;
  private qqSummaryMessage?: string; // Current QQ summary
  private readonly COMPRESSION_THRESHOLD = 0.5; // 50% token usage

  constructor(options: QQAdapterOptions) {
    super();
    this.engine = options.engine;
    this.configManager = options.configManager;
    this.workingDir = options.workingDir;
    this.fileUploadDir = path.join(this.workingDir, 'files', 'qq-uploads');
    this.fileExportDir = path.resolve(this.workingDir, 'files');
    this.mediaDir = path.join(this.workingDir, 'files', 'qq-media'); // Kept for compatibility but not used
    this.maxFileBytes = parseInt(process.env.QQ_MAX_FILE_BYTES || String(50 * 1024 * 1024), 10);
    this.maxImageBytes = parseInt(process.env.QQ_MAX_IMAGE_BYTES || String(10 * 1024 * 1024), 10);
    this.maxQueueSize = parseInt(process.env.QQ_MAX_QUEUE_SIZE || '200', 10);

    const maxParallel = parseInt(process.env.QQ_MAX_PARALLEL_SESSIONS || '3', 10);
    this.sessionSemaphore = new Semaphore(Number.isFinite(maxParallel) ? maxParallel : 3);

    this.ensureFileUploadDir();

  }

  /**
   * Start the image storage cleanup timer
   * Removes expired entries every minute
   */
  private startImageCleanupTimer(): void {
    this.imageCleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [fileName, data] of this.imageStorage.entries()) {
        if (data.expireAt <= now) {
          this.imageStorage.delete(fileName);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`[QQ] Cleaned up ${cleaned} expired image(s) from storage`);
      }
    }, 60000); // Run every minute
  }

  /**
   * Store image info for multimodal access
   * Auto-expires after 5 minutes
   */
  private storeImageInfo(fileName: string, url: string, fileId: string): void {
    const expireAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    this.imageStorage.set(fileName, { url, fileId, expireAt });
    console.log(`[QQ] Stored image info: ${fileName} (expires at ${new Date(expireAt).toLocaleTimeString()})`);
  }

  /**
   * Get stored image info by file name
   */
  private getStoredImageInfo(fileName: string): { url: string; fileId: string } | null {
    const data = this.imageStorage.get(fileName);
    if (!data) {
      return null;
    }
    if (data.expireAt <= Date.now()) {
      this.imageStorage.delete(fileName);
      return null;
    }
    return { url: data.url, fileId: data.fileId };
  }

  /**
   * Ensure file upload directory exists
   */
  private async ensureFileUploadDir(): Promise<void> {
    try {
      await fs.mkdir(this.fileUploadDir, { recursive: true });
    } catch (error) {
      console.error('[QQ] Failed to create file upload directory:', error);
    }
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
      this.startImageCleanupTimer();
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

    // Clear image cleanup timer
    if (this.imageCleanupInterval) {
      clearInterval(this.imageCleanupInterval);
      this.imageCleanupInterval = undefined;
    }

    if (this.fileCleanupInterval) {
      clearInterval(this.fileCleanupInterval);
      this.fileCleanupInterval = undefined;
    }

    // Clear image storage
    this.imageStorage.clear();

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
        if (config.accessToken) {
          const authHeader = req.headers?.authorization;
          const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length)
            : undefined;
          const queryToken = req.url ? new URL(req.url, 'ws://localhost').searchParams.get('token') || undefined : undefined;
          if (bearerToken !== config.accessToken && queryToken !== config.accessToken) {
            console.warn('[QQ] Rejected unauthenticated NapCat connection');
            ws.close(1008, 'Unauthorized');
            return;
          }
        }

        const clientIp = req.socket.remoteAddress || 'unknown';
        console.log(`[QQ] NapCat connected from ${clientIp}`);
        this.wsClient = ws;
        this.resetReconnectState();
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
          this.resetReconnectState();
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

      // Trigger reconnection if not manually stopped and not already reconnecting
      if (this.isRunning && !this.isReconnecting) {
        this.scheduleReconnect();
      }
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
    // Send ping frame instead of get_version API
    this.heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
          console.log('[QQ] Heartbeat ping sent');
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

  // ==================== Reconnection Logic ====================

  private resetReconnectState(): void {
    this.reconnectAttempts = 0;
    this.reconnectDelay = 5000;
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    console.log('[QQ] Reconnection state reset');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[QQ] Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(`[QQ] Reconnecting in ${this.reconnectDelay / 1000}s... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.performReconnect();
    }, this.reconnectDelay);

    // Exponential backoff with jitter
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 1.5 + Math.random() * 2000,
      this.maxReconnectDelay
    );
  }

  private async performReconnect(): Promise<void> {
    try {
      const config = this.configManager.getConfig();

      if (!config.enabled || !this.isRunning) {
        console.log('[QQ] Reconnection aborted - adapter disabled or stopped');
        this.isReconnecting = false;
        return;
      }

      console.log(`[QQ] Attempting to reconnect...`);

      if (config.mode === 'websocket-client') {
        await this.startWebSocketClient();
      } else {
        // For server mode, just wait for new connections
        console.log('[QQ] Server mode - waiting for NapCat to reconnect...');
      }

      // Reset reconnect delay on successful connection
      this.reconnectDelay = 5000;
      this.isReconnecting = false;
      console.log(`[QQ] Reconnection successful!`);
    } catch (error) {
      console.error('[QQ] Reconnection failed:', error);
      this.isReconnecting = false;

      // Schedule next attempt if still running
      if (this.isRunning) {
        this.scheduleReconnect();
      }
    }
  }

  // ==================== Event Handling ====================

  private async handleEvent(event: OneBotEvent, ws: WebSocket): Promise<void> {
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
      await this.handleMessageEvent(msgEvent, ws);
    }
  }

  private async handleMessageEvent(event: OneBotMessageEvent, ws: WebSocket): Promise<void> {
    if (event.self_id) {
      this.selfId = event.self_id;
    }

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

    // Detect files/images first (store pending info even if we decide not to reply)
    const fileInfo = await this.detectFileMessage(event);
    if (fileInfo) {
      console.log(`[QQ] File detected: ${fileInfo.fileName} (${fileInfo.fileSize} bytes) - use receive_file tool to download`);
      this.pendingFiles.set(fileInfo.fileId, fileInfo);
    }

    // Detect images for multimodal support
    const mediaList = this.detectMediaInfo(event);

    // Group chat load-shedding: if not @ me and not a direct question, don't enqueue
    if (event.message_type === 'group') {
      const atMe = this.isAtMe(event, text);
      const directQuestion = this.looksLikeDirectQuestion(text || '');
      if (!atMe && !directQuestion) {
        return;
      }
    }

    // Add to queue
    if (this.messageQueue.length >= this.maxQueueSize) {
      const dropped = this.messageQueue.shift();
      console.warn(`[QQ] Message queue full, dropped oldest message from ${dropped?.event.user_id || 'unknown'}`);
    }
    this.messageQueue.push({
      event,
      ws,
      timestamp: Date.now(),
      mediaFiles: mediaList,
    });
    this.emit('activity', {
      channel: 'qq',
      session: event.message_type === 'group'
        ? `group:${event.group_id}`
        : `private:${event.user_id}`,
      userId: event.user_id,
      groupId: event.group_id,
    });

    console.log(`[QQ] Queued message from ${event.user_id}: ${text?.slice(0, 30) || '(empty)'}`);
  }

  /**
   * Whether this message @mentioned me.
   */
  private isAtMe(event: OneBotMessageEvent, extractedText?: string): boolean {
    if (!this.selfId) return false;

    // Fast path: extracted text uses [@用户:qq]
    const text = extractedText ?? this.extractTextMessage(event.message);
    if (text && text.includes(`[@用户:${this.selfId}]`)) return true;

    // Segment path
    if (typeof event.message !== 'string') {
      return event.message.some(seg => seg.type === 'at' && String(seg.data?.qq) === String(this.selfId));
    }

    return false;
  }

  /**
   * Heuristic: treat as a direct question worth replying in group.
   * (Keeps load low; goal is faster replies when actually needed.)
   */
  private looksLikeDirectQuestion(text: string): boolean {
    const t = (text || '').trim();
    if (!t) return false;

    // Must look like a question
    const hasQ = t.includes('?') || t.includes('？');
    if (!hasQ) return false;

    // Require some addressing/intent keywords to avoid reacting to random “？” spam
    const keywords = ['02', '你', '怎么', '为啥', '为什么', '咋', '求', '帮', '能不能', '可以吗', '有没有'];
    return keywords.some(k => t.includes(k));
  }

  /**
   * Detect file messages in the event - just record info, don't download
   * Only handles real files (segment.type === 'file'), NOT images
   * Images are handled by detectMediaInfo for multimodal support
   */
  private async detectFileMessage(event: OneBotMessageEvent): Promise<QQFileInfo | null> {
    if (typeof event.message === 'string') {
      return null;
    }

    for (const segment of event.message) {
      if (segment.type === 'file' && segment.data) {
        const fileId = segment.data.file_id;

        // Debug: log all available fields
        console.log(`[QQ] File segment raw data keys:`, Object.keys(segment.data));
        console.log(`[QQ] File segment fields:`, Object.keys(segment.data));

        // Try multiple possible field names for filename according to OneBot 11 spec
        // NapCat/OneBot 可能使用不同的字段名
        const possibleFileNames = [
          segment.data.file_name,
          segment.data.name,
          segment.data.file,
          segment.data.file_name,
          segment.data.filename,
          segment.data.path?.split('/').pop(),
          segment.data.path?.split('\\').pop(),
        ].filter(Boolean);

        const fileName = possibleFileNames[0] || 'unnamed_file';
        console.log(`[QQ] File name candidates:`, possibleFileNames);
        console.log(`[QQ] Selected file name: ${fileName}`);

        const fileSize = segment.data.file_size
          || segment.data.size
          || 0;

        console.log(`[QQ] File detected - ID: ${fileId}, Name: ${fileName}, Size: ${fileSize}`);

        // Generate safe filename but preserve original name
        const dateDir = new Date().toISOString().split('T')[0];
        const targetDir = path.join(this.fileUploadDir, dateDir);
        await fs.mkdir(targetDir, { recursive: true });

        // Sanitize filename for filesystem
        const safeFileName = fileName !== 'unnamed_file' ? this.sanitizeFileName(fileName) : `unnamed_${Date.now()}`;
        const localPath = path.join(targetDir, safeFileName);

        const fileInfo: QQFileInfo = {
          fileId,
          fileName: safeFileName,
          fileSize,
          localPath,
          receivedAt: Date.now(),
          senderId: event.user_id,
          groupId: event.group_id,
          mimeType: this.getMimeType(safeFileName),
        };

        return fileInfo;
      }
      // Note: Images (segment.type === 'image') are handled by detectMediaInfo, not here
    }

    return null;
  }

  /**
   * Receive/download a file - called by AI via tool
   * Downloads file from QQ server via NapCat API
   */
  async receiveFile(fileId: string): Promise<QQFileInfo | null> {
    const fileInfo = this.pendingFiles.get(fileId);
    if (!fileInfo) {
      console.log(`[QQ] File not found in pending: ${fileId}`);
      return null;
    }

    console.log(`[QQ] Starting download for file: ${fileInfo.fileName}`);

    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      console.error('[QQ] WebSocket not connected, cannot download file');
      return null;
    }

    try {
      // Create directory
      const targetDir = path.dirname(fileInfo.localPath);
      await fs.mkdir(targetDir, { recursive: true });

      // Step 1: Get file URL from NapCat API
      const getFileUrlParams: any = {
        action: fileInfo.groupId ? 'get_group_file_url' : 'get_private_file_url',
        params: {
          file_id: String(fileId),
        },
      };

      if (fileInfo.groupId) {
        getFileUrlParams.params.group_id = String(fileInfo.groupId);
      }

      console.log(`[QQ] Requesting file URL from NapCat...`);

      // Send request and wait for response
      const fileUrl = await this.requestFileUrl(fileId, getFileUrlParams);

      if (!fileUrl) {
        console.error('[QQ] Failed to get file URL');
        return null;
      }

      console.log(`[QQ] Got file URL from NapCat`);

      // Step 2: Download file content using NapCat download_file API or direct HTTP
      let downloadSuccess = false;

      // Try using NapCat download_file API first
      try {
        const downloadParams = {
          action: 'download_file',
          params: {
            url: fileUrl,
            name: fileInfo.fileName,
            // headers 使用字符串格式，每个 header 一行
            headers: 'User-Agent: Mozilla/5.0',
          },
        };

        const downloadedPath = await this.requestDownloadFile(downloadParams);

        if (downloadedPath) {
          // Copy file to our target location
          const fileData = await fs.readFile(downloadedPath);
          await fs.writeFile(fileInfo.localPath, fileData);
          downloadSuccess = true;
          console.log(`[QQ] File downloaded via NapCat API: ${fileInfo.localPath}`);
        }
      } catch (downloadError) {
        console.log(`[QQ] NapCat download_file failed, trying direct HTTP: ${downloadError}`);
      }

      // Fallback: Direct HTTP download
      if (!downloadSuccess) {
        console.log(`[QQ] Downloading via HTTP...`);
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        this.assertResponseSizeAllowed(response, this.maxFileBytes, 'file');

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > this.maxFileBytes) {
          throw new Error(`File too large: ${buffer.byteLength} bytes exceeds ${this.maxFileBytes}`);
        }
        await fs.writeFile(fileInfo.localPath, Buffer.from(buffer));
        console.log(`[QQ] File downloaded via HTTP: ${fileInfo.localPath} (${buffer.byteLength} bytes)`);
      }

      // Remove from pending
      this.pendingFiles.delete(fileId);

      return fileInfo;
    } catch (error) {
      console.error('[QQ] Failed to download file:', error);
      return null;
    }
  }

  /**
   * Request file URL from NapCat API
   */
  private requestFileUrl(fileId: string, params: any): Promise<string | null> {
    return new Promise((resolve) => {
      const requestId = `file_url_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const messageHandler = (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          console.log(`[QQ] File URL response status: ${response.status || 'unknown'}`);

          if (response.echo === requestId && response.status === 'ok' && response.data) {
            // NapCat returns URL in data.url
            const url = response.data.url;
            if (url) {
              this.wsClient?.removeListener('message', messageHandler);
              resolve(url);
              return;
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      };

      params.echo = requestId;
      this.wsClient?.on('message', messageHandler);
      this.wsClient?.send(JSON.stringify(params));

      setTimeout(() => {
        this.wsClient?.removeListener('message', messageHandler);
        resolve(null);
      }, 15000);
    });
  }

  /**
   * Request NapCat to download file
   */
  private requestDownloadFile(params: any): Promise<string | null> {
    return new Promise((resolve) => {
      const requestId = `download_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const messageHandler = (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          console.log(`[QQ] Download file response:`, JSON.stringify(response).substring(0, 200));

          if (response.echo === requestId && response.status === 'ok' && response.data && response.data.file) {
            this.wsClient?.removeListener('message', messageHandler);
            resolve(response.data.file);
            return;
          }
        } catch (err) {
          // Ignore parse errors
        }
      };

      params.echo = requestId;
      this.wsClient?.on('message', messageHandler);
      this.wsClient?.send(JSON.stringify(params));

      setTimeout(() => {
        this.wsClient?.removeListener('message', messageHandler);
        resolve(null);
      }, 30000); // 30s timeout for large files
    });
  }

  /**
   * List pending files waiting to be received
   */
  getPendingFiles(): QQFileInfo[] {
    return Array.from(this.pendingFiles.values());
  }

  /**
   * Sanitize filename to prevent directory traversal
   * Preserves Chinese characters and other Unicode letters
   */
  private sanitizeFileName(fileName: string): string {
    // Remove path separators and null bytes
    // Allow: Unicode letters (including Chinese), numbers, dots, hyphens, underscores, spaces
    return fileName
      .replace(/[\\/:*?"<>|]/g, '_')  // Windows reserved chars
      .replace(/\x00/g, '')            // Null bytes
      .trim();
  }

  /**
   * Get MIME type from filename
   */
  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Sanitize fileId for use as filename in media storage
   * Handles URLs by extracting a safe identifier
   */
  private sanitizeFileNameForMedia(fileId: string): string {
    // If it's a URL, extract just the filename part or use a hash
    if (fileId.startsWith('http://') || fileId.startsWith('https://')) {
      try {
        const url = new URL(fileId);
        // Get the last part of the path, or use a short hash of the URL
        const pathParts = url.pathname.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart.length > 5) {
          // Use last 20 chars of the filename part, sanitized
          return lastPart.slice(-20).replace(/[^a-zA-Z0-9]/g, '_');
        }
        // Fallback: use hash of hostname + path
        return url.hostname.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now().toString(36);
      } catch {
        // If URL parsing fails, just use timestamp
        return 'media_' + Date.now().toString(36);
      }
    }
    
    // For regular fileIds, just take first 20 chars and sanitize
    return fileId.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
  }

  /**
   * Detect image MIME type from URL extension or file header
   */
  private detectImageMimeType(url: string, buffer?: Buffer): string {
    // Try to get from URL extension first
    const ext = path.extname(url).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    if (mimeTypes[ext]) return mimeTypes[ext];
    
    // Try to detect from file header (magic numbers)
    if (buffer) {
      if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
      if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
      if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
    }
    
    return 'image/jpeg'; // Default fallback
  }

  // ==================== Media Detection & Download ====================

  /**
   * Detect images in message - only stores info, does NOT download
   * AI must call get_image tool to actually view
   * Images are stored in imageStorage with 5-minute auto-expiry
   */
  private detectMediaInfo(event: OneBotMessageEvent): QQMediaInfo[] {
    const mediaList: QQMediaInfo[] = [];

    if (typeof event.message === 'string') {
      return mediaList;
    }

    for (const segment of event.message) {
      if (segment.type === 'image' && segment.data) {
        // Use file name as identifier (short and readable)
        const fileId = segment.data.file || segment.data.file_id || `img_${Date.now()}`;
        const fileName = segment.data.file_name || segment.data.name || segment.data.file || 'image.jpg';
        const url = segment.data.url;
        const fileSize = segment.data.file_size || segment.data.size || 0;

        // Store in image storage for 5-minute access (keyed by fileName for AI lookup)
        if (url) {
          this.storeImageInfo(fileName, url, fileId);
        }

        mediaList.push({
          type: 'image',
          fileId: fileName,  // Use fileName as the ID shown to AI
          fileName,
          fileSize,
          mimeType: 'image/jpeg',
          downloaded: false,
          url: url,
          senderId: event.user_id,
          groupId: event.group_id,
          receivedAt: Date.now(),
        });

        console.log(`[QQ] Image detected: fileName="${fileName}" (AI can use get_image action to view)`);
      }
    }

    return mediaList;
  }

  /**
   * Get image for AI - download and return as base64 for maximum compatibility
   * Some models don't support direct URLs, so we download and convert to base64
   */
  async getImageForAI(fileName: string, groupId?: number, userId?: number): Promise<MultimodalContent[] | null> {
    console.log(`[QQ] AI requesting image: fileName="${fileName}"`);

    try {
      // Look up image info from storage by file name
      const imageInfo = this.getStoredImageInfo(fileName);

      if (!imageInfo) {
        console.error(`[QQ] Image not found or expired: ${fileName}`);
        return null;
      }

      console.log(`[QQ] Found image URL: ${imageInfo.url.substring(0, 60)}...`);

      // Download the image and convert to base64 for maximum compatibility
      console.log('[QQ] Downloading image for base64 conversion...');
      const response = await fetch(imageInfo.url);
      if (!response.ok) {
        console.error(`[QQ] Failed to download image: ${response.status}`);
        return null;
      }

      this.assertResponseSizeAllowed(response, this.maxImageBytes, 'image');

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > this.maxImageBytes) {
        throw new Error(`Image too large: ${buffer.length} bytes exceeds ${this.maxImageBytes}`);
      }
      const base64 = buffer.toString('base64');

      // Determine mime type from file extension
      const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';

      console.log(`[QQ] Image converted to base64: ${base64.length} chars (${(buffer.length / 1024).toFixed(1)}KB)`);

      // Return OpenAI multimodal format with base64 data URL
      // This works with all models that support vision
      return [
        { type: 'text', text: 'Image from QQ:' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } }
      ];
    } catch (error) {
      console.error('[QQ] Failed to get image for AI:', error);
      return null;
    }
  }

  /**
   * Get image URL from NapCat API (fallback when not in storage)
   */
  private async getMediaUrl(fileId: string, type: 'image', groupId?: number, userId?: number): Promise<string | null> {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      console.error('[QQ] WebSocket not connected');
      return null;
    }

    return new Promise((resolve) => {
      const requestId = `media_req_${Date.now()}`;

      // Set up one-time listener for response
      const messageHandler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.echo === requestId && response.status === 'ok') {
            this.wsClient?.removeListener('message', messageHandler);
            const url = response.data?.url || response.data?.file;
            resolve(url || null);
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      const ws = this.wsClient;
      if (!ws) {
        resolve(null);
        return;
      }
      ws.on('message', messageHandler);

      // Build request params
      const params: any = { file_id: fileId };

      // For images in groups, may need group_id
      if (groupId) params.group_id = groupId;

      const request = {
        action: 'get_image',
        params,
        echo: requestId,
      };
      
      const isUrl = fileId.startsWith('http://') || fileId.startsWith('https://');
      console.log(`[QQ] Requesting ${type} with ${isUrl ? 'URL' : 'file_id'}: ${fileId.substring(0, 50)}...`);

      ws.send(JSON.stringify(request));

      // Timeout after 10 seconds
      setTimeout(() => {
        this.wsClient?.removeListener('message', messageHandler);
        resolve(null);
      }, 10000);
    });
  }

  // ==================== Simple Processing Loop ====================

  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      // Skip if paused
      if (this.isPaused) {
        await this.sleep(100);
        continue;
      }

      // Skip if already processing
      if (this.isProcessing) {
        await this.sleep(100);
        continue;
      }

      // Skip if queue is empty
      if (this.messageQueue.length === 0) {
        await this.sleep(100);
        continue;
      }

      // Optional: small delay to accumulate rapid-fire messages into one batch
      const cfg = this.configManager.getConfig();
      const delay = cfg.accumulationDelay ?? 0;
      if (delay > 0) {
        await this.sleep(delay);
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
      let sessionGroups = this.groupMessagesBySession(this.messageQueue);

      // Clear processed messages from queue
      this.messageQueue = [];

      // Prioritize: private > group @me > others
      sessionGroups = sessionGroups.sort((a, b) => {
        const aPri = this.getSessionPriority(a);
        const bPri = this.getSessionPriority(b);
        return bPri - aPri;
      });

      const cfg = this.configManager.getConfig();

      // Process each session
      if (cfg.parallelProcessing) {
        console.log(`[QQ] Parallel session preprocessing enabled (max=${process.env.QQ_MAX_PARALLEL_SESSIONS || '3'}); engine turns remain serialized`);
        await Promise.all(sessionGroups.map((session) =>
          this.sessionSemaphore.withPermit(async () => {
            console.log(`[QQ] Processing session ${session.sessionId} with ${session.messages.length} message(s)`);
            await this.processSession(session);
          })
        ));
      } else {
        for (const session of sessionGroups) {
          console.log(`[QQ] Processing session ${session.sessionId} with ${session.messages.length} message(s)`);
          await this.processSession(session);
        }
      }

      console.log('[QQ] Batch processing complete');
    } catch (error) {
      console.error('[QQ] Error processing batch:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private getSessionPriority(session: SessionMessages): number {
    // Higher = earlier
    if (session.type === 'private') return 100;

    // Group: if any message @me, boost
    if (this.selfId) {
      const atMarker = `[@用户:${this.selfId}]`;
      if (session.messages.some(m => m.content.includes(atMarker))) {
        return 50;
      }
    }

    return 0;
  }

  private groupMessagesBySession(queue: QueueItem[]): SessionMessages[] {
    const groups = new Map<string, SessionMessages>();

    for (const item of queue) {
      const event = item.event;
      const sessionId = this.getSessionId(event);
      const text = this.extractTextMessage(event.message) || '';
      const atList = this.extractAtList(event.message);
      const mediaList = item.mediaFiles || [];

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
        atList,
        mediaFiles: mediaList.length > 0 ? mediaList : undefined,
      });
    }

    return Array.from(groups.values());
  }

  /**
   * Extract @ mentions from message segments
   */
  private extractAtList(message: string | MessageSegment[]): Array<{qq: string; name?: string}> {
    if (typeof message === 'string') {
      return [];
    }

    const atList: Array<{qq: string; name?: string}> = [];
    for (const segment of message) {
      if (segment.type === 'at' && segment.data.qq) {
        atList.push({
          qq: String(segment.data.qq),
          name: segment.data.name || undefined,
        });
      }
    }
    return atList;
  }

  private async processSession(session: SessionMessages): Promise<void> {
    const qqSession = this.getOrCreateSession(session);
    qqSession.lastMessageTime = Date.now();
    qqSession.messageCount += session.messages.length;

    // Step 1: Build context
    const context = await this.buildSessionContext(session);

    // Step 2: Build prompt with messages
    const conversationHistory = this.buildPrompt(session, context);

    console.log('[QQ] Sending to AI with shared global context...');
    const response = await this.engine.processUserInput(`[QQ Source session=${session.sessionId}]\n${conversationHistory}`);

    // Check response status
    if (response.includes('Rate limit exceeded')) {
      console.log('[QQ] Rate limit hit, will retry in next batch');
    } else if (response.trim() === 'NO' || response.trim() === '') {
      console.log('[QQ] AI decided not to reply');
    } else {
      console.log('[QQ] AI response:', response.slice(0, 100));
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
      prompt += `Group ID: ${session.groupId}\n`;
    }

    // Add self ID info
    prompt += `Your QQ ID: ${this.selfId || 'unknown'}\n\n`;

    prompt += `Messages:\n`;
    for (const msg of session.messages) {
      // Check if message contains @ of self (using new format [@用户:qq])
      const isAtMe = this.selfId && msg.content.includes(`[@用户:${this.selfId}]`);
      const atMarker = isAtMe ? ' [YOU ARE MENTIONED]' : '';

      // Build @ mention details for group messages
      let atDetails = '';
      if (session.type === 'group' && msg.atList && msg.atList.length > 0) {
        const atInfo = msg.atList.map(at => {
          const atName = at.name || 'Unknown';
          return `@${atName}(ID:${at.qq})`;
        }).join(', ');
        atDetails = ` [Mentions: ${atInfo}]`;
      }

      // Format: [Time] SenderName (ID: senderId): Content [@mentions] [YOU ARE MENTIONED]
      prompt += `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.senderName} (ID: ${msg.senderId}): ${msg.content}${atDetails}${atMarker}\n`;

      // Add image hints if message has associated images
      if (msg.mediaFiles && msg.mediaFiles.length > 0) {
        for (const media of msg.mediaFiles) {
          if (media.type === 'image') {
            prompt += `  [图片可用: file_id="${media.fileId}" (使用 qq tool 的 get_image action 查看)]\n`;
          }
        }
      }
    }

    prompt += `\n${this.getInstructionPrompt(session.type, context)}`;

    return prompt;
  }

  private getInstructionPrompt(messageType: 'private' | 'group', context: QQContext): string {
    return `
## Instructions

You are processing QQ messages. Use the qq tool to send replies and files.

### Your Identity
- Your QQ ID is shown above
- Messages with "[YOU ARE MENTIONED]" indicate someone @ mentioned you specifically

### When to Reply
- Answer questions directed at you
- Respond to @mentions in groups (marked with [YOU ARE MENTIONED])
- Help when explicitly asked
- Reply when someone mentions your ID or @ you

### When NOT to Reply
- Casual chat between users (no mention of you)
- Messages not involving you
- Just say "NO" to skip

### File Operations (For Real Files Only - NOT Images)

**RECEIVING REAL FILES (documents, pdfs, zips, etc.):**
- When users send you FILES (not images), they are DETECTED but NOT automatically downloaded
- Use 'list_pending_files' action to see what files are waiting
- Use 'receive_file' action with the file_id to download
- Files are saved to: files/qq-uploads/YYYY-MM-DD/
- After receiving, you can read the file using file tools
- NOTE: This is for REAL FILES only (like .pdf, .doc, .zip) - NOT for images

**SENDING FILES:**
- Use action: "send_file"
- Required: file_path (absolute path like "files/report.pdf")
- Required: user_id OR group_id
- Optional: file_name (custom display name)
- Example: {"action":"send_file","group_id":123,"file_path":"files/output/chart.png","end":true}

**FILE WORKFLOW (for real files only):**
1. User sends file → You see message with [File detected]
2. Call {"action":"list_pending_files","end":false} to see pending files
3. Call {"action":"receive_file","file_id":"xxx","end":false} to download
4. Use file tools to read/analyze the saved file
5. Reply with results

### Tool Usage

**TEXT MESSAGES:**
- Use qq tool with action "send_private_message" or "send_group_message"
- Include correct user_id or group_id
- Keep replies short (1-2 sentences)

**FILE MESSAGES:**
- Use qq tool with action "send_file"
- Provide the absolute file path
- System will handle file upload

### IMAGE SUPPORT (IMPORTANT: DIFFERENT FROM FILES!)
When users send IMAGES (.jpg, .png, .gif, etc.), they are detected but NOT automatically viewed by you.

**⚠️ IMPORTANT DISTINCTION:**
- IMAGES (photos, screenshots, memes) → Use "get_image" action (multimodal, you "see" it)
- FILES (pdf, doc, zip, etc.) → Use "receive_file" action (download to read)
- If you see [图片可用] → It's an IMAGE, use get_image
- If you see [File detected] → It's a FILE, use receive_file

**VIEWING IMAGES (MULTIMODAL):**
- When you see "[图片可用: file_id=xxx.jpg]" in messages
- Use qq tool action "get_image" with the file_id to view it
- The image will be sent to you in multimodal format (you'll "see" it directly)
- Example: {"action":"get_image","file_id":"xxx.jpg","group_id":123}

**WHEN TO USE get_image:**
- User asks "这是什么图片" or "看看这张图"
- User sends a photo/screenshot and you need to understand it
- CRITICAL: After calling get_image, the image will be INSTANTLY transmitted to you via multimodal API - you will "see" it directly!
- DO NOT write code to download images - the get_image tool handles everything!
- DO NOT use receive_file for images - that's for documents only!
- DO NOT use code-runner to download images - it's unnecessary and wasteful!

**HOW get_image WORKS:**
1. You call {"action":"get_image","file_id":"xxx.jpg"}
2. The system automatically transmits the image to your multimodal context
3. You INSTANTLY "see" the image (like a user showing you a photo)
4. You directly describe/analyze the image content
5. NO code needed, NO download needed, NO file reading needed!

**WARNING:** Using code tools to download images is WRONG and WASTEFUL. Use get_image!

### Conversation Control
- After sending a message/file, decide if you need to continue
- If task is complete → reply "NO"
- If more to do → use qq tool again
- qq tool parameter "end": true means stop after this message
- qq tool parameter "end": false means continue

### Reply Format

qq tool parameters for TEXT:
- action: "send_private_message" or "send_group_message"
- user_id: ${context.userId} (for private)
- group_id: ${context.groupId || 'N/A'} (for group)
- message: "your reply text (can include [CQ:at,qq=USER_ID] for @ mentions)"
- end: true/false

qq tool parameters for FILE:
- action: "send_file"
- user_id: ${context.userId} (for private) OR group_id: ${context.groupId || 'N/A'} (for group)
- file_path: "absolute/path/to/file"
- file_name: "display name" (optional)
- end: true/false

### @ Mention (CQ Code Format)
To mention someone in a group message:
- Include [CQ:at,qq=USER_ID] in the message text, where USER_ID is the numeric QQ ID
- Example: "Hello [CQ:at,qq=123456], how are you?"
- The CQ code will be automatically converted to a proper @ mention
- You can find the QQ ID from incoming messages (shown as "ID: xxx" in sender info)

Examples:
- Text without @: {"action":"send_group_message","group_id":123,"message":"Hello everyone","end":true}
- Text with @: {"action":"send_group_message","group_id":123,"message":"Hello [CQ:at,qq=456789], please check this","end":true}
- Send file: {"action":"send_file","group_id":123,"file_path":"files/report.pdf","file_name":"Monthly Report","end":true}

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
        // Use a clear format that AI won't mistakenly copy
        texts.push(`[@用户:${segment.data.qq}]`);
      } else if (segment.type === 'face') {
        texts.push(`[表情:${segment.data.id}]`);
      }
    }
    return texts.join('');
  }

  private async getGroupName(groupId: number): Promise<string> {
    // Check cache first
    if (this.groupNameCache.has(groupId)) {
      return this.groupNameCache.get(groupId)!;
    }

    // Fetch from NapCat API if connected
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      try {
        const groupName = await this.requestGroupInfo(groupId);
        if (groupName) {
          this.groupNameCache.set(groupId, groupName);
          return groupName;
        }
      } catch (error) {
        console.error(`[QQ] Failed to get group name for ${groupId}:`, error);
      }
    }

    return `Group ${groupId}`;
  }

  /**
   * Request group info from NapCat API
   */
  private requestGroupInfo(groupId: number): Promise<string | null> {
    return new Promise((resolve) => {
      const requestId = `group_info_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const messageHandler = (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          console.log(`[QQ] Group info response:`, JSON.stringify(response).substring(0, 200));

          if (response.echo === requestId && response.status === 'ok' && response.data) {
            // NapCat returns group_name in data.group_name
            const groupName = response.data.group_name;
            if (groupName) {
              this.wsClient?.removeListener('message', messageHandler);
              resolve(groupName);
              return;
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      };

      const params = {
        action: 'get_group_info',
        params: {
          group_id: String(groupId),
        },
        echo: requestId,
      };

      this.wsClient?.on('message', messageHandler);
      this.wsClient?.send(JSON.stringify(params));

      setTimeout(() => {
        this.wsClient?.removeListener('message', messageHandler);
        resolve(null);
      }, 5000); // 5s timeout
    });
  }

  private checkPermissions(event: OneBotMessageEvent): boolean {
    // Check blocked first
    if (this.configManager.isUserBlocked(event.user_id)) {
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
        // Check for @ mention of self (using new format [@用户:qq] or direct segment check)
        const hasAtMe = text.includes(`[@用户:${this.selfId}]`) ||
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
    message?: string;
    file_path?: string;
    file_name?: string;
  }): Promise<string> {

    if (!this.wsClient) {
      return '[Error: WebSocket not connected - no client]';
    }

    if (this.wsClient.readyState !== WebSocket.OPEN) {
      return `[Error: WebSocket not open - state: ${this.wsClient.readyState}]`;
    }

    try {
      // Handle file sending
      if (params.action === 'send_file' && params.file_path) {
        // Convert relative path to absolute path
        let absoluteFilePath = params.file_path;
        if (!path.isAbsolute(params.file_path)) {
          absoluteFilePath = path.resolve(process.cwd(), params.file_path);
          console.log(`[QQ] Converted relative path to absolute: ${absoluteFilePath}`);
        }

        const resolvedFilePath = path.resolve(absoluteFilePath);
        const exportRoot = this.fileExportDir + path.sep;
        if (resolvedFilePath !== this.fileExportDir && !resolvedFilePath.startsWith(exportRoot)) {
          return `[Error: File path is outside allowed export directory: ${this.fileExportDir}]`;
        }

        // Check if file exists
        try {
          await fs.access(resolvedFilePath);
        } catch {
          return `[Error: File not found: ${params.file_path} (resolved: ${resolvedFilePath})]`;
        }

        // Get file name
        const fileName = params.file_name || path.basename(resolvedFilePath);

        // OneBot file upload API - 根据 NapCat API 文档
        const apiParams: any = {
          action: params.user_id ? 'upload_private_file' : 'upload_group_file',
          params: {
            file: resolvedFilePath,
            name: fileName,
            upload_file: true,  // 必需参数，根据 API 文档
          },
        };

        if (params.user_id) {
          apiParams.params.user_id = String(params.user_id);
        } else if (params.group_id) {
          apiParams.params.group_id = String(params.group_id);
        }

        const payload = JSON.stringify(apiParams);
        console.log(`[QQ] Uploading file: ${fileName} to ${params.user_id ? 'user' : 'group'} ${params.user_id || params.group_id}`);
        console.log(`[QQ] API params prepared for ${params.user_id ? 'private' : 'group'} upload`);

        this.wsClient.send(payload);
        console.log(`[QQ] File upload request sent`);
        return `[File upload started: ${fileName}]`;
      }

      // Use message directly (can contain CQ codes like [CQ:at,qq=xxx])
      const messageContent = params.message || '';

      const apiParams: any = {
        action: params.action === 'send_private_message' ? 'send_private_msg' : 'send_group_msg',
        params: {
          message: messageContent,
        },
      };

      if (params.action === 'send_private_message' && params.user_id) {
        apiParams.params.user_id = params.user_id;
      } else if (params.action === 'send_group_message' && params.group_id) {
        apiParams.params.group_id = params.group_id;
      }

      const config = this.configManager.getConfig();
      const messageChunks = this.splitMessageIfNeeded(messageContent, config.maxMessageLength, config.splitLongMessages);
      console.log(`[QQ] Sending ${params.action}${messageChunks.length > 1 ? ` in ${messageChunks.length} chunks` : ''}`);

      for (const chunk of messageChunks) {
        apiParams.params.message = chunk;
        this.wsClient.send(JSON.stringify(apiParams));
      }
      console.log(`[QQ] Message sent successfully`);
      return '[Message sent successfully]';
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[QQ] Failed to send message:', errorMsg);
      return `[Error: ${errorMsg}]`;
    }
  }

  private splitMessageIfNeeded(message: string, maxLength: number, enabled: boolean): string[] {
    const safeMax = Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 2000;
    if (!enabled || message.length <= safeMax) return [message];

    const chunks: string[] = [];
    for (let i = 0; i < message.length; i += safeMax) {
      chunks.push(message.slice(i, i + safeMax));
    }
    return chunks;
  }

  // ==================== File Cleanup (Stub) ====================

  scheduleFileCleanup(_hours: number): void {
    const intervalMs = Math.max(_hours, 1) * 60 * 60 * 1000;
    if (this.fileCleanupInterval) {
      clearInterval(this.fileCleanupInterval);
    }
    this.fileCleanupInterval = setInterval(() => {
      void this.cleanupOldFiles(7 * 24 * 60 * 60 * 1000).catch(error => {
        console.error('[QQ] File cleanup failed:', error);
      });
    }, intervalMs);
    console.log('[QQ] File cleanup scheduled');
  }

  private async cleanupOldFiles(maxAgeMs: number): Promise<void> {
    const roots = [this.fileUploadDir, this.mediaDir];
    const cutoff = Date.now() - maxAgeMs;
    for (const root of roots) {
      await this.cleanupDirectory(root, cutoff);
    }
  }

  private async cleanupDirectory(dir: string, cutoff: number): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.cleanupDirectory(fullPath, cutoff);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(fullPath);
        }
      } catch {
        // Ignore cleanup races.
      }
    }
  }

  private assertResponseSizeAllowed(response: Response, maxBytes: number, label: string): void {
    const contentLength = response.headers.get('content-length');
    if (!contentLength) return;
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new Error(`${label} too large: ${size} bytes exceeds ${maxBytes}`);
    }
  }

  // ==================== QQ Context Compression ====================

  /**
   * Check if QQ context compression is needed and trigger it
   * Called before processing new QQ messages
   */
  private async checkAndCompressQQContext(): Promise<void> {
    if (this.isCompressing) {
      return; // Already compressing, skip
    }

    this.isCompressing = true;

    try {
      const messages = this.engine.getMessagesSnapshot();
      const tokenUsage = await this.calculateTokenUsage(messages);

      if (tokenUsage >= this.COMPRESSION_THRESHOLD) {
        console.log(`[QQ] Context compression triggered (${Math.round(tokenUsage * 100)}% tokens)`);
        await this.compressQQContext();
      }
    } finally {
      this.isCompressing = false;
    }
  }

  /**
   * Calculate token usage ratio
   * Improved estimation for mixed Chinese/English content
   */
  private async calculateTokenUsage(messages: ChatMessage[]): Promise<number> {
    let estimatedTokens = 0;

    for (const msg of messages) {
      const content = msg.content || '';
      if (typeof content === 'string') {
        // Count Chinese characters (each ~1 token)
        const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
        // Count non-Chinese characters (4 chars ~1 token)
        const otherChars = content.length - chineseChars;
        estimatedTokens += chineseChars + (otherChars / 4);
      } else if (Array.isArray(content)) {
        // Handle multimodal content
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            const chineseChars = (item.text.match(/[\u4e00-\u9fa5]/g) || []).length;
            const otherChars = item.text.length - chineseChars;
            estimatedTokens += chineseChars + (otherChars / 4);
          }
          // Image/audio tokens are handled separately by the model
        }
      }
    }

    // Add fixed overhead for system prompts and tools (~1500 tokens)
    const fixedOverhead = 1500;
    estimatedTokens += fixedOverhead;

    const maxTokens = 8000; // Match TOKEN_CONFIG.maxHistoryTokens
    return estimatedTokens / maxTokens;
  }

  /**
   * Compress QQ context by:
   * 1. Extracting QQ messages (including existing summary)
   * 2. Deleting them from context
   * 3. Generating new summary with AI
   * 4. Inserting new summary
   * 5. Adding buffered messages
   */
  private async compressQQContext(): Promise<void> {
    console.log('[QQ] Starting context compression...');

    try {
      // Step 1: Extract removable messages and separate old summary
      console.log('[QQ] Step 1: Extracting removable messages and old summary...');
      const { extractedMessages, remainingMessages, oldSummary } = this.extractRemovableMessages();

      if (extractedMessages.length === 0 && !oldSummary) {
        console.log('[QQ] No messages to compress');
        return;
      }

      console.log(`[QQ] Will compress ${extractedMessages.length} new messages`);
      if (oldSummary) {
        console.log(`[QQ] Will merge with existing summary (${oldSummary.length} chars)`);
      }
      console.log(`[QQ] Will keep ${remainingMessages.length} system prompts`);

      // Step 2: Generate merged summary with AI
      console.log('[QQ] Step 2: Generating merged AI summary...');
      const newSummary = await this.generateQQSummary(extractedMessages, oldSummary);

      // Step 3: Insert new summary into remaining messages (only system prompts)
      console.log('[QQ] Step 3: Inserting merged summary...');
      const messagesWithSummary = this.insertSummaryIntoMessages(remainingMessages, newSummary);

      // Step 4: Update engine context
      console.log('[QQ] Step 4: Updating engine context...');
      await this.engine.replaceMessagesLocked(messagesWithSummary);
      this.qqSummaryMessage = newSummary;

      console.log(`[QQ] Context compressed successfully!`);
      console.log(`[QQ] New context has ${messagesWithSummary.length} messages`);

    } catch (error) {
      console.error('[QQ] Context compression failed:', error);
    }
  }

  /**
   * Extract removable messages from context (everything except system prompts)
   * Also extracts old summary separately for merging
   * Note: Does NOT delete from engine immediately - deletion happens in compressQQContext
   * to avoid race conditions during AI summary generation
   */
  private extractRemovableMessages(): { 
    extractedMessages: ChatMessage[]; 
    remainingMessages: ChatMessage[];
    oldSummary: string | null;
  } {
    const messages = this.engine.getMessagesSnapshot();
    const extracted: ChatMessage[] = []; // These will be compressed into summary
    const remaining: ChatMessage[] = []; // These will be kept (system prompts only)
    let oldSummary: string | null = null; // Existing summary to be merged

    for (const msg of messages) {
      const content = contentToText(msg.content);
      
      // Check if this is an existing summary
      if (this.isExistingSummary(msg)) {
        oldSummary = content; // Save old summary for merging
        // Don't add to remaining, it will be replaced by new merged summary
      } else if (this.shouldKeepMessage(msg)) {
        remaining.push(msg); // Keep system prompts
      } else {
        extracted.push(msg); // Extract QQ messages, AI responses, etc.
      }
    }

    console.log(`[QQ] Found ${extracted.length} messages to compress, old summary: ${oldSummary ? 'yes' : 'none'}, keeping ${remaining.length} system prompts`);

    return { extractedMessages: extracted, remainingMessages: remaining, oldSummary };
  }

  /**
   * Determine if a message should be kept (not compressed)
   * Keeps: system prompts (except QQ messages and old summaries)
   * Removes: QQ messages, AI responses, tool results, user inputs, OLD summaries
   * Note: Old summaries will be extracted and given to AI for merging
   */
  private shouldKeepMessage(msg: ChatMessage): boolean {
    const content = contentToText(msg.content);

    // Remove OLD QQ CONTEXT SUMMARY (it will be extracted separately and merged by AI)
    // We only want to keep the NEW summary after compression
    if (content.startsWith('[QQ CONTEXT SUMMARY]') || content.startsWith('[QQ SUMMARY]')) {
      return false; // Remove old summary, AI will create a merged one
    }

    // Keep system prompts that are NOT QQ-related messages
    // System prompts are role='system' AND don't start with QQ patterns
    if (msg.role === 'system') {
      // Check if this is a QQ message disguised as system message
      if (content.startsWith('[QQ Messages') || content.startsWith('[QQ]')) {
        return false; // This is actually a QQ message, not a real system prompt
      }
      return true; // Real system prompt, keep it
    }

    // CRITICAL: Keep multimodal messages (images) - they should not be compressed
    if (Array.isArray(msg.content)) {
      const hasImage = msg.content.some((item: any) => item.type === 'image_url' && item.image_url?.url);
      if (hasImage) {
        console.log('[QQ] Keeping multimodal image message during compression');
        return true; // Keep multimodal image messages
      }
    }

    // Everything else (user messages, assistant responses, tool results) should be removed
    return false;
  }

  /**
   * Check if a message is an existing summary
   */
  private isExistingSummary(msg: ChatMessage): boolean {
    const content = contentToText(msg.content);
    return content.startsWith('[QQ CONTEXT SUMMARY]') || content.startsWith('[QQ SUMMARY]');
  }

  /**
   * Generate QQ context summary using AI
   * If oldSummary is provided, merge it with new messages
   */
  private async generateQQSummary(messages: ChatMessage[], oldSummary: string | null = null): Promise<string> {
    const aiClient = this.engine.getAIClient();
    
    console.log(`[QQ] Calling AI to generate summary for ${messages.length} messages...`);
    if (oldSummary) {
      console.log(`[QQ] Merging with existing summary...`);
    }
    
    // Build the conversation text for AI
    const conversationText = messages.map((msg, idx) => {
      const content = contentToText(msg.content);
      // Truncate very long messages
      if (content.length > 1000) {
        return `[${idx}] ${content.slice(0, 1000)}... (truncated)`;
      }
      return `[${idx}] ${content}`;
    }).join('\n\n');

    // Build prompt based on whether we have an old summary to merge
    let userPrompt: string;
    if (oldSummary) {
      userPrompt = `Please create a MERGED summary combining the PREVIOUS SUMMARY with the NEW QQ messages below.

PREVIOUS SUMMARY:
${oldSummary}

NEW QQ MESSAGES TO MERGE:
${conversationText}

IMPORTANT: 
- Start your response with "[QQ CONTEXT SUMMARY]" (not "[QQ SUMMARY]")
- Create a SINGLE unified summary that includes information from both the previous summary and new messages
- Update any changed information (e.g., if user preferences changed)
- Keep the summary concise but comprehensive

Format:
[QQ CONTEXT SUMMARY]
- Participants: [list all users/groups involved, old and new]
- Recent Topics: [what was discussed in new messages]
- Key Information: [important facts, user preferences, pending tasks - MERGED from old and new]
- Historical Context: [ongoing conversations from old summary + updates from new]

Be concise but ensure NO important details are lost in the merge.`;
    } else {
      userPrompt = `Please summarize the following QQ conversation history:

${conversationText}

IMPORTANT: Start your response with "[QQ CONTEXT SUMMARY]" (not "[QQ SUMMARY]")

Format:
[QQ CONTEXT SUMMARY]
- Participants: [list users/groups involved]
- Recent Topics: [what was discussed]
- Key Information: [important facts, user preferences, pending tasks]
- Context: [ongoing conversations or relationships]

Be concise but ensure important details are preserved.`;
    }

    const summaryPrompt: ChatMessage[] = [
      {
        role: 'system',
        content: oldSummary 
          ? 'You are merging an existing QQ conversation summary with new messages. Create a unified, comprehensive summary.'
          : 'You are summarizing QQ conversation context for compression. Create a concise but comprehensive summary.',
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ];

    try {
      console.log('[QQ] Waiting for AI response...');
      // Use globalApiLock to avoid conflicts with other AI calls
      const response = await globalApiLock.withLock(() =>
        aiClient.chatCompletion(summaryPrompt)
      );

      if (response?.choices?.[0]?.message?.content) {
        const summary = response.choices[0].message.content;
        console.log(`[QQ] AI generated summary successfully (${summary.length} chars)`);
        // Ensure summary starts with [QQ CONTEXT SUMMARY] (not just [QQ SUMMARY])
        // This prevents it from being recognized as a QQ message to compress
        if (!summary.startsWith('[QQ CONTEXT SUMMARY]')) {
          return `[QQ CONTEXT SUMMARY]\n${summary}`;
        }
        return summary;
      } else {
        console.log('[QQ] AI response empty, using fallback');
      }
    } catch (error) {
      console.error('[QQ] AI call failed for summary:', error);
    }

    // Fallback: create simple summary
    console.log('[QQ] Using fallback simple summary');
    const userCount = new Set(messages.filter(m => m.role === 'user').map(m => contentToText(m.content).split(':')[0])).size;
    return `[QQ SUMMARY] Conversation with ${userCount} users, ${messages.length} messages total. [Details omitted due to compression error]`;
  }

  getStatus(): { running: boolean; paused: boolean; connected: boolean; queueLength: number; sessions: number; pendingFiles: number; imageCacheSize: number } {
    return {
      running: this.isRunning,
      paused: this.isPaused,
      connected: this.wsClient?.readyState === WebSocket.OPEN,
      queueLength: this.messageQueue.length,
      sessions: this.sessions.size,
      pendingFiles: this.pendingFiles.size,
      imageCacheSize: this.imageStorage.size,
    };
  }

  /**
   * Insert summary into messages (as system message at appropriate position)
   * Ensures only ONE summary exists - any old summaries are filtered out
   */
  private insertSummaryIntoMessages(messages: ChatMessage[], summary: string): ChatMessage[] {
    // Filter out any old summaries from messages (safety check)
    const filteredMessages = messages.filter(msg => !this.isExistingSummary(msg));
    
    // Find position after system prompts but before user messages
    let insertIndex = 0;
    for (let i = 0; i < filteredMessages.length; i++) {
      if (filteredMessages[i].role === 'system') {
        insertIndex = i + 1;
      } else {
        break;
      }
    }

    // Insert new summary as system message
    const summaryMessage: ChatMessage = {
      role: 'system',
      content: summary,
    };

    const result = [...filteredMessages];
    result.splice(insertIndex, 0, summaryMessage);
    return result;
  }

}
