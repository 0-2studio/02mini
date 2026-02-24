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
- send_private_message: Send DM to a QQ user
- send_group_message: Send message to a QQ group
- send_file: Send a file (document, image, video, etc.) to user or group
- receive_file: Download a received file to files/qq-uploads/
- list_pending_files: List files waiting to be received

TEXT MESSAGES:
- action: "send_private_message" | "send_group_message"
- user_id or group_id
- message: Text content (can include CQ codes for @ mentions, see below)

SEND FILE:
- action: "send_file"
- user_id or group_id
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
- This format is automatically converted to QQ's native @ mention

END PARAMETER:
- end=true (default): Stop conversation
- end=false: Continue for more actions

EXAMPLES:
Send text: {"action":"send_group_message","group_id":123,"message":"Hello everyone","end":true}
With @ mention: {"action":"send_group_message","group_id":123,"message":"Hello [CQ:at,qq=456789], how are you?","end":true}
  - Note: 456789 is the QQ user ID you want to @
Send file: {"action":"send_file","group_id":123,"file_path":"files/report.pdf","end":true}
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
    // Handle receive_file action
    if (params.action === 'receive_file') {
      if (!params.file_id) {
        return { success: false, message: 'Error: file_id is required for receive_file' };
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
      return { success: false, message: result };
    }

    return { success: true, message: result };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Error: ${msg}` };
  }
}