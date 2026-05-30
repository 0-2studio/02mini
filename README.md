# 02mini - 自驱动 AI 系统

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-orange.svg)](https://bun.sh/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个具有自我认知、技能系统和定时任务能力的 AI 助手框架。支持 CLI 交互、QQ 机器人、HTTP API 和 WebSocket 网关。

## 特性

- **自我认知** - AI 拥有身份定义和记忆系统
- **技能系统** - 可扩展的技能模块，支持动态加载
- **定时任务** - 支持 Cron、一次性任务和间隔任务
- **上下文压缩** - 智能压缩对话历史，支持长对话
- **MCP 协议** - 支持 Model Context Protocol 工具扩展
- **QQ 机器人** - 通过 NapCat 接入 QQ 群聊和私聊
- **HTTP API** - OpenAI 兼容的 API 接口
- **WebSocket** - 实时双向通信

## 当前行为说明

- Gateway `/v1/chat/completions` 是 02mini agent gateway，不是透明 OpenAI proxy。它会把请求中的 `messages` 转成完整 transcript 后交给 02mini 引擎处理；自定义 tools 会被明确拒绝，stream 暂未支持。
- Gateway `/api/send` 会按 `sessionId` 保存 API 层 user/assistant 历史，可通过 `/api/sessions/:id/history` 查询。底层 AI Engine 使用全局共享上下文，以保证 CLI/Gateway/QQ/Cron/Autonomous 信息互通；不同来源会在输入中带来源标签。
- Cron 表达式使用主机本地时区。`tz` 字段不再作为有效调度能力暴露。
- 控制台调试建议设置 `QQ_ENABLED=false` 和 `AUTONOMOUS_ENABLED=false`，避免连接 NapCat 或启动主动心跳。
- 真实 QQ 配置不要提交。使用 `important/qq-config.example.json` 作为模板，真实 token 放在 `.env` 的 `QQ_TOKEN` 或本地 ignored 配置中。

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) 1.0+ (推荐) 或 Node.js 18+
- 支持 OpenAI API 格式的 AI 服务 (OpenAI、DeepSeek、智谱等)

### 安装

```bash
# 克隆仓库
git clone https://github.com/0-2studio/02mini.git
cd 02mini

# 安装依赖
bun install

# 复制环境变量配置
cp .env.example .env

# 编辑 .env 文件，填入你的 API 配置
```

### 配置

编辑 `.env` 文件：

```env
# AI 服务配置
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your-api-key-here
AI_MODEL=gpt-4o-mini
AI_TEMPERATURE=0.7
AI_MAX_TOKENS=4096

# 网关配置 (可选)
GATEWAY_PORT=3000
GATEWAY_TOKEN=your-secret-token

# 自主运行配置 (可选)
AUTONOMOUS_ENABLED=true
HEARTBEAT_INTERVAL=5
AUTONOMOUS_MIN_INTERVAL=1
AUTONOMOUS_MAX_INTERVAL=30
AUTONOMY_LEVEL=assist # observe | assist | operate

# KukeChat Bot 配置 (可选)
KUKECHAT_ENABLED=false
KUKECHAT_BOT_KEY=your-kukechat-bot-key
KUKECHAT_BASE_URL=https://chat-api.kuke.ink/api/v1
KUKECHAT_WS_URL=wss://chat-api.kuke.ink/bot/ws
```

### 运行

```bash
# 开发模式
bun start

# 编译
bun run build

# 静态检查
bunx tsc --noEmit

# 最小 smoke 验证
bun run smoke

# 运行编译版本
node dist/index.js
```

## 项目结构

