import { EventEmitter } from 'events';
import WebSocket from 'ws';
import fs from 'fs/promises';
import pathModule from 'path';
import type { CoreEngine } from '../core/engine.js';
import { stripMessageMarker } from '../core/engine.js';
import type { KukeChatConfigManager } from './config.js';
import type {
  KukeChatConfig,
  KukeChatEvent,
  KukeChatMessageCreatedData,
  KukeChatStatus,
} from './types.js';

interface QueueItem {
  message: KukeChatMessageCreatedData;
  timestamp: number;
}

interface ConversationBatch {
  conversationId: number;
  messages: QueueItem[];
}

interface CachedKukeChatMessage {
  id: number;
  conversation_id: number;
  sender_id?: number;
  sender_display_name?: string;
  sender?: KukeChatMessageCreatedData['sender'];
  type?: string;
  content: string;
  metadata?: Record<string, any>;
  created_at: string;
  direction: 'incoming' | 'outgoing';
}

export class KukeChatAdapter extends EventEmitter {
  private readonly engine: CoreEngine;
  private readonly configManager: KukeChatConfigManager;
  private config: KukeChatConfig;
  private ws?: WebSocket;
  private running = false;
  private connected = false;
  private processing = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private botUserId?: number;
  private queue: QueueItem[] = [];
  private seenMessageIds: Map<number, number> = new Map();
  private latestReceivedMessageIdByConversation: Map<number, number> = new Map();
  private lastProcessedMessageIdByConversation: Map<number, number> = new Map();
  private recentMessagesByConversation: Map<number, CachedKukeChatMessage[]> = new Map();
  private syntheticOutgoingMessageId = -1;
  private readonly maxCachedMessagesPerConversation = 200;

  constructor(options: { engine: CoreEngine; configManager: KukeChatConfigManager }) {
    super();
    this.engine = options.engine;
    this.configManager = options.configManager;
    this.config = this.configManager.getConfig();
  }

  async start(): Promise<void> {
    this.config = this.configManager.getConfig();
    if (!this.config.enabled) {
      console.log('[KukeChat] Disabled');
      return;
    }
    if (!this.config.botKey) {
      console.error('[KukeChat] KUKECHAT_BOT_KEY is required when enabled');
      return;
    }
    if (this.running) return;

    this.running = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.connected = false;
    console.log('[KukeChat] Stopped');
  }

  getStatus(): KukeChatStatus {
    return {
      enabled: this.config.enabled,
      running: this.running,
      connected: this.connected,
      botUserId: this.botUserId,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.queue.length,
    };
  }

  async sendConversationMessage(conversationId: number, message: string): Promise<string> {
    const sent: unknown[] = [];
    for (const part of this.splitMessage(message)) {
      const result = await this.requestJson('POST', `/bot-api/conversations/${conversationId}/messages`, { message: part });
      sent.push(result);
      this.cacheOutgoingMessage(conversationId, part, result);
    }
    return `KukeChat message sent to conversation ${conversationId} (${sent.length} part(s))`;
  }

  async sendDirectMessage(userId: number, message: string): Promise<string> {
    const sent: unknown[] = [];
    for (const part of this.splitMessage(message)) {
      sent.push(await this.requestJson('POST', `/bot-api/users/${userId}/messages`, { message: part }));
    }
    return `KukeChat direct message sent to user ${userId} (${sent.length} part(s))`;
  }

  async getMe(): Promise<unknown> {
    return this.requestJson('GET', '/bot-api/me');
  }

  async listConversations(): Promise<unknown> {
    return this.requestJson('GET', '/bot-api/conversations');
  }

  async getOnlineUsers(): Promise<unknown> {
    return this.requestJson('GET', '/bot-api/users/online');
  }

  async getUser(userId: number): Promise<unknown> {
    return this.requestJson('GET', `/bot-api/users/${userId}`);
  }

  async getConversation(conversationId: number): Promise<unknown> {
    return this.requestJson('GET', `/bot-api/conversations/${conversationId}`);
  }

  async getConversationMembers(conversationId: number): Promise<unknown> {
    return this.requestJson('GET', `/bot-api/conversations/${conversationId}/members`);
  }

