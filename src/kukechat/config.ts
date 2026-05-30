import type { KukeChatConfig } from './types.js';
import { DEFAULT_KUKECHAT_CONFIG } from './types.js';

export class KukeChatConfigManager {
  private config: KukeChatConfig = { ...DEFAULT_KUKECHAT_CONFIG };

  async load(): Promise<void> {
    this.loadFromEnv();
  }

  getConfig(): KukeChatConfig {
    return { ...this.config };
  }

  private loadFromEnv(): void {
    const env = process.env;

    if (env.KUKECHAT_ENABLED !== undefined) {
      this.config.enabled = env.KUKECHAT_ENABLED === 'true';
    }
    if (env.KUKECHAT_BOT_KEY) {
      this.config.botKey = env.KUKECHAT_BOT_KEY;
    }
    if (env.KUKECHAT_BASE_URL) {
      this.config.baseUrl = env.KUKECHAT_BASE_URL;
    }
    if (env.KUKECHAT_WS_URL) {
      this.config.wsUrl = env.KUKECHAT_WS_URL;
    }
    if (env.KUKECHAT_AUTO_RECONNECT !== undefined) {
      this.config.autoReconnect = env.KUKECHAT_AUTO_RECONNECT === 'true';
    }
    if (env.KUKECHAT_MAX_MESSAGE_LENGTH) {
      const parsed = parseInt(env.KUKECHAT_MAX_MESSAGE_LENGTH, 10);
      if (Number.isInteger(parsed) && parsed > 0) this.config.maxMessageLength = parsed;
    }
    if (env.KUKECHAT_SPLIT_LONG_MESSAGES !== undefined) {
      this.config.splitLongMessages = env.KUKECHAT_SPLIT_LONG_MESSAGES === 'true';
    }
    if (env.KUKECHAT_REPLY_TO_MESSAGES !== undefined) {
      this.config.replyToMessages = env.KUKECHAT_REPLY_TO_MESSAGES === 'true';
    }
    if (env.KUKECHAT_IGNORE_BOT_MESSAGES !== undefined) {
      this.config.ignoreBotMessages = env.KUKECHAT_IGNORE_BOT_MESSAGES === 'true';
    }
  }
}
