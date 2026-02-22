# 02mini - 自驱动 AI 系统

一个具有自我认知、技能系统和定时任务能力的 AI 助手。

## 架构

```
02mini/
├── important/      # 核心定义（只读）
│   ├── soul.md          # AI 身份定义
│   ├── architecture.md  # 系统架构
│   ├── heartbeat.md     # 定时任务
│   └── skills-guide.md  # 技能指南
├── memory/         # 可写内存
│   ├── self-reflections/  # 自我反思
│   ├── daily-logs/        # 每日日志
│   ├── knowledge/         # 知识库
│   └── user-profile.md    # 用户档案
├── skills/         # 技能文件夹
│   ├── cli-bridge/    # CLI 通讯（必须）
│   ├── file-manager/  # 文件管理
│   ├── memory-reader/ # 内存读取
│   ├── self-modify/   # 自我修改
│   └── skill-creator/ # 创建技能
└── src/            # 源代码
```

## 安装

需要 [Bun](https://bun.sh) 运行时。

```bash
bun install
```

## 运行

```bash
# 直接运行（无需编译）
bun start

# 开发模式（热重载）
bun dev

# 打包
bun run build
```

## MCP 配置

编辑 `mcp-config.json` 配置 MCP 服务器：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

## CLI 命令

- `/skills` - 列出所有技能
- `/mcp` - 列出 MCP 工具
- `/read <file>` - 读取文件
- `/context` - 显示上下文窗口状态
- `/compact` - 手动压缩对话历史
- `/exit` - 退出

## 技能系统

每个技能是一个文件夹，包含 `SKILL.md`：

```yaml
---
name: skill-name
description: 技能描述
triggers:
  - 触发条件1
  - 触发条件2
---

# 技能详细说明...
```

## 定时任务

在 `important/heartbeat.md` 中定义：

- 每 5 分钟任务
- 每小时任务
- 每日任务（09:00）
- 每周任务（周日 10:00）

## 上下文压缩

02mini 实现了智能文本压缩功能，参考 OpenClaw 的设计：

### 自动压缩

当对话历史达到一定阈值时，系统自动触发压缩：

| 级别 | 触发条件 | 策略 |
|------|----------|------|
| 🟢 OK | < 60% | 不压缩 |
| 🟡 Light | 60-85% | 移除低重要性消息 |
| 🟠 Medium | 85-95% | 压缩旧消息，保留关键事实 |
| 🔴 Heavy | > 95% | 激进压缩，仅保留系统和最近消息 |
| ⚠️ Emergency | 超限 | 紧急裁剪，只保留最少必要消息 |

### 保护规则

以下消息类型不会被压缩：
- System 消息（身份定义）
- 最近 4 条消息
- 未完成的工具调用链
- 包含重要关键词的消息（如 "记住", "不要忘"）

### 手动压缩

使用 `/compact` 命令手动触发压缩。

### 状态查看

使用 `/context` 命令查看当前上下文状态：
- 消息数量统计
- Token 使用比例
- 压缩历史记录

## 网关 API (Gateway)

02mini 提供 HTTP API 和 WebSocket 接口，允许外部应用连接。

### 启动网关

网关默认在 `http://localhost:3000` 启动：

```bash
# 设置端口（默认 3000）
export GATEWAY_PORT=3000

# 设置认证 Token（可选）
export GATEWAY_TOKEN=your-secret-token

# 运行
bun start
```

### API 端点

#### 健康检查
```bash
GET /health
```

#### 发送消息
```bash
POST /api/send
Content-Type: application/json

{
  "message": "你好，02",
  "sessionId": "optional-session-id"
}
```

#### OpenAI 兼容接口
```bash
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer your-token

{
  "model": "02mini",
  "messages": [
    {"role": "user", "content": "你好"}
  ]
}
```

#### 获取系统状态
```bash
GET /api/status
```

#### 获取定时任务列表
```bash
GET /api/cron/jobs
```

#### WebSocket 连接
```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'message',
    content: '你好',
    sessionId: 'my-session'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.content); // AI 回复
};
```

### WebSocket 消息类型

- `ping` / `pong` - 心跳
- `message` - 发送用户消息
- `response` - AI 回复
- `proactive` - AI 主动发送的消息
- `error` - 错误信息

## 自主运行 (Autonomous)

02mini 支持自主运行模式，AI 可以主动给用户发送消息。

### 工作原理

1. **心跳检查** - 每 N 分钟检查一次是否有需要主动沟通的内容
2. **Cron 触发** - 定时任务可以触发 AI 主动执行
3. **系统事件** - 特定事件可以触发主动消息

### 配置

```bash
# 启用/禁用自主运行（默认启用）
export AUTONOMOUS_ENABLED=true

# 心跳间隔（分钟，默认 5）
export HEARTBEAT_INTERVAL=5

# 每小时最大主动消息数（默认 10）
export MAX_PROACTIVE_PER_HOUR=10
```

### 活跃时段

默认只在 09:00-22:00 之间主动发送消息，避免打扰休息。

### 触发条件

AI 会在以下情况主动发消息：
- 有到期的提醒任务
- 有需要跟进的事项
- 有重要信息需要分享
- 用户可能需要帮助（基于上下文判断）

### 消息格式

主动消息会在 CLI 中以 `[Proactive]` 标记显示，并播放提示音。

### 静默期

用户发送消息后，会有 1 分钟的静默期，期间不会发送主动消息。