  async getMessages(conversationId: number, params: { limit?: number; before_id?: number; after_id?: number } = {}): Promise<unknown> {
    const search = new URLSearchParams();
    search.set('limit', String(Math.max(1, Math.min(100, params.limit ?? 50))));
    if (params.before_id) search.set('before_id', String(params.before_id));
    if (params.after_id) search.set('after_id', String(params.after_id));
    const remote = await this.requestJson('GET', `/bot-api/conversations/${conversationId}/messages?${search.toString()}`);
    const remoteMessages = this.extractMessageArray(remote);
    if (remoteMessages.length > 0) {
      for (const message of remoteMessages) this.cacheMessageLike(conversationId, message, 'incoming');
      return remote;
    }

    return {
      source: 'local-cache',
      note: 'Remote KukeChat history query returned no messages; returning messages observed by this running bot process.',
      messages: this.getCachedMessages(conversationId, params),
    };
  }

  async sendDirectMessageBody(userId: number, message: string): Promise<string> {
    const sent: unknown[] = [];
    for (const part of this.splitMessage(message)) {
      sent.push(await this.requestJson('POST', '/bot-api/direct/messages', { user_id: userId, message: part }));
    }
    return `KukeChat direct body message sent to user ${userId} (${sent.length} part(s))`;
  }

  async recallMessage(conversationId: number, messageId: number): Promise<unknown> {
    return this.requestJson('POST', `/bot-api/conversations/${conversationId}/messages/${messageId}/recall`, {});
  }

  async updateButton(conversationId: number, messageId: number, componentId: string, updates: Record<string, unknown>): Promise<unknown> {
    return this.requestJson('PATCH', `/bot-api/conversations/${conversationId}/messages/${messageId}/components/${encodeURIComponent(componentId)}`, updates);
  }

  async toggleReaction(conversationId: number, messageId: number, emoji: string): Promise<unknown> {
    return this.requestJson('POST', `/bot-api/conversations/${conversationId}/messages/${messageId}/reactions`, { emoji });
  }

