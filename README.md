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

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) 1.0+ (推荐) 或 Node.js 18+
- 支持 OpenAI API 格式的 AI 服务 (OpenAI、DeepSeek、智谱等)

### 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/02mini.git
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
```

### 运行

```bash
# 开发模式
bun start

# 编译
bun run build

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
| `/mcp` | 列出 MCP 工具 |
| `/read <file>` | 读取文件 |
| `/write <file>` | 写入文件 |
| `/context` | 显示上下文窗口状态 |
| `/compact` | 手动压缩对话历史 |
| `/qq` | QQ 机器人管理 |
| `/cron` | 定时任务管理 |
| `/exit` | 退出程序 |

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