```
02mini/
├── src/                      # 源代码
│   ├── index.ts             # 主入口
│   ├── core/
│   │   └── engine.ts        # 核心引擎 (AI处理、工具调用)
│   ├── ai/
│   │   └── client.ts        # OpenAI 兼容 API 客户端
│   ├── cli/
│   │   └── interface.ts     # CLI 交互界面
│   ├── gateway/             # HTTP API + WebSocket 网关
│   │   ├── server.ts
│   │   └── routes/
│   ├── mcp/                 # MCP 协议集成
│   │   ├── client.ts
│   │   └── manager.ts
│   ├── cron/                # 定时任务调度
│   │   ├── scheduler.ts
│   │   ├── store.ts
│   │   └── tool.ts
│   ├── qq/                  # QQ 机器人适配器
│   │   ├── adapter.ts
│   │   ├── tools.ts
│   │   └── config.ts
│   ├── kukechat/            # KukeChat Bot 适配器
│   │   ├── adapter.ts
│   │   ├── tools.ts
│   │   └── config.ts
│   ├── context/             # 上下文管理
│   │   ├── manager.ts
│   │   ├── compaction.ts
│   │   └── tokens.ts
│   └── skills-impl/         # 技能实现
│
├── important/               # 核心定义 (只读)
│   ├── soul.md             # AI 身份定义
│   ├── architecture.md     # 系统架构
│   ├── heartbeat.md        # 定时任务配置
│   ├── skills-guide.md     # 技能指南
│   └── qq-config.json      # QQ 机器人配置
│
├── memory/                  # 可写内存系统
│   ├── user-profile.md     # 用户档案
│   ├── skills-inventory.md # 技能清单
│   ├── self-reflections/   # 自我反思记录
│   ├── daily-logs/         # 每日日志
│   ├── daily-summaries/    # 每日总结
│   └── knowledge/          # 知识库
│
├── skills/                  # 技能定义
│   ├── cli-bridge/         # 用户通信 (必需)
│   ├── file-manager/       # 文件管理
│   ├── memory-reader/      # 内存读取
│   ├── memory-organizer/   # 内存组织
│   ├── self-modify/        # 自我修改
│   ├── skill-creator/      # 技能创建
│   └── ocr-processor/      # OCR 处理
│
├── files/                   # 生成文件存储
│   └── qq-uploads/         # QQ 文件上传
│
├── docs/                    # 文档
│
├── .env.example            # 环境变量示例
├── mcp-config.json         # MCP 服务器配置
├── tsconfig.json           # TypeScript 配置
└── package.json            # 项目配置
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/skills` | 列出所有技能 |
| `/tools` / `/mcp` | 列出 MCP 工具 |
| `/read <file>` | 读取文件 |
| `/runtime` | 显示模型、API、上下文、Cron、QQ 状态 |
| `/doctor` | 本地 readiness 自检，不打印密钥 |
| `/context` | 显示上下文窗口状态 |
| `/compact` | 手动压缩对话历史 |
| `/memory list|read|search` | 查看和搜索 memory/ |
| `/jobs list|run|pause|resume|remove` | 管理 Cron jobs |
| `/auto status|queue|log|cancel` | 查看自主运行状态、队列和日志 |
| `/plan on|off|status` | CLI 计划模式 |
| `/qq` | QQ 机器人管理 |
| `/kuke` / `/kukechat` | KukeChat 连接状态 |
| `/exit` | 退出程序 |

## KukeChat Bot

KukeChat 通过官方 Bot API 接入：

- WebSocket 接收事件：`wss://chat-api.kuke.ink/bot/ws?key=...`
- REST 发送消息：`POST /bot-api/conversations/{conversation_id}/messages`
- REST 私信用户：`POST /bot-api/users/{user_id}/messages`

启用方式：

```env
KUKECHAT_ENABLED=true
KUKECHAT_BOT_KEY=your-kukechat-bot-key
```

收到 KukeChat 消息后会进入全局共享上下文，并带来源标签：

```text
[KukeChat Source conversation=123 message=1001 sender=88]
```

AI 回复 KukeChat 必须使用 `kukechat` 工具，支持：

- `send_conversation_message`
- `send_direct_message`
- `get_me`
- `get_conversation`

KukeChat 消息可使用官方元素，例如 `<quote id="1001"/>`、`<at id="88"/>`、`<markdown>...</markdown>`。Bot Key 只放 `.env`，不要提交到仓库。

## 自主运行

02mini 的自主运行模块按 OpenClaw 风格设计：它不依赖用户每次发指令，而是通过 heartbeat、Cron、队列、通道活动和 memory 状态自行判断是否行动。

### 自主等级

| 等级 | 行为 |
|------|------|
| `observe` | 只观察状态，通常只报告重要问题，不主动执行队列 |
| `assist` | 默认模式，会执行安全自维护、检查 overdue job、context pressure、tool health |
| `operate` | 更主动地执行自主队列和持续维护任务 |

### 持久化文件

