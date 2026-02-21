# 02mini 完全实现 OpenClaw 指南

## 🎯 当前状态

已完成基础架构：
- ✅ 完整 Zod Schema 配置系统
- ✅ JSON5 + $include + 环境变量支持
- ✅ Web UI (Material Design 3)
- ✅ 基础 AI 集成

## 📦 完整实现清单

### 1. 配置系统 ✅

文件：`src/config/schema.ts`, `src/config/loader.ts`

状态：已完成完整的 Zod Schema，支持：
- 所有 OpenClaw 配置项
- 环境变量替换 ${VAR}
- JSON5 解析
- $include 文件包含
- 类型验证

### 2. CLI 命令系统

需要实现 30+ 命令：

#### 核心命令 (src/cli/commands/core/)
```typescript
// setup.ts - 初始化配置和工作空间
export function registerSetupCommand(program: Command) {
  program
    .command("setup")
    .description("Initialize local config and agent workspace")
    .action(async () => {
      // 1. 检查现有配置
      // 2. 创建配置目录 ~/.02mini
      // 3. 生成默认配置
      // 4. 创建工作空间
      // 5. 设置权限
    });
}

// onboard.ts - 交互式向导
export function registerOnboardCommand(program: Command) {
  program
    .command("onboard")
    .description("Interactive onboarding wizard")
    .action(async () => {
      // 1. 欢迎界面
      // 2. AI 配置 (选择提供者，输入API key)
      // 3. 通道配置 (启用哪些通道)
      // 4. 安全配置 (认证方式)
      // 5. 完成总结
    });
}

// doctor.ts - 健康检查
export function registerDoctorCommand(program: Command) {
  program
    .command("doctor")
    .description("Health checks and quick fixes")
    .action(async () => {
      // 检查清单:
      // - [ ] 配置文件有效
      // - [ ] 依赖项安装
      // - [ ] AI provider 可连接
      // - [ ] 通道配置有效
      // - [ ] 端口可用
      // - [ ] 权限正确
      // 自动修复常见问题
    });
}
```

#### 消息命令 (src/cli/commands/messaging/)
```typescript
// message.ts - 消息管理
export function registerMessageCommands(program: Command) {
  const msg = program.command("message").description("Send and manage messages");
  
  msg.command("send")
    .option("--channel <channel>", "Target channel")
    .option("--to <recipient>", "Recipient ID")
    .argument("<content>", "Message content")
    .action(async (content, options) => {
      // 发送到指定通道
    });
    
  msg.command("list")
    .option("--channel <channel>", "Filter by channel")
    .action(async (options) => {
      // 列出最近消息
    });
}

// channels.ts - 通道管理
export function registerChannelsCommand(program: Command) {
  const ch = program.command("channels").description("Manage chat channels");
  
  ch.command("list").action(async () => {
    // 列出所有通道状态
  });
  
  ch.command("enable <channel>").action(async (channel) => {
    // 启用通道
  });
  
  ch.command("disable <channel>").action(async (channel) => {
    // 禁用通道
  });
  
  ch.command("status <channel>").action(async (channel) => {
    // 显示通道健康状态
  });
}
```

#### 网关命令 (src/cli/commands/gateway/)
```typescript
// gateway.ts
export function registerGatewayCommands(program: Command) {
  const gw = program.command("gateway").description("Manage gateway server");
  
  gw.command("start")
    .option("--bind <mode>", "Bind mode: loopback|lan|tailnet|auto")
    .option("--port <port>", "Port number")
    .option("--daemon", "Run as daemon")
    .action(async (options) => {
      // 1. 加载配置
      // 2. 验证依赖
      // 3. 初始化通道
      // 4. 启动网关服务器
      // 5. (可选) 守护进程模式
    });
    
  gw.command("stop").action(async () => {
    // 停止网关服务
  });
  
  gw.command("restart").action(async () => {
    // 重启网关
  });
  
  gw.command("status").action(async () => {
    // 显示网关状态
  });
  
  gw.command("logs")
    .option("--follow", "Follow logs")
    .option("--lines <n>", "Number of lines")
    .action(async (options) => {
      // 显示/跟踪日志
    });
}
```

### 3. 通道系统

#### 通道基类 (src/channels/base.ts)
```typescript
export abstract class Channel {
  abstract readonly type: string;
  abstract readonly isConnected: boolean;
  protected config: ChannelConfig;
  protected messageHandler?: MessageHandler;

  constructor(config: ChannelConfig) {
    this.config = config;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendMessage(to: string, content: string, options?: SendOptions): Promise<void>;

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  protected async handleMessage(message: ChannelMessage): Promise<void> {
    // 应用策略
    if (!this.shouldProcessMessage(message)) {
      return;
    }
    
    if (this.messageHandler) {
      await this.messageHandler(message);
    }
  }

  private shouldProcessMessage(message: ChannelMessage): boolean {
    // 检查 DM 策略
    if (message.chatType === "dm" && this.config.dmPolicy === "disabled") {
      return false;
    }
    
    // 检查群组策略
    if (message.chatType === "group" && this.config.groupPolicy === "disabled") {
      return false;
    }
    
    // 检查 allowlist
    if (this.config.allowedUsers && !this.config.allowedUsers.includes(message.senderId)) {
      return false;
    }
    
    return true;
  }
}
```