  async deleteReaction(conversationId: number, messageId: number, emoji: string): Promise<unknown> {
    return this.requestJson('DELETE', `/bot-api/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  async uploadImage(filePath: string): Promise<any> {
    return this.uploadFile('/bot-api/uploads/image', filePath, 'image');
  }

  async uploadVoice(filePath: string): Promise<any> {
    return this.uploadFile('/bot-api/uploads/voice', filePath, 'voice');
  }

  getLastMessageId(conversationId: number): number | undefined {
    return this.lastProcessedMessageIdByConversation.get(conversationId);
  }

  getLatestReceivedMessageId(conversationId: number): number | undefined {
    return this.latestReceivedMessageIdByConversation.get(conversationId);
  }

  getCachedMessages(conversationId: number, params: { limit?: number; before_id?: number; after_id?: number } = {}): CachedKukeChatMessage[] {
    const limit = Math.max(1, Math.min(100, params.limit ?? 50));
    let messages = [...(this.recentMessagesByConversation.get(conversationId) || [])]
      .sort((a, b) => a.id - b.id);

    if (params.before_id !== undefined) messages = messages.filter(message => message.id < params.before_id!);
    if (params.after_id !== undefined) messages = messages.filter(message => message.id > params.after_id!);

    return messages.slice(-limit);
  }

  private async connect(): Promise<void> {
    const key = encodeURIComponent(this.config.botKey || '');
    const url = `${this.config.wsUrl}?key=${key}`;
    console.log('[KukeChat] Connecting WebSocket...');

    this.ws = new WebSocket(url);
    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('[KukeChat] WebSocket connected');
    });
    this.ws.on('message', (raw) => this.handleRawMessage(raw.toString()).catch(err => {
      console.error('[KukeChat] Message handling failed:', err);
    }));
    this.ws.on('close', () => {
      this.connected = false;
      console.log('[KukeChat] WebSocket closed');
      this.scheduleReconnect();
    });
    this.ws.on('error', (error) => {
      console.error('[KukeChat] WebSocket error:', error.message);
    });
  }

  private scheduleReconnect(): void {
    if (!this.running || !this.config.autoReconnect || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectMaxDelayMs,
      this.config.reconnectInitialDelayMs * Math.max(1, this.reconnectAttempts)
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private async handleRawMessage(raw: string): Promise<void> {
    if (raw === 'pong') return;
    const event = JSON.parse(raw) as KukeChatEvent;

    if (event.type === 'bot.connection.ready') {
      this.botUserId = event.data.user_id;
      console.log(`[KukeChat] Bot ready: bot=${event.data.bot_id}, user=${event.data.user_id}`);
      return;
    }

    if (event.type === 'message.created') {
      await this.handleMessageCreated(event.data);
      return;
    }

    if (event.type === 'message.interaction') {
      this.emit('activity', { channel: 'kukechat', session: `conversation:${event.data.conversation_id}` });
      await this.engine.processUserInput(
        `[KukeChat Interaction Source conversation=${event.data.conversation_id} user=${event.data.user_id}]\n` +
        `action_id=${event.data.action_id || ''}\ncomponent_id=${event.data.component_id || ''}\nlabel=${event.data.label || ''}\nvalue=${event.data.value || ''}`
      );
      return;
    }
  }

  private async handleMessageCreated(message: KukeChatMessageCreatedData): Promise<void> {
    if (this.config.ignoreBotMessages && (message.sender?.is_bot || message.sender_id === this.botUserId)) return;
    if (!message.content?.trim()) return;
    if (this.isDuplicateMessage(message.id)) return;
    this.rememberReceivedMessageId(message.conversation_id, message.id);
    this.cacheIncomingMessage(message);

    if (this.queue.length >= this.config.maxQueueSize) {
      const dropped = this.queue.shift();
      console.warn(`[KukeChat] Message queue full, dropped oldest message ${dropped?.message.id || 'unknown'}`);
    }
    this.queue.push({ message, timestamp: Date.now() });
    this.emit('activity', { channel: 'kukechat', session: `conversation:${message.conversation_id}` });
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const batchItems = this.queue.splice(0, this.queue.length);
        const batches = this.groupQueueByConversation(batchItems);

        for (const batch of batches) {
          const prompt = this.buildBatchPrompt(batch);
          const rawResponse = await this.engine.processUserInput(prompt);
          this.markBatchProcessed(batch);
          const response = stripMessageMarker(rawResponse).trim();
          if (response && response !== 'NO' && !response.includes('[Conversation ended by stop tool]')) {
            // If the model did not use the tool, do not auto-send. Tool-based sending keeps intent explicit.
            console.log('[KukeChat] Engine returned non-tool response; not auto-sending.');
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private groupQueueByConversation(items: QueueItem[]): ConversationBatch[] {
    const groups = new Map<number, ConversationBatch>();
    for (const item of items) {
      const conversationId = item.message.conversation_id;
      if (!groups.has(conversationId)) groups.set(conversationId, { conversationId, messages: [] });
      groups.get(conversationId)!.messages.push(item);
    }
    return [...groups.values()].sort((a, b) => a.messages[0].timestamp - b.messages[0].timestamp);
  }

  private buildBatchPrompt(batch: ConversationBatch): string {
    const latest = batch.messages.at(-1)?.message;
    let prompt = `[KukeChat Source conversation=${batch.conversationId} messages=${batch.messages.map(item => item.message.id).join(',')}]\n`;
    prompt += `[KukeChat Messages - Conversation]\n\n`;
    prompt += `Conversation ID: ${batch.conversationId}\n`;
    prompt += `Latest message ID: ${latest?.id ?? 'unknown'}\n`;
    prompt += `Messages:\n`;

    for (const item of batch.messages) {
      const message = item.message;
      const senderName = message.sender_display_name || message.sender?.nickname || message.sender?.username || 'Unknown';
      prompt += `[${new Date(message.created_at).toLocaleTimeString()}] ${senderName} (ID: ${message.sender_id}, message=${message.id}): ${message.content}\n`;
      const contentNotes = this.describeMessageElements(message.content);
      if (contentNotes) {
        prompt += contentNotes.split('\n').filter(Boolean).map(line => `  ${line}`).join('\n') + '\n';
      }
    }

    prompt += `\n## Instructions\n`;
    prompt += `You are processing KukeChat messages. Use the kukechat tool to send replies.\n`;
    prompt += `Answer messages directed at you and avoid duplicate replies. If no reply is needed, reply "NO" as plain assistant text; never send "NO" through the kukechat tool.\n`;
    prompt += `For quoted replies, use action=reply_message with the target message_id. Do not prepend <quote .../> inside markdown/buttons/menu/image/voice/sticker content.\n`;
    prompt += `For normal replies, use action=send_conversation_message with conversation_id=${batch.conversationId}.\n`;
    prompt += `For markdown/buttons/menu, use the matching kukechat action and keep content concise.\n`;
    prompt += `When done after sending, use end=true.\n`;

    return prompt;
  }

  private markBatchProcessed(batch: ConversationBatch): void {
    let maxId = 0;
    for (const item of batch.messages) {
      if (item.message.id > maxId) maxId = item.message.id;
    }
    if (maxId > 0) this.rememberProcessedMessageId(batch.conversationId, maxId);
  }

  private isDuplicateMessage(messageId: number): boolean {
    const now = Date.now();
    for (const [id, timestamp] of this.seenMessageIds.entries()) {
      if (now - timestamp > 30 * 60_000) this.seenMessageIds.delete(id);
    }
    if (this.seenMessageIds.has(messageId)) {
      console.log(`[KukeChat] Duplicate message ignored: ${messageId}`);
      return true;
    }
    this.seenMessageIds.set(messageId, now);
    return false;
  }

  protected async requestJson(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!this.config.botKey) throw new Error('KukeChat bot key is not configured');
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.config.botKey}`,
        'X-Kuke-Bot-Key': this.config.botKey,
        'X-Kuke-Client': '02mini/kukechat-adapter',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`KukeChat API ${response.status}: ${text.slice(0, 500)}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private async uploadFile(path: string, filePath: string, kind: 'image' | 'voice'): Promise<unknown> {
    if (!this.config.botKey) throw new Error('KukeChat bot key is not configured');
    const filename = pathModule.basename(filePath);
    const mimeType = this.getUploadMimeType(filename, kind);
    const bytes = await fs.readFile(filePath);
    const file = new Blob([bytes], { type: mimeType });
    const form = new FormData();
    form.append('file', file, filename);
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.config.botKey}`,
        'X-Kuke-Bot-Key': this.config.botKey,
        'X-Kuke-Client': '02mini/kukechat-adapter',
      },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`KukeChat upload ${response.status}: ${text.slice(0, 500)}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private getUploadMimeType(filename: string, kind: 'image' | 'voice'): string {
    const ext = pathModule.extname(filename).toLowerCase();
    const imageTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    const voiceTypes: Record<string, string> = {
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.wav': 'audio/wav',
    };

    const mimeType = kind === 'image' ? imageTypes[ext] : voiceTypes[ext];
    if (!mimeType) {
      const allowed = kind === 'image'
        ? Object.keys(imageTypes).join(', ')
        : Object.keys(voiceTypes).join(', ');
      throw new Error(`Unsupported KukeChat ${kind} upload extension '${ext || '(none)'}'. Allowed: ${allowed}`);
    }
    return mimeType;
  }

