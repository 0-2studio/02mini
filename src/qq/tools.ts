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
      description: `Send/receive messages and files to/from QQ users or groups.

ACTIONS:
- send_private_message: Send DM to a QQ user (requires user_id, NOT group_id)
- send_group_message: Send message to a QQ group (requires group_id, NOT user_id)
- send_file: Send a file to user or group
- receive_file: Download a received file to files/qq-uploads/
- list_pending_files: List files waiting to be received

IMPORTANT - ID PARAMETERS:
- send_private_message: ONLY use user_id, do NOT include group_id
- send_group_message: ONLY use group_id, do NOT include user_id
- user_id and group_id are MUTUALLY EXCLUSIVE

TEXT MESSAGES:
- action: "send_private_message" | "send_group_message"
- user_id (for private) OR group_id (for group) - NOT both
- message: Text content (can include CQ codes for @ mentions)

SEND FILE:
- action: "send_file"
- user_id (for private) OR group_id (for group)
- file_path: Absolute path to file
- file_name: Optional display name

RECEIVE FILE:
- action: "receive_file"
- file_id: The file ID from message or pending files list
- Files are saved to: files/qq-uploads/YYYY-MM-DD/

LIST PENDING FILES:
- action: "list_pending_files"
- Shows files sent by users that haven't been downloaded yet

@ MENTIONS (CQ CODE FORMAT):
- To @ mention someone, include [CQ:at,qq=xxx] in the message text, where xxx is the QQ user ID (QQ号)
- Example: "Hello [CQ:at,qq=123456], how are you?"
- The number after qq= MUST be the numeric QQ ID, not the nickname
- You can find the QQ ID from incoming messages (shown as "ID: xxx" in the sender info)

END PARAMETER:
- end=false: Continue for more actions (e.g., send message → read file → send another)
- end=true: Stop conversation after this action
- DEFAULT (omitted): Conversation continues - you can make more tool calls
- IMPORTANT: If you only need to send ONE message and are done, use end=true to stop

HOW TO END CONVERSATION AFTER SENDING MESSAGE:
- Option 1: Use end=true in the qq tool call → stops immediately
- Option 2: After sending, reply "NO" → stops conversation
- Option 3: Call the "stop" tool → stops conversation
- DO NOT send multiple messages to the same user for the same question

EXAMPLES:
Private message (then stop): {"action":"send_private_message","user_id":123456,"message":"Hello","end":true}
Group message (then stop): {"action":"send_group_message","group_id":789,"message":"Hello everyone","end":true}
With @ mention: {"action":"send_group_message","group_id":789,"message":"Hello [CQ:at,qq=456], how are you?","end":true}
Send file to group: {"action":"send_file","group_id":789,"file_path":"files/report.pdf","end":true}
Send file to user: {"action":"send_file","user_id":123456,"file_path":"files/report.pdf","end":true}
Receive file: {"action":"receive_file","file_id":"abc123","end":true}
List files: {"action":"list_pending_files","end":false}`,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['send_private_message', 'send_group_message', 'send_file', 'receive_file', 'list_pending_files'],
            description: 'Action type',
          },
          user_id: {
            type: 'number',
            description: 'QQ user ID',
          },
          group_id: {
            type: 'number',
            description: 'QQ group ID',
          },
          message: {
            type: 'string',
            description: 'Text message content (can include CQ codes like [CQ:at,qq=xxx] for @ mentions)',
          },
          file_path: {
            type: 'string',
            description: 'Path to file for send_file action. Can be relative (e.g., "files/report.pdf") or absolute (e.g., "/home/user/file.txt")',
          },
          file_name: {
            type: 'string',
            description: 'Display name for file (optional)',
          },
          file_id: {
            type: 'string',
            description: 'File ID for receive_file action',
          },
          end: {
            type: 'boolean',
            description: 'Stop after this action? Default: true',
            default: true,
          },
        },
        required: ['action'],
      },
    },
  };
}

