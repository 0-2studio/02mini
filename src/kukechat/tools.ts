import type { KukeChatAdapter } from './adapter.js';
import type { KukeChatToolResult } from './types.js';

const actions = [
  'get_me',
  'list_conversations',
  'get_online_users',
  'get_user',
  'get_conversation',
  'get_conversation_members',
  'get_recent_messages',
  'get_messages_before',
  'get_messages_after',
  'catch_up_messages',
  'send_conversation_message',
  'send_direct_message',
  'send_direct_message_body',
  'reply_message',
  'mention_user',
  'mention_all',
  'send_markdown_message',
  'send_buttons',
  'send_menu',
  'send_link',
  'send_sticker',
  'upload_image',
  'send_image',
  'send_image_url',
  'upload_voice',
  'send_voice',
  'recall_message',
  'update_button',
  'toggle_reaction',
  'delete_reaction',
] as const;

export function createKukeChatTool() {
  return {
    type: 'function' as const,
    function: {
      name: 'kukechat',
      description: `KukeChat Bot API tool. Supports runtime queries, sending text/markdown/elements, uploads, reactions, recall, button updates, and reconnect catch-up.

Key actions:
- Query: get_me, list_conversations, get_online_users, get_user, get_conversation, get_conversation_members, get_recent_messages, get_messages_before, get_messages_after, catch_up_messages
- Send: send_conversation_message, send_direct_message, send_direct_message_body, reply_message, mention_user, mention_all, send_markdown_message, send_buttons, send_menu, send_link, send_sticker
- Media: upload_image, send_image, send_image_url, upload_voice, send_voice
- Manage: recall_message, update_button, toggle_reaction, delete_reaction

Use KukeChat elements when useful: <quote id="..."/>, <at id="..."/>, <at_all/>, <markdown>...</markdown>, <img src="..."/>, <audio src="..." duration_ms="..."/>, <sticker src="..."/>, <button action="callback" action_id="...">...</button>.
For quoted replies prefer action=reply_message. Do not include a leading <quote .../> inside markdown/buttons/menu content.`,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...actions] },
          conversation_id: { type: 'number' },
          user_id: { type: 'number' },
          message_id: { type: 'number' },
          before_id: { type: 'number' },
          after_id: { type: 'number' },
          limit: { type: 'number' },
          message: { type: 'string' },
          markdown: { type: 'string' },
          file_path: { type: 'string' },
          image_url: { type: 'string' },
          voice_url: { type: 'string' },
          sticker_url: { type: 'string' },
          duration_ms: { type: 'number' },
          link_href: { type: 'string' },
          link_label: { type: 'string' },
          component_id: { type: 'string' },
          label: { type: 'string' },
          variant: { type: 'string', enum: ['default', 'success', 'danger', 'warning', 'primary'] },
          disabled: { type: 'boolean' },
          scope: { type: 'string', enum: ['global', 'user'] },
          emoji: { type: 'string' },
          buttons: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                action: { type: 'string', enum: ['input', 'callback'] },
                action_id: { type: 'string' },
                value: { type: 'string' },
              },
            },
          },
          end: { type: 'boolean', default: true },
        },
        required: ['action'],
      },
    },
  };
}

interface KukeChatParams {
  action: string;
  conversation_id?: number;
  user_id?: number;
  message_id?: number;
  before_id?: number;
  after_id?: number;
  limit?: number;
  message?: string;
  markdown?: string;
  file_path?: string;
  image_url?: string;
  voice_url?: string;
  sticker_url?: string;
  duration_ms?: number;
  link_href?: string;
  link_label?: string;
  component_id?: string;
  label?: string;
  variant?: string;
  disabled?: boolean;
  scope?: 'global' | 'user';
  emoji?: string;
  buttons?: Array<{ id?: string; label: string; action: 'input' | 'callback'; action_id?: string; value?: string }>;
}