#### Telegram 通道 (src/channels/telegram.ts)
```typescript
import { Bot } from "grammy";

export class TelegramChannel extends Channel {
  readonly type = "telegram";
  isConnected = false;
  private bot: Bot;

  constructor(config: TelegramConfig) {
    super(config);
    this.bot = new Bot(config.botToken);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.on("message:text", async (ctx) => {
      await this.handleMessage({
        id: String(ctx.message.message_id),
        channelType: "telegram",
        senderId: String(ctx.from?.id),
        senderName: ctx.from?.username || ctx.from?.first_name,
        chatId: String(ctx.chat.id),
        chatType: ctx.chat.type === "private" ? "dm" : "group",
        content: ctx.message.text,
        timestamp: ctx.message.date * 1000,
      });
    });
  }

  async start(): Promise<void> {
    await this.bot.start();
    this.isConnected = true;
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    this.isConnected = false;
  }

  async sendMessage(to: string, content: string): Promise<void> {
    await this.bot.api.sendMessage(to, content);
  }
}
```

#### Discord 通道 (src/channels/discord.ts)
```typescript
import { Client, GatewayIntentBits } from "discord.js";

export class DiscordChannel extends Channel {
  readonly type = "discord";
  isConnected = false;
  private client: Client;

  constructor(config: DiscordConfig) {
    super(config);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.client.on("messageCreate", async (message) => {
      if (message.author.bot) return;
      
      await this.handleMessage({
        id: message.id,
        channelType: "discord",
        senderId: message.author.id,
        senderName: message.author.username,
        chatId: message.channel.id,
        chatType: message.channel.isDMBased() ? "dm" : "group",
        content: message.content,
        timestamp: message.createdTimestamp,
      });
    });
  }

  async start(): Promise<void> {
    await this.client.login(this.config.botToken);
    this.isConnected = true;
  }

  async stop(): Promise<void> {
    this.client.destroy();
    this.isConnected = false;
  }

  async sendMessage(to: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(to);
    if (channel?.isTextBased()) {
      await channel.send(content);
    }
  }
}
```

### 4. AI 提供者系统

#### 提供者基类 (src/ai/base.ts)
```typescript
export interface AiProvider {
  readonly type: string;
  readonly model: string;
  
  chat(messages: Message[], options?: ChatOptions): Promise<AiResponse>;
  chatStream(messages: Message[], onChunk: (chunk: string) => void, options?: ChatOptions): Promise<AiResponse>;
  validate(): Promise<boolean>;
  listModels?(): Promise<string[]>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  stream?: boolean;
}
```

#### OpenAI 提供者 (src/ai/openai.ts)
```typescript
export class OpenAIProvider implements AiProvider {
  readonly type = "openai";
  private apiKey: string;
  private baseUrl: string;
  
  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
    this.model = config.model;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<AiResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.formatMessages(messages),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        tools: options?.tools,
      }),
    });

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
    };
  }

  async chatStream(messages: Message[], onChunk: (chunk: string) => void): Promise<AiResponse> {
    // 实现流式响应
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.formatMessages(messages),
        stream: true,
      }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      // 解析 SSE 格式
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          
          const parsed = JSON.parse(data);
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onChunk(content);
          }
        }
      }
    }

    return { content: fullContent };
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { "Authorization": `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

### 5. 工具系统

