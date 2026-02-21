# 02mini 完全还原 OpenClaw 规划方案

## 📋 项目概述

将 02mini 扩展为完整实现 OpenClaw 所有功能的简化版本，保持架构清晰、配置简单的同时，实现所有核心功能。

## 🏗️ 架构设计

### 核心原则
1. **模块化设计** - 每个功能独立模块，可插拔
2. **配置驱动** - 简单 JSON5 配置，支持环境变量
3. **插件扩展** - 完整的插件 SDK
4. **类型安全** - TypeScript + Zod 验证
5. **渐进式实现** - 核心功能优先，逐步扩展

### 目录结构

```
02mini/
├── src/
│   ├── cli/                    # CLI 命令系统
│   │   ├── commands/           # 所有命令实现
│   │   │   ├── core/           # 核心命令 (setup, onboard, config, doctor)
│   │   │   ├── messaging/      # 消息命令 (message, channels, directory)
│   │   │   ├── agent/          # Agent命令 (agent, agents, memory)
│   │   │   ├── gateway/        # 网关命令 (gateway, daemon, logs)
│   │   │   ├── system/         # 系统命令 (status, health, system)
│   │   │   ├── ai/             # AI命令 (models, approvals)
│   │   │   ├── nodes/          # 节点命令 (nodes, node, devices)
│   │   │   ├── advanced/       # 高级命令 (cron, hooks, webhooks, sandbox)
│   │   │   ├── security/       # 安全命令 (security, pairing, plugins)
│   │   │   └── utils/          # 工具命令 (update, docs, qr, completion)
│   │   ├── program.ts          # CLI 程序入口
│   │   └── context.ts          # CLI 上下文
│   ├── config/                 # 配置系统
│   │   ├── schema.ts           # Zod Schema定义
│   │   ├── types.ts            # 类型导出
│   │   ├── manager.ts          # 配置管理
│   │   ├── loader.ts           # 配置加载
│   │   ├── validation.ts       # 配置验证
│   │   ├── defaults.ts         # 默认值
│   │   └── env.ts              # 环境变量处理
│   ├── gateway/                # 网关服务器
│   │   ├── server.ts           # 主服务器
│   │   ├── websocket.ts        # WebSocket处理
│   │   ├── http.ts             # HTTP API
│   │   ├── methods.ts          # 网关方法
│   │   ├── auth.ts             # 认证
│   │   ├── sessions.ts         # 会话管理
│   │   ├── channels.ts         # 通道管理
│   │   ├── plugins.ts          # 插件管理
│   │   └── health.ts           # 健康检查
│   ├── channels/               # 消息通道
│   │   ├── base/               # 通道基类
│   │   ├── telegram/           # Telegram
│   │   ├── discord/            # Discord
│   │   ├── slack/              # Slack
│   │   ├── whatsapp/           # WhatsApp
│   │   ├── signal/             # Signal
│   │   ├── imessage/           # iMessage
│   │   ├── web/                # WebChat
│   │   └── registry.ts         # 通道注册表
│   ├── ai/                     # AI提供者
│   │   ├── base.ts             # 基类
│   │   ├── openai.ts           # OpenAI
│   │   ├── anthropic.ts        # Anthropic
│   │   ├── gemini.ts           # Google Gemini
│   │   ├── bedrock.ts          # AWS Bedrock
│   │   ├── ollama.ts           # Ollama
│   │   ├── openrouter.ts       # OpenRouter
│   │   └── registry.ts         # 注册表
│   ├── agents/                 # Agent系统
│   │   ├── runtime.ts          # Agent运行时
│   │   ├── tools/              # 工具实现
│   │   │   ├── bash.ts
│   │   │   ├── file.ts
│   │   │   ├── browser.ts
│   │   │   ├── web.ts
│   │   │   └── ...
│   │   └── bindings.ts         # Agent绑定
│   ├── plugins/                # 插件系统
│   │   ├── sdk.ts              # SDK入口
│   │   ├── loader.ts           # 加载器
│   │   ├── runtime.ts          # 运行时
│   │   ├── hooks.ts            # 钩子系统
│   │   └── registry.ts         # 注册表
│   ├── memory/                 # 内存系统
│   │   ├── base.ts             # 基类
│   │   ├── sqlite.ts           # SQLite实现
│   │   ├── vector.ts           # 向量搜索
│   │   └── index.ts            # 索引管理
│   ├── browser/                # 浏览器控制
│   │   ├── controller.ts       # 控制器
│   │   ├── cdp.ts              # CDP协议
│   │   └── pool.ts             # 连接池
│   ├── cron/                   # Cron系统
│   │   ├── scheduler.ts        # 调度器
│   │   ├── jobs.ts             # 作业管理
│   │   └── runner.ts           # 执行器
│   ├── security/               # 安全特性
│   │   ├── auth.ts             # 认证
│   │   ├── audit.ts            # 审计
│   │   ├── allowlist.ts        # 允许列表
│   │   ├── pairing.ts          # 配对
│   │   └── sandbox.ts          # 沙盒
│   ├── skills/                 # 技能系统
│   │   ├── loader.ts           # 加载器
│   │   ├── runner.ts           # 运行器
│   │   └── registry.ts         # 注册表
│   ├── utils/                  # 工具函数
│   │   ├── id.ts
│   │   ├── session.ts
│   │   ├── logging.ts
│   │   └── errors.ts
│   └── index.ts                # 主入口
├── extensions/                 # 扩展
│   └── (插件扩展)
├── skills/                     # 内置技能
│   └── (50+技能)
├── web/                        # Web UI
│   ├── css/
│   ├── js/
│   └── index.html
└── package.json
```

