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

- `skills` - 列出所有技能
- `mcp` - 列出 MCP 工具
- `read <file>` - 读取文件
- `exit` - 退出

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
