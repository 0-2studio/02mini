/**
 * 02mini Web UI Application
 * Material Design 3 Chat Interface
 */

class ChatApp {
  constructor() {
    this.messages = [];
    this.attachedFiles = [];
    this.conversationId = this.generateId();
    this.isStreaming = false;
    this.tokenCount = 0;
    
    this.initElements();
    this.initEventListeners();
    this.loadSettings();
  }

  initElements() {
    this.elements = {
      messagesArea: document.getElementById('messages-area'),
      welcomeScreen: document.getElementById('welcome-screen'),
      messageInput: document.getElementById('message-input'),
      sendBtn: document.getElementById('send-btn'),
      attachBtn: document.getElementById('attach-btn'),
      fileInput: document.getElementById('file-input'),
      attachedFiles: document.getElementById('attached-files'),
      clearBtn: document.getElementById('clear-btn'),
      settingsBtn: document.getElementById('settings-btn'),
      tokenCounter: document.getElementById('token-counter'),
      tokenCount: document.getElementById('token-count'),
      toastContainer: document.getElementById('toast-container'),
      appTitle: document.getElementById('app-title-text'),
    };
  }

  initEventListeners() {
    // Send message
    this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
    
    // Input enter key
    this.elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    // Auto-resize textarea
    this.elements.messageInput.addEventListener('input', () => {
      this.autoResizeTextarea();
    });
    
    // File attachment
    this.elements.attachBtn.addEventListener('click', () => {
      this.elements.fileInput.click();
    });
    
    this.elements.fileInput.addEventListener('change', (e) => {
      this.handleFileSelect(e.target.files);
    });
    
    // Clear conversation
    this.elements.clearBtn.addEventListener('click', () => {
      this.clearConversation();
    });
    
    // Settings
    this.elements.settingsBtn.addEventListener('click', () => {
      this.showSettings();
    });
    
    // Drag and drop
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        this.handleFileSelect(e.dataTransfer.files);
      }
    });
  }

  loadSettings() {
    // Load from localStorage or use defaults
    const settings = JSON.parse(localStorage.getItem('02mini-settings') || '{}');
    this.settings = {
      title: settings.title || '02mini Chat',
      theme: settings.theme || 'auto',
      showTokenCount: settings.showTokenCount !== false,
      enableFileUpload: settings.enableFileUpload !== false,
      apiUrl: settings.apiUrl || '',
      authToken: settings.authToken || '',
    };
    
    this.elements.appTitle.textContent = this.settings.title;
    this.elements.tokenCounter.style.display = this.settings.showTokenCount ? 'block' : 'none';
    
    // Apply theme
    this.applyTheme(this.settings.theme);
  }

  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.style.colorScheme = 'dark';
    } else if (theme === 'light') {
      document.documentElement.style.colorScheme = 'light';
    } else {
      document.documentElement.style.colorScheme = 'light dark';
    }
  }

  autoResizeTextarea() {
    const textarea = this.elements.messageInput;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async handleFileSelect(files) {
    if (!this.settings.enableFileUpload) {
      this.showToast('文件上传已禁用', 'error');
      return;
    }
    
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = [
      'text/plain', 'text/markdown', 'application/pdf',
      'image/jpeg', 'image/png', 'image/gif'
    ];
    
    for (const file of files) {
      if (file.size > maxFileSize) {
        this.showToast(`文件 ${file.name} 超过 10MB 限制`, 'error');
        continue;
      }
      
      if (!allowedTypes.includes(file.type) && !file.name.match(/\.(txt|md|pdf|jpg|jpeg|png|gif)$/i)) {
        this.showToast(`文件类型 ${file.type} 不支持`, 'error');
        continue;
      }
      
      // Read file as base64
      const reader = new FileReader();
      reader.onload = (e) => {
        const fileData = {
          id: this.generateId(),
          name: file.name,
          type: file.type,
          size: file.size,
          data: e.target.result.split(',')[1], // Remove data URL prefix
        };
        
        this.attachedFiles.push(fileData);
        this.updateAttachedFilesPreview();
      };
      reader.readAsDataURL(file);
    }
    
    // Clear file input
    this.elements.fileInput.value = '';
  }

  updateAttachedFilesPreview() {
    const container = this.elements.attachedFiles;
    
    if (this.attachedFiles.length === 0) {
      container.style.display = 'none';
      return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = this.attachedFiles.map(file => `
      <div class="attachment-preview" data-file-id="${file.id}">
        <span class="material-symbols-rounded">${this.getFileIcon(file.type)}</span>
        <span>${this.truncateFileName(file.name)}</span>
        <span class="material-symbols-rounded remove-btn" onclick="app.removeFile('${file.id}')">close</span>
      </div>
    `).join('');
  }

  removeFile(fileId) {
    this.attachedFiles = this.attachedFiles.filter(f => f.id !== fileId);
    this.updateAttachedFilesPreview();
  }

  getFileIcon(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf') return 'picture_as_pdf';
    return 'description';
  }

  truncateFileName(name, maxLength = 20) {
    if (name.length <= maxLength) return name;
    return name.substr(0, maxLength - 3) + '...';
  }

  async sendMessage() {
    const content = this.elements.messageInput.value.trim();
    
    if (!content && this.attachedFiles.length === 0) return;
    if (this.isStreaming) return;
    
    // Hide welcome screen
    this.elements.welcomeScreen.style.display = 'none';
    
    // Create user message
    const userMessage = {
      id: this.generateId(),
      role: 'user',
      content: content,
      timestamp: Date.now(),
      files: [...this.attachedFiles],
    };
    
    this.messages.push(userMessage);
    this.renderMessage(userMessage);
    
    // Clear input
    this.elements.messageInput.value = '';
    this.elements.messageInput.style.height = 'auto';
    
    // Clear attached files
    this.attachedFiles = [];
    this.updateAttachedFilesPreview();
    
    // Scroll to bottom
    this.scrollToBottom();
    
    // Send to API
    await this.sendToAPI(userMessage);
  }

  renderMessage(message, isStreaming = false) {
    const isUser = message.role === 'user';
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.role}`;
    messageEl.id = `msg-${message.id}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    
    const avatar = isUser ? 'person' : 'smart_toy';
    const filesHtml = message.files?.length ? `
      <div class="message-files">
        ${message.files.map(file => `
          <div class="file-chip">
            <span class="material-symbols-rounded">${this.getFileIcon(file.type)}</span>
            <span>${file.name}</span>
          </div>
        `).join('')}
      </div>
    ` : '';
    
    messageEl.innerHTML = `
      <div class="message-avatar">
        <span class="material-symbols-rounded">${avatar}</span>
      </div>
      <div class="message-content">
        <div class="message-bubble">${this.escapeHtml(message.content)}${isStreaming ? '<span class="cursor">▋</span>' : ''}</div>
        ${filesHtml}
        <div class="message-time">${time}</div>
      </div>
    `;
    
    this.elements.messagesArea.appendChild(messageEl);
  }

  updateStreamingMessage(messageId, content) {
    const messageEl = document.getElementById(`msg-${messageId}`);
    if (messageEl) {
      const bubble = messageEl.querySelector('.message-bubble');
      bubble.innerHTML = this.escapeHtml(content) + '<span class="cursor">▋</span>';
    }
    this.scrollToBottom();
  }

  finalizeStreamingMessage(messageId, content) {
    const messageEl = document.getElementById(`msg-${messageId}`);
    if (messageEl) {
      const bubble = messageEl.querySelector('.message-bubble');
      bubble.innerHTML = this.escapeHtml(content);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async sendToAPI(userMessage) {
    this.isStreaming = true;
    this.elements.sendBtn.disabled = true;
    
    // Show loading
    const loadingId = this.showLoading();
    
    try {
      const apiUrl = this.settings.apiUrl || window.location.origin;
      const headers = {
        'Content-Type': 'application/json',
      };
      
      if (this.settings.authToken) {
        headers['Authorization'] = `Bearer ${this.settings.authToken}`;
      }
      
      // Build messages array from conversation history
      const messages = this.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
      
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: messages,
          sessionId: this.conversationId,
          stream: true,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Remove loading
      this.hideLoading(loadingId);
      
      // Create AI message container
      const aiMessageId = this.generateId();
      const aiMessage = {
        id: aiMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      
      this.messages.push(aiMessage);
      this.renderMessage(aiMessage, true);
      
      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      
      console.log('[app] Starting to read stream...');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[app] Stream done');
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            
            if (data === '[DONE]') {
              console.log('[app] Received [DONE]');
              continue;
            }
            
            try {
              const parsed = JSON.parse(data);
              console.log('[app] Parsed:', parsed);
              
              if (parsed.content) {
                fullContent += parsed.content;
                this.updateStreamingMessage(aiMessageId, fullContent);
              }
              
              if (parsed.usage) {
                this.tokenCount += parsed.usage.totalTokens || 0;
                this.updateTokenCount();
              }
            } catch (e) {
              console.error('[app] Parse error:', e, 'data:', data);
            }
          }
        }
      }
      
      // Process any remaining data in buffer
      if (buffer.trim()) {
        console.log('[app] Processing remaining buffer:', buffer);
        const lines = buffer.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data && data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  fullContent += parsed.content;
                }
              } catch (e) {
                console.error('[app] Final parse error:', e);
              }
            }
          }
        }
      }
      
      console.log('[app] Final content length:', fullContent.length);
      
      // Finalize message
      aiMessage.content = fullContent;
      this.finalizeStreamingMessage(aiMessageId, fullContent);
      
    } catch (error) {
      this.hideLoading(loadingId);
      console.error('Error:', error);
      
      // Provide more detailed error message
      let errorMsg = '发送消息失败';
      if (error.message === 'Failed to fetch') {
        errorMsg = '无法连接到服务器，请检查：\n1. 后端服务是否已启动 (运行: node dist/cli/index.js start)\n2. 浏览器地址栏是否为 http://localhost:18789';
      } else {
        errorMsg = error.message;
      }
      
      this.showToast(errorMsg, 'error');
      
      // Add error message
      const errorMessage = {
        id: this.generateId(),
        role: 'assistant',
        content: '⚠️ ' + errorMsg,
        timestamp: Date.now(),
      };
      this.messages.push(errorMessage);
      this.renderMessage(errorMessage);
    } finally {
      this.isStreaming = false;
      this.elements.sendBtn.disabled = false;
      this.scrollToBottom();
    }
  }

  showLoading() {
    const id = this.generateId();
    const loadingEl = document.createElement('div');
    loadingEl.className = 'message ai loading-indicator';
    loadingEl.id = `loading-${id}`;
    loadingEl.innerHTML = `
      <div class="message-avatar">
        <span class="material-symbols-rounded">smart_toy</span>
      </div>
      <div class="loading-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
    this.elements.messagesArea.appendChild(loadingEl);
    this.scrollToBottom();
    return id;
  }

  hideLoading(id) {
    const loadingEl = document.getElementById(`loading-${id}`);
    if (loadingEl) {
      loadingEl.remove();
    }
  }

  scrollToBottom() {
    this.elements.messagesArea.scrollTop = this.elements.messagesArea.scrollHeight;
  }

  updateTokenCount() {
    this.elements.tokenCount.textContent = this.tokenCount.toLocaleString();
  }

  clearConversation() {
    if (this.messages.length === 0) return;
    
    if (confirm('确定要清空所有对话吗？')) {
      this.messages = [];
      this.conversationId = this.generateId();
      this.tokenCount = 0;
      this.updateTokenCount();
      
      // Clear messages area except welcome screen
      this.elements.messagesArea.innerHTML = '';
      this.elements.messagesArea.appendChild(this.elements.welcomeScreen);
      this.elements.welcomeScreen.style.display = 'flex';
      
      this.showToast('对话已清空');
    }
  }

  showSettings() {
    const settingsHtml = `
      <div style="padding: 20px; max-width: 400px;">
        <h2 style="margin-bottom: 20px; font: var(--md-sys-typescale-headline-small);">设置</h2>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant);">应用标题</label>
          <input type="text" id="setting-title" value="${this.settings.title}" 
            style="width: 100%; padding: 12px; border: 1px solid var(--md-sys-color-outline); border-radius: 8px; background: var(--md-sys-color-surface);">
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant);">主题</label>
          <select id="setting-theme" 
            style="width: 100%; padding: 12px; border: 1px solid var(--md-sys-color-outline); border-radius: 8px; background: var(--md-sys-color-surface);">
            <option value="auto" ${this.settings.theme === 'auto' ? 'selected' : ''}>自动</option>
            <option value="light" ${this.settings.theme === 'light' ? 'selected' : ''}>浅色</option>
            <option value="dark" ${this.settings.theme === 'dark' ? 'selected' : ''}>深色</option>
          </select>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant);">API 地址 (可选)</label>
          <input type="text" id="setting-apiurl" value="${this.settings.apiUrl}" placeholder="http://localhost:18789"
            style="width: 100%; padding: 12px; border: 1px solid var(--md-sys-color-outline); border-radius: 8px; background: var(--md-sys-color-surface);">
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant);">认证 Token (可选)</label>
          <input type="password" id="setting-token" value="${this.settings.authToken}" 
            style="width: 100%; padding: 12px; border: 1px solid var(--md-sys-color-outline); border-radius: 8px; background: var(--md-sys-color-surface);">
        </div>
        
        <div style="display: flex; gap: 8px; margin-top: 24px;">
          <button onclick="app.saveSettings()" 
            style="flex: 1; padding: 12px; background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); border: none; border-radius: 20px; cursor: pointer;">保存</button>
          <button onclick="this.closest('.toast').remove()" 
            style="flex: 1; padding: 12px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); border: none; border-radius: 20px; cursor: pointer;">取消</button>
        </div>
      </div>
    `;
    
    this.showToast(settingsHtml, 'info', 0);
  }

  saveSettings() {
    const title = document.getElementById('setting-title').value;
    const theme = document.getElementById('setting-theme').value;
    const apiUrl = document.getElementById('setting-apiurl').value;
    const authToken = document.getElementById('setting-token').value;
    
    this.settings = {
      ...this.settings,
      title,
      theme,
      apiUrl,
      authToken,
    };
    
    localStorage.setItem('02mini-settings', JSON.stringify(this.settings));
    
    // Apply changes
    this.elements.appTitle.textContent = title;
    this.applyTheme(theme);
    
    // Close settings dialog
    const toast = document.querySelector('.toast');
    if (toast) toast.remove();
    
    this.showToast('设置已保存');
  }

  showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    
    this.elements.toastContainer.appendChild(toast);
    
    if (duration > 0) {
      setTimeout(() => {
        toast.remove();
      }, duration);
    }
  }
}

// Initialize app
const app = new ChatApp();