## 📦 功能模块清单

### Phase 1: 核心基础 (必须优先实现)

#### 1.1 配置系统
- [ ] 完整 Zod Schema (types.*.ts)
- [ ] JSON5 支持 + $include
- [ ] 环境变量替换 ${VAR}
- [ ] 配置验证和迁移
- [ ] 配置审计日志

#### 1.2 CLI 框架
- [ ] 程序入口和上下文
- [ ] 命令注册系统
- [ ] 帮助文档生成
- [ ] Shell 补全

#### 1.3 网关核心
- [ ] HTTP 服务器
- [ ] WebSocket 服务器
- [ ] 认证系统 (token/password/none)
- [ ] 会话管理
- [ ] 健康检查

#### 1.4 AI 集成
- [ ] OpenAI (流式 + 工具)
- [ ] Anthropic (流式 + 工具)
- [ ] 模型管理
- [ ] 上下文窗口

### Phase 2: 通道系统

#### 2.1 内置通道
- [ ] Telegram (grammY)
- [ ] Discord (discord.js)
- [ ] Slack (Bolt)
- [ ] WebSocket/WebChat

#### 2.2 高级通道
- [ ] WhatsApp (Baileys)
- [ ] Signal
- [ ] iMessage

### Phase 3: Agent 与工具

#### 3.1 Agent 运行时
- [ ] Pi Agent 兼容运行时
- [ ] Agent 绑定
- [ ] Agent 隔离

#### 3.2 工具系统
- [ ] bash/exec
- [ ] file (read/write/patch)
- [ ] web (fetch/search)
- [ ] browser (Chrome CDP)
- [ ] canvas
- [ ] message (send/spawn)

### Phase 4: 高级功能

#### 4.1 内存系统
- [ ] SQLite 存储
- [ ] 向量嵌入
- [ ] 混合搜索
- [ ] 自动索引

#### 4.2 Cron 系统
- [ ] Cron 表达式解析
- [ ] 调度器
- [ ] 作业执行

#### 4.3 安全特性
- [ ] DM 配对
- [ ] Allowlist
- [ ] 执行审批
- [ ] 审计日志

#### 4.4 插件系统
- [ ] SDK 完整实现
- [ ] 动态加载
- [ ] 钩子系统

### Phase 5: 扩展

#### 5.1 CLI 命令完整实现
- [ ] 所有 30+ 命令

#### 5.2 AI 提供者
- [ ] 所有 20+ 提供者

#### 5.3 技能系统
- [ ] 50+ 内置技能

## 🎯 实现时间表

### Week 1: 基础架构
- Day 1-2: 配置系统重构 (Zod Schema)
- Day 3-4: CLI 框架 + 核心命令
- Day 5-7: 网关服务器 (HTTP + WebSocket)

### Week 2: 核心功能
- Day 8-10: AI 集成 (OpenAI + Anthropic)
- Day 11-12: 会话管理
- Day 13-14: 基础通道 (Telegram + Discord)

### Week 3: 通道与消息
- Day 15-17: Slack + WhatsApp
- Day 18-19: Signal + iMessage
- Day 20-21: 通道策略 + 路由

### Week 4: Agent 与工具
- Day 22-24: Agent 运行时
- Day 25-27: 工具系统
- Day 28: 浏览器控制

### Week 5: 高级功能
- Day 29-31: 内存系统
- Day 32-33: Cron 系统
- Day 34-35: 安全特性

### Week 6: 插件与扩展
- Day 36-38: 插件系统
- Day 39-40: 剩余 CLI 命令
- Day 41-42: AI 提供者扩展

## 🚀 开始实现

现在开始 Phase 1 - 基础架构实现。