  private rememberReceivedMessageId(conversationId: number, messageId: number): void {
    const current = this.latestReceivedMessageIdByConversation.get(conversationId) || 0;
    if (messageId > current) this.latestReceivedMessageIdByConversation.set(conversationId, messageId);
  }

  private rememberProcessedMessageId(conversationId: number, messageId: number): void {
    const current = this.lastProcessedMessageIdByConversation.get(conversationId) || 0;
    if (messageId > current) this.lastProcessedMessageIdByConversation.set(conversationId, messageId);
  }

  private cacheIncomingMessage(message: KukeChatMessageCreatedData): void {
    this.cacheMessage({
      id: message.id,
      conversation_id: message.conversation_id,
      sender_id: message.sender_id,
      sender_display_name: message.sender_display_name,
      sender: message.sender,
      type: message.type,
      content: message.content,
      metadata: message.metadata,
      created_at: message.created_at,
      direction: 'incoming',
    });
  }

  private cacheOutgoingMessage(conversationId: number, content: string, response: unknown): void {
    const message = this.extractMessageObject(response);
    this.cacheMessage({
      id: this.extractNumericId(message) ?? this.syntheticOutgoingMessageId--,
      conversation_id: conversationId,
      sender_id: this.botUserId,
      content: this.extractStringField(message, 'content') ?? this.extractStringField(message, 'message') ?? content,
      metadata: this.extractObjectField(message, 'metadata'),
      created_at: this.extractStringField(message, 'created_at') ?? new Date().toISOString(),
      direction: 'outgoing',
    });
  }

