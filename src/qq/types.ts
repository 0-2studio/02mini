/**
 * QQ NapCat Types (Simplified)
 * Type definitions for OneBot 11 protocol
 */

/** OneBot message segment */
export interface MessageSegment {
  type: string;
  data: Record<string, any>;
}

/** OneBot sender info */
export interface SenderInfo {
  user_id: number;
  nickname: string;
  card?: string;
  role?: 'owner' | 'admin' | 'member';
  title?: string;
}

/** OneBot message event */
export interface OneBotMessageEvent {
  time: number;
  self_id: number;
  post_type: 'message';
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: number;
  user_id: number;
  message: string | MessageSegment[];
  raw_message: string;
  font: number;
  sender: SenderInfo;
  group_id?: number;
  anonymous?: {
    id: number;
    name: string;
    flag: string;
  };
}

/** OneBot notice event */
export interface OneBotNoticeEvent {
  time: number;
  self_id: number;
  post_type: 'notice';
  notice_type: string;
  user_id?: number;
  group_id?: number;
  operator_id?: number;
}

/** OneBot meta event */
export interface OneBotMetaEvent {
  time: number;
  self_id: number;
  post_type: 'meta_event';
  meta_event_type: 'lifecycle' | 'heartbeat';
  status?: any;
  interval?: number;
}

/** OneBot request event */
export interface OneBotRequestEvent {
  time: number;
  self_id: number;
  post_type: 'request';
  request_type: string;
  user_id: number;
  group_id?: number;
  comment?: string;
  flag: string;
}

/** Union type for all OneBot events */
export type OneBotEvent = OneBotMessageEvent | OneBotNoticeEvent | OneBotMetaEvent | OneBotRequestEvent;

/** QQ Configuration */
export interface QQConfig {
  enabled: boolean;
  mode: 'websocket-server' | 'websocket-client';
  port?: number;
  host?: string;
  napcatWsUrl?: string;
  accessToken?: string;
  autoFriendAccept: boolean;
  autoGroupInviteAccept: boolean;
  atRequiredInGroup: boolean;
  maxMessageLength: number;
  splitLongMessages: boolean;
  typingIndicator: boolean;
}

/** QQ Permission settings */
export interface QQPermissions {
  allowedUsers: Set<number>;
  blockedUsers: Set<number>;
  allowAllPrivate: boolean;
  allowedGroups: Set<number>;
  blockedGroups: Set<number>;
  allowAllGroups: boolean;
  adminUsers: Set<number>;
}

/** QQ Session info */
export interface QQSession {
  id: string;
  type: 'private' | 'group';
  userId: number;
  groupId?: number;
  nickname: string;
  lastMessageTime: number;
  messageCount: number;
}

/** QQ Context for AI */
export interface QQContext {
  platform: 'qq';
  messageType: 'private' | 'group';
  userId: number;
  groupId?: number;
  groupName?: string;
  senderName: string;
  senderRole?: 'owner' | 'admin' | 'member';
  isAt: boolean;
  atList?: Array<{qq: string, isMe: boolean}>;
  sessionId: string;
}

/** QQ File Info for received/sent files */
export interface QQFileInfo {
  fileId: string;
  fileName: string;
  fileSize: number;
  localPath: string;
  receivedAt: number;
  senderId: number;
  groupId?: number;
  mimeType?: string;
}

/** QQ Tool parameters */
export interface QQToolParams {
  action: 'send_private_message' | 'send_group_message' | 'send_file';
  user_id?: number;
  group_id?: number;
  message?: string;
  file_path?: string;
  file_name?: string;
  end?: boolean;
}

/** Default QQ config */
export const DEFAULT_QQ_CONFIG: QQConfig = {
  enabled: false,
  mode: 'websocket-server',
  port: 3002,
  host: '0.0.0.0',
  autoFriendAccept: false,
  autoGroupInviteAccept: false,
  atRequiredInGroup: true,
  maxMessageLength: 2000,
  splitLongMessages: true,
  typingIndicator: false,
};

/** Simple message queue item */
export interface QueuedMessage {
  event: OneBotMessageEvent;
  ws?: WebSocket;
  timestamp: number;
}