/**
 * QQ Tool (Simplified)
 * AI-callable tool for sending QQ messages
 */

import type { QQAdapter } from './adapter.js';
import type { QQConfigManager } from './config.js';

export interface QQToolResult {
  success: boolean;
  message: string;
}

export function createQQTools(adapter: QQAdapter, _configManager: QQConfigManager) {
  return {
    type: 'function' as const,
    function: {
      name: 'qq',
      description: `Send messages to QQ users or groups.

ACTIONS:
- send_private_message: Send DM to a QQ user
- send_group_message: Send message to a QQ group

PARAMETERS:
- action: "send_private_message" | "send_group_message"
- user_id: QQ user ID (for private messages)
- group_id: QQ group ID (for group messages)
- message: Text content to send
- at: QQ user ID to @mention (optional, for group messages only)
- end: true/false - Whether to stop after sending (default: true)

AT PARAMETER:
- Use "at": 123456 to @ mention a specific user in group messages
- The at parameter is the numeric QQ ID of the user to mention

END PARAMETER:
- end=true (default): Stop conversation after sending
- end=false: Continue conversation for more actions

EXAMPLES:
Private: {"action":"send_private_message","user_id":123456,"message":"Hello","end":true}
Group: {"action":"send_group_message","group_id":789012,"message":"Hi everyone","end":true}
Group with @: {"action":"send_group_message","group_id":789012,"message":"Hello there","at":123456,"end":true}`,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['send_private_message', 'send_group_message'],
            description: 'Message type',
          },
          user_id: {
            type: 'number',
            description: 'QQ user ID for private messages',
          },
          group_id: {
            type: 'number',
            description: 'QQ group ID for group messages',
          },
          message: {
            type: 'string',
            description: 'Message content',
          },
          at: {
            type: 'number',
            description: 'QQ user ID to @mention (optional, for group messages only)',
          },
          end: {
            type: 'boolean',
            description: 'Stop after sending? Default: true',
            default: true,
          },
        },
        required: ['action', 'message'],
      },
    },
  };
}

export async function executeQQTool(
  adapter: QQAdapter,
  _configManager: QQConfigManager,
  params: {
    action: string;
    user_id?: number;
    group_id?: number;
    message?: string;
    at?: number;
    end?: boolean;
  }
): Promise<QQToolResult> {
  try {
    const result = await adapter.sendMessage({
      action: params.action,
      user_id: params.user_id,
      group_id: params.group_id,
      message: params.message || '',
      at: params.at,
    });

    if (result.includes('Error')) {
      return { success: false, message: result };
    }

    return { success: true, message: result };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Error: ${msg}` };
  }
}