  private cacheMessageLike(conversationId: number, input: unknown, fallbackDirection: 'incoming' | 'outgoing'): void {
    const message = this.extractMessageObject(input);
    const id = this.extractNumericId(message);
    const content = this.extractStringField(message, 'content') ?? this.extractStringField(message, 'message');
    if (!id || !content) return;

    this.cacheMessage({
      id,
      conversation_id: this.extractNumberField(message, 'conversation_id') ?? conversationId,
      sender_id: this.extractNumberField(message, 'sender_id'),
      sender_display_name: this.extractStringField(message, 'sender_display_name'),
      content,
      metadata: this.extractObjectField(message, 'metadata'),
      created_at: this.extractStringField(message, 'created_at') ?? new Date().toISOString(),
      direction: fallbackDirection,
    });
  }

  private cacheMessage(message: CachedKukeChatMessage): void {
    const messages = this.recentMessagesByConversation.get(message.conversation_id) || [];
    const existingIndex = messages.findIndex(existing => existing.id === message.id);
    if (existingIndex >= 0) messages[existingIndex] = message;
    else messages.push(message);

    messages.sort((a, b) => a.id - b.id);
    while (messages.length > this.maxCachedMessagesPerConversation) messages.shift();
    this.recentMessagesByConversation.set(message.conversation_id, messages);
  }

  private extractMessageArray(input: unknown): unknown[] {
    if (Array.isArray(input)) return input;
    if (!input || typeof input !== 'object') return [];
    const record = input as Record<string, unknown>;
    for (const key of ['messages', 'data', 'items', 'results']) {
      if (Array.isArray(record[key])) return record[key];
    }
    return [];
  }

  private extractMessageObject(input: unknown): Record<string, unknown> | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const record = input as Record<string, unknown>;
    if (record.message && typeof record.message === 'object') return record.message as Record<string, unknown>;
    if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) return record.data as Record<string, unknown>;
    return record;
  }

  private extractNumericId(record: Record<string, unknown> | undefined): number | undefined {
    return this.extractNumberField(record, 'id') ?? this.extractNumberField(record, 'message_id');
  }

  private extractNumberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private extractStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' ? value : undefined;
  }

  private extractObjectField(record: Record<string, unknown> | undefined, key: string): Record<string, any> | undefined {
    const value = record?.[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
  }

  private describeMessageElements(content: string): string {
    const notes: string[] = [];
    const quotes = [...content.matchAll(/<quote\s+[^>]*id=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
    const ats = [...content.matchAll(/<(?:at|mention)\s+[^>]*id=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
    const atAll = /<(?:at_all|mention_all)\s*\/?>/i.test(content);
    const images = [
      ...[...content.matchAll(/<(?:img|image)\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]),
      ...[...content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi)].map(m => m[1]),
    ];
    const audios = [...content.matchAll(/<audio\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
    const stickers = [...content.matchAll(/<sticker\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);

    if (quotes.length) notes.push(`Quoted message ids: ${quotes.join(', ')}`);
    if (ats.length) notes.push(`Mentioned user ids: ${ats.join(', ')}`);
    if (atAll) notes.push('Mentioned all users');
    if (images.length) notes.push(`Image URLs: ${images.join(', ')}`);
    if (audios.length) notes.push(`Audio URLs: ${audios.join(', ')}`);
    if (stickers.length) notes.push(`Sticker URLs: ${stickers.join(', ')}`);
    return notes.length ? `[Parsed KukeChat Elements]\n${notes.map(n => `- ${n}`).join('\n')}\n` : '';
  }

  private splitMessage(message: string): string[] {
    const max = this.config.maxMessageLength;
    if (!this.config.splitLongMessages || message.length <= max) return [message];
    const parts: string[] = [];
    for (let i = 0; i < message.length; i += max) {
      parts.push(message.slice(i, i + max));
    }
    return parts;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