export async function executeKukeChatTool(adapter: KukeChatAdapter, params: KukeChatParams): Promise<KukeChatToolResult> {
  try {
    const result = await execute(adapter, params);
    return { success: true, message: typeof result === 'string' ? result : JSON.stringify(result) };
  } catch (error) {
    return { success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function execute(adapter: KukeChatAdapter, p: KukeChatParams): Promise<unknown> {
  switch (p.action) {
    case 'get_me': return adapter.getMe();
    case 'list_conversations': return adapter.listConversations();
    case 'get_online_users': return adapter.getOnlineUsers();
    case 'get_user': return adapter.getUser(requiredNumber(p.user_id, 'user_id'));
    case 'get_conversation': return adapter.getConversation(requiredNumber(p.conversation_id, 'conversation_id'));
    case 'get_conversation_members': return adapter.getConversationMembers(requiredNumber(p.conversation_id, 'conversation_id'));
    case 'get_recent_messages': return adapter.getMessages(requiredNumber(p.conversation_id, 'conversation_id'), { limit: p.limit });
    case 'get_messages_before': return adapter.getMessages(requiredNumber(p.conversation_id, 'conversation_id'), { before_id: requiredNumber(p.before_id, 'before_id'), limit: p.limit });
    case 'get_messages_after': return adapter.getMessages(requiredNumber(p.conversation_id, 'conversation_id'), { after_id: requiredNumber(p.after_id, 'after_id'), limit: p.limit });
    case 'catch_up_messages': {
      const conversationId = requiredNumber(p.conversation_id, 'conversation_id');
      const afterId = p.after_id ?? adapter.getLastMessageId(conversationId);
      if (!afterId) throw new Error('after_id is required when no last message id is known');
      return adapter.getMessages(conversationId, { after_id: afterId, limit: p.limit });
    }
    case 'send_conversation_message': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), requiredString(p.message, 'message'));
    case 'send_direct_message': return adapter.sendDirectMessage(requiredNumber(p.user_id, 'user_id'), requiredString(p.message, 'message'));
    case 'send_direct_message_body': return adapter.sendDirectMessageBody(requiredNumber(p.user_id, 'user_id'), requiredString(p.message, 'message'));
    case 'reply_message': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<quote id="${requiredNumber(p.message_id, 'message_id')}"/> ${requiredString(p.message, 'message')}`);
    case 'mention_user': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<at id="${requiredNumber(p.user_id, 'user_id')}"/> ${requiredString(p.message, 'message')}`);
    case 'mention_all': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<at_all/> ${requiredString(p.message, 'message')}`);
    case 'send_markdown_message': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<markdown>${stripLeadingQuoteElements(requiredString(p.markdown ?? p.message, 'markdown'))}</markdown>`);
    case 'send_buttons': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<markdown>${stripLeadingQuoteElements(requiredString(p.markdown ?? p.message, 'markdown'))}\n${renderButtons(p.buttons)}</markdown>`);
    case 'send_menu': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<markdown>## ${escapeElementText(p.label || 'Menu')}\n${stripLeadingQuoteElements(requiredString(p.message ?? p.markdown, 'message'))}\n${renderButtons(p.buttons)}</markdown>`);
    case 'send_link': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<link href="${requiredString(p.link_href, 'link_href')}">${escapeElementText(requiredString(p.link_label, 'link_label'))}</link>`);
    case 'send_sticker': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<sticker src="${requiredString(p.sticker_url, 'sticker_url')}"/>`);
    case 'upload_image': return adapter.uploadImage(requiredString(p.file_path, 'file_path'));
    case 'send_image': {
      const uploaded = await adapter.uploadImage(requiredString(p.file_path, 'file_path')) as { url?: string };
      if (!uploaded.url) throw new Error('upload_image response did not include url');
      return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<img src="${uploaded.url}"/>`);
    }
    case 'send_image_url': return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<img src="${requiredString(p.image_url, 'image_url')}"/>`);
    case 'upload_voice': return adapter.uploadVoice(requiredString(p.file_path, 'file_path'));
    case 'send_voice': {
      const uploaded = p.voice_url ? { url: p.voice_url } : await adapter.uploadVoice(requiredString(p.file_path, 'file_path')) as { url?: string };
      if (!uploaded.url) throw new Error('voice upload response did not include url');
      return adapter.sendConversationMessage(requiredNumber(p.conversation_id, 'conversation_id'), `<audio src="${uploaded.url}" duration_ms="${p.duration_ms ?? 0}"/>`);
    }
    case 'recall_message': return adapter.recallMessage(requiredNumber(p.conversation_id, 'conversation_id'), requiredNumber(p.message_id, 'message_id'));
    case 'update_button': return adapter.updateButton(requiredNumber(p.conversation_id, 'conversation_id'), requiredNumber(p.message_id, 'message_id'), requiredString(p.component_id, 'component_id'), compact({ label: p.label, variant: p.variant, disabled: p.disabled, scope: p.scope, user_id: p.user_id }));
    case 'toggle_reaction': return adapter.toggleReaction(requiredNumber(p.conversation_id, 'conversation_id'), requiredNumber(p.message_id, 'message_id'), requiredString(p.emoji, 'emoji'));
    case 'delete_reaction': return adapter.deleteReaction(requiredNumber(p.conversation_id, 'conversation_id'), requiredNumber(p.message_id, 'message_id'), requiredString(p.emoji, 'emoji'));
    default: throw new Error(`unknown KukeChat action: ${p.action}`);
  }
}

function requiredString(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredNumber(value: number | undefined, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} is required`);
  return value as number;
}

function renderButtons(buttons?: KukeChatParams['buttons']): string {
  if (!buttons?.length) return '';
  return buttons.map(button => {
    const id = button.id ? ` id="${escapeAttribute(button.id)}"` : '';
    const actionId = button.action_id ? ` action_id="${escapeAttribute(button.action_id)}"` : '';
    const value = button.value ? ` value="${escapeAttribute(button.value)}"` : '';
    return `<button${id} action="${button.action}"${actionId}${value}>${escapeElementText(button.label)}</button>`;
  }).join(' ');
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeElementText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripLeadingQuoteElements(value: string): string {
  return value.replace(/^(?:\s*<quote\s+[^>]*id=["'][^"']+["'][^>]*\/?>\s*)+/i, '').trimStart();
}