| 文件 | 用途 |
|------|------|
| `memory/autonomous-policy.json` | 自主目标、维护阈值、重复汇报窗口 |
| `memory/autonomous-queue.json` | 自主工作队列，包含状态、优先级、重试和结果 |
| `memory/autonomous-activity.jsonl` | 自主运行事件日志 |

### 自主能力

- 自适应 heartbeat：有事时加快，无事时放慢，错误时退避。
- 自主 work queue：发现 overdue cron、context pressure、MCP 工具缺失、失败任务后自动入队。
- 低噪声汇报：重复 proactive 消息会在 policy 窗口内被抑制。
- 多通道感知：CLI、Gateway、QQ、Cron 活动会进入自主状态，影响后续判断。
- 可观察但非人工驱动：`/auto status`、`/auto queue`、`/auto log` 用于查看运行情况。

## 技能系统

每个技能是一个文件夹，包含 `SKILL.md` 文件：

```yaml
---
name: skill-name
description: 技能描述
triggers:
  - 触发条件1
  - 触发条件2
---

# 技能详细说明

## 使用方法
...

## 示例
...
```

### 内置技能

| 技能 | 说明 |
|------|------|
| `cli-bridge` | CLI 用户通信 (必需) |
| `file-manager` | 文件读写操作 |
| `memory-reader` | 读取内存文件 |
| `memory-organizer` | 组织和整理记忆 |
| `self-modify` | 自我修改代码 |
| `skill-creator` | 创建新技能 |
| `ocr-processor` | OCR 文字识别 |

## 定时任务

在 `important/heartbeat.md` 中定义定时任务：

```markdown
## 每 5 分钟
- 检查待办事项
- 检查提醒

## 每日 09:00
- 每日记忆整理
- 生成每日总结

## 每周周日 10:00
- 周报生成
- 记忆归档
```

### 使用 CLI 管理

```bash
# 列出所有任务
/cron list

# 添加任务
/cron add "提醒我开会" at 15:30

# 添加间隔任务
/cron add "检查邮件" every 30m

# 删除任务
/cron delete <job_id>
```

## 上下文压缩

智能压缩对话历史，支持长对话：

| 级别 | 触发条件 | 策略 |
|------|----------|------|
| OK | < 50% | 不压缩 |
| Light | 50-70% | 程序修剪冗余消息 |
| Medium | 70-85% | AI 生成摘要 |
| Heavy | 85-100% | AI 激进压缩 |
| Emergency | ≥ 100% | 紧急裁剪 |

### 保护规则

- System 消息不会被压缩
- 最近 3 条消息保留
- 未完成的工具调用链保留

## QQ 机器人

通过 NapCat 接入 QQ：

### 配置 NapCat

```json
{
  "network": {
    "websocketClients": [{
      "name": "02mini",
      "enable": true,
      "url": "ws://localhost:3002/onebot"
    }]
  }
}
```

### 配置 02mini

编辑 `important/qq-config.json`：

```json
{
  "config": {
    "enabled": true,
    "mode": "websocket-client",
    "napcatWsUrl": "ws://localhost:8082"
  },
  "permissions": {
    "allowAllPrivate": true,
    "allowedGroups": [123456789]
  }
}
```

### QQ 功能

- 私聊支持
- 群聊支持 (@ 触发或全部消息)
- 权限管理 (白名单/黑名单)
- 文件收发
- @ 提及

## HTTP API

### 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/send` | POST | 发送消息 |
| `/api/status` | GET | 系统状态 |
| `/api/cron/jobs` | GET | 定时任务列表 |
| `/v1/chat/completions` | POST | OpenAI 兼容接口 |

### OpenAI 兼容接口

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "model": "02mini",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

## WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'message',
    content: '你好'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.content);
};
```

## MCP 工具

配置 `mcp-config.json` 添加外部工具：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "fetch": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"]
    }
  }
}
```

## 开发

### 构建

```bash
bun run build
```

### 项目脚本

```json
{
  "scripts": {
    "start": "bun src/index.ts",
    "build": "bun build src/index.ts --outdir=dist --target=node",
    "dev": "bun --watch src/index.ts"
  }
}
```

## 许可证

[MIT License](LICENSE)

## 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) - 架构参考
- [NapCat](https://github.com/NapNeko/NapCatQQ) - QQ 机器人协议
- [Model Context Protocol](https://modelcontextprotocol.io/) - 工具协议