#### 工具基类 (src/tools/base.ts)
```typescript
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  sessionId: string;
  workspace: string;
  config: MiniConfig;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

#### Bash 工具 (src/tools/bash.ts)
```typescript
export const BashTool: Tool = {
  name: "bash",
  description: "Execute shell commands",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to execute" },
      timeout: { type: "number", description: "Timeout in milliseconds" },
    },
    required: ["command"],
  },
  
  async execute(args, context): Promise<ToolResult> {
    const { command, timeout = 30000 } = args;
    
    // 安全检查
    if (context.config.tools?.bash?.requireApproval) {
      const approved = await requestApproval(`Execute: ${command}`);
      if (!approved) {
        return { success: false, error: "User denied execution" };
      }
    }
    
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(command as string, {
        timeout: timeout as number,
        cwd: context.workspace,
      });
      
      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
```

### 6. 内存系统 (src/memory/)

```typescript
// vector.ts - 向量搜索
import { open } from "sqlite";
import sqlite3 from "sqlite3";

export class VectorMemory {
  private db: Database;
  private embeddingProvider: AiProvider;

  async initialize(): Promise<void> {
    this.db = await open({
      filename: this.config.path || "~/.02mini/memory.db",
      driver: sqlite3.Database,
    });

    // 创建表
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT,
        embedding BLOB,
        metadata TEXT,
        timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp);
    `);
  }

  async add(content: string, metadata?: Record<string, unknown>): Promise<void> {
    // 生成嵌入向量
    const embedding = await this.generateEmbedding(content);
    
    await this.db.run(
      `INSERT INTO memories (id, content, embedding, metadata, timestamp) 
       VALUES (?, ?, ?, ?, ?)`,
      [generateId(), content, JSON.stringify(embedding), JSON.stringify(metadata), Date.now()]
    );
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    
    // 计算余弦相似度
    const memories = await this.db.all<MemoryEntry[]>("SELECT * FROM memories");
    
    return memories
      .map((m) => ({
        ...m,
        similarity: cosineSimilarity(queryEmbedding, JSON.parse(m.embedding as string)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // 使用 OpenAI 或本地模型生成嵌入
    // ...
  }
}
```

### 7. 网关服务器 (src/gateway/server.ts)

```typescript
export class GatewayServer {
  private app: express.Application;
  private wsServer?: WebSocketServer;
  private channels: Map<string, Channel> = new Map();
  private aiProvider: AiProvider;
  private sessionManager: SessionManager;

  async start(): Promise<void> {
    // 1. 初始化 Express
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();

    // 2. 初始化通道
    await this.initializeChannels();

    // 3. 启动服务器
    const server = http.createServer(this.app);
    this.wsServer = new WebSocketServer({ server });
    
    server.listen(this.config.gateway.port, () => {
      console.log(`Gateway running on port ${this.config.gateway.port}`);
    });
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        channels: Array.from(this.channels.values()).map((c) => ({
          type: c.type,
          connected: c.isConnected,
        })),
      });
    });

    // 聊天端点
    this.app.post("/v1/chat/completions", async (req, res) => {
      const { messages, stream, tools } = req.body;
      
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        
        await this.aiProvider.chatStream(messages, (chunk) => {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
        });
        
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const response = await this.aiProvider.chat(messages, { tools });
        res.json(response);
      }
    });

    // 工具调用端点
    this.app.post("/v1/tools/:toolName", async (req, res) => {
      const tool = this.toolRegistry.get(req.params.toolName);
      if (!tool) {
        return res.status(404).json({ error: "Tool not found" });
      }

      const result = await tool.execute(req.body, {
        sessionId: req.sessionId,
        workspace: this.workspace,
        config: this.config,
      });

      res.json(result);
    });
  }

  private setupWebSocket(): void {
    this.wsServer?.on("connection", (ws) => {
      ws.on("message", async (data) => {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case "chat":
            // 处理聊天消息
            break;
          case "subscribe":
            // 订阅频道
            break;
          case "tool_call":
            // 工具调用
            break;
        }
      });
    });
  }
}
```

### 8. 插件系统 (src/plugins/)

```typescript
// sdk.ts - 插件 SDK
export interface Plugin {
  name: string;
  version: string;
  activate(context: PluginContext): void;
  deactivate(): void;
}

export interface PluginContext {
  registerCommand(command: Command): void;
  registerChannel(channel: ChannelConstructor): void;
  registerTool(tool: Tool): void;
  registerHook(event: string, handler: HookHandler): void;
  getConfig<T>(): T;
}

// loader.ts - 插件加载器
export class PluginLoader {
  async load(pluginPath: string): Promise<Plugin> {
    // 1. 检查插件目录
    // 2. 读取 package.json
    // 3. 验证插件结构
    // 4. 动态导入
    const module = await import(pluginPath);
    return module.default;
  }
}
```

## 🔧 开发顺序建议

### Phase 1: 基础 (Week 1)
1. ✅ 配置系统 (Zod Schema)
2. CLI 框架 + 核心命令 (setup, config, doctor)
3. 网关服务器 (HTTP + WebSocket)
4. AI 集成 (OpenAI)

### Phase 2: 核心功能 (Week 2)
5. Telegram 通道
6. Discord 通道
7. 会话管理
8. 基础 Web UI

### Phase 3: 扩展 (Week 3)
9. Slack 通道
10. WhatsApp 通道
11. 工具系统 (bash, file, web)
12. 内存系统

### Phase 4: 高级 (Week 4)
13. 浏览器控制
14. Cron 系统
15. 安全特性
16. 插件系统

### Phase 5: 完善 (Week 5-6)
17. 剩余 AI 提供者
18. 所有 CLI 命令
19. 技能系统
20. 测试与优化

## 📚 参考资源

- OpenClaw 源码: `C:\Users\DDguan\Desktop\mcp\02agent-client\openclaw`
- 配置类型: `src/config/types.*.ts`
- CLI 命令: `src/cli/commands/`
- 通道实现: `src/telegram/`, `src/discord/`, etc.
- 插件 SDK: `src/plugin-sdk/`

## ✅ 完成标准

- [ ] 所有 30+ CLI 命令可用
- [ ] 所有 13+ 通道支持
- [ ] 所有 20+ AI 提供者
- [ ] 完整的工具系统
- [ ] 内存向量搜索
- [ ] Cron 调度器
- [ ] 浏览器控制
- [ ] 插件扩展
- [ ] 企业级安全
- [ ] 完整的 Web UI