// Validation helper function
function validateQQParams(params: {
  action: string;
  user_id?: number;
  group_id?: number;
  message?: string;
  file_path?: string;
  file_id?: string;
}): { valid: boolean; error?: string; help?: string } {
  // Check for missing user_id for private message
  if (params.action === 'send_private_message' && !params.user_id) {
    return {
      valid: false,
      error: 'Missing user_id for send_private_message',
      help: `CORRECT USAGE: {"action":"send_private_message","user_id":123456,"message":"Hello","end":true}
Note: For private messages, only user_id is required. Do NOT include group_id.`
    };
  }

  // Check for missing or invalid group_id for group message
  if (params.action === 'send_group_message') {
    if (!params.group_id) {
      return {
        valid: false,
        error: 'Missing group_id for send_group_message',
        help: `CORRECT USAGE: {"action":"send_group_message","group_id":123456,"message":"Hello","end":true}`
      };
    }
    if (params.group_id === 0) {
      return {
        valid: false,
        error: 'Invalid group_id: 0. group_id must be a valid positive number (> 0)',
        help: `CORRECT USAGE: {"action":"send_group_message","group_id":123456,"message":"Hello","end":true}
Note: group_id must be a positive number, not 0`
      };
    }
  }

  // Check for send_file - needs either user_id OR group_id
  if (params.action === 'send_file') {
    if (!params.user_id && !params.group_id) {
      return {
        valid: false,
        error: 'Missing user_id or group_id for send_file',
        help: `CORRECT USAGE: {"action":"send_file","group_id":123456,"file_path":"files/report.pdf","end":true} OR {"action":"send_file","user_id":123456,"file_path":"files/report.pdf","end":true}`
      };
    }
    // If group_id is provided, check it's valid
    if (params.group_id === 0) {
      return {
        valid: false,
        error: 'Invalid group_id: 0 for send_file',
        help: `CORRECT USAGE: {"action":"send_file","group_id":123456,"file_path":"files/report.pdf","end":true}`
      };
    }
  }

  // Check for missing message in text actions
  if ((params.action === 'send_private_message' || params.action === 'send_group_message') && !params.message) {
    const idField = params.action === 'send_private_message' ? 'user_id' : 'group_id';
    const idValue = params.action === 'send_private_message' ? params.user_id : params.group_id;
    return {
      valid: false,
      error: `Missing message for ${params.action}`,
      help: `CORRECT USAGE: {"action":"${params.action}","${idField}":${idValue || 123456},"message":"Your message here","end":true}`
    };
  }

  return { valid: true };
}

export async function executeQQTool(
  adapter: QQAdapter,
  _configManager: QQConfigManager,
  params: {
    action: string;
    user_id?: number;
    group_id?: number;
    message?: string;
    file_path?: string;
    file_name?: string;
    file_id?: string;
    end?: boolean;
  }
): Promise<QQToolResult> {
  try {
    // Validate parameters first
    const validation = validateQQParams(params);
    if (!validation.valid) {
      return {
        success: false,
        message: `ERROR: ${validation.error}\n\n${validation.help}\n\nPlease correct your parameters and try again.`
      };
    }

    // Special handling: if message is "NO", don't send anything (AI chooses not to reply)
    if ((params.action === 'send_private_message' || params.action === 'send_group_message') &&
        params.message?.trim() === 'NO') {
      return { success: true, message: '[No reply sent - AI chose not to respond]' };
    }

    // Handle receive_file action
    if (params.action === 'receive_file') {
      if (!params.file_id) {
        return { 
          success: false, 
          message: 'Error: file_id is required for receive_file\n\nCORRECT USAGE: {"action":"receive_file","file_id":"abc123","end":true}' 
        };
      }
      const fileInfo = await adapter.receiveFile(params.file_id);
      if (fileInfo) {
        return { success: true, message: `File received: ${fileInfo.fileName} (${fileInfo.fileSize} bytes) saved to ${fileInfo.localPath}` };
      } else {
        return { success: false, message: `Error: File not found or already received: ${params.file_id}` };
      }
    }

    // Handle list_pending_files action
    if (params.action === 'list_pending_files') {
      const pendingFiles = adapter.getPendingFiles();
      if (pendingFiles.length === 0) {
        return { success: true, message: 'No pending files to receive' };
      }
      const fileList = pendingFiles.map(f => `- ${f.fileName} (${f.fileSize} bytes) - ID: ${f.fileId}`).join('\n');
      return { success: true, message: `Pending files:\n${fileList}\n\nUse receive_file with file_id to download.` };
    }

    // Handle send actions
    const result = await adapter.sendMessage({
      action: params.action,
      user_id: params.user_id,
      group_id: params.group_id,
      message: params.message,
      file_path: params.file_path,
      file_name: params.file_name,
    });

    if (result.includes('Error')) {
      // Include helpful guidance in error messages
      return { 
        success: false, 
        message: `${result}\n\nIf you're having trouble, remember:\n- For groups: use group_id (positive number, not 0)\n- For private: use user_id\n- For @ mentions: include [CQ:at,qq=USER_ID] in message text\n\nExample: {"action":"send_group_message","group_id":123456,"message":"Hello [CQ:at,qq=789012], how are you?","end":true}`
      };
    }

    return { success: true, message: result };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { 
      success: false, 
      message: `Error: ${msg}\n\nQQ TOOL USAGE GUIDE:\n- send_group_message: requires group_id (positive number) and message\n- send_private_message: requires user_id and message\n- send_file: requires file_path and either user_id or group_id\n- Use [CQ:at,qq=USER_ID] in message text to @ mention someone`
    };
  }
}