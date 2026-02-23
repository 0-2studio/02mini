/**
 * QQ Module - NapCat/OneBot Integration
 */

export { QQAdapter } from './adapter.js';
export { QQConfigManager } from './config.js';
export { createQQTools, executeQQTool } from './tools.js';
export type {
  OneBotMessageEvent,
  OneBotMetaEvent,
  OneBotEvent,
  MessageSegment,
  QQConfig,
  QQContext,
  QQSession,
  QQToolParams,
  QQToolResult,
} from './types.js';
export { DEFAULT_QQ_CONFIG } from './types.js';
