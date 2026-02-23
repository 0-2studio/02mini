# 02mini QQ Bot 接入教程 (NapCat)

本文档详细介绍如何将 02mini 接入 QQ，使其能够接收和回复 QQ 消息。

## 1. 架构概述

```
┌─────────┐     OneBot 11      ┌──────────┐     WebSocket/HTTP    ┌──────────┐
│   QQ    │ ◄────────────────► │  NapCat  │ ◄───────────────────► │  02mini  │
│ 服务器   │    消息/事件         │  QQ客户端  │                      │  AI助手   │
└─────────┘                    └──────────┘                      └──────────┘
```

- **NapCat**: 基于 NTQQ 的 OneBot 11 协议实现
- **OneBot 11**: 统一的 Bot 接口标准
- **02mini**: 通过 WebSocket 接收/发送消息

## 2. 安装 NapCat

### Windows 安装

1. **下载 NapCat**
   ```
   https://github.com/NapNeko/NapCatQQ/releases
   ```
   下载最新版本的 NapCat.Win.zip

2. **解压并运行**
   ```powershell
   # 解压到任意目录，例如 C:\NapCat
   cd C:\NapCat
   .\napcat.exe
   ```

3. **首次启动**
   - 会弹出 QQ 登录窗口
   - 使用小号登录（不建议使用主号）
   - 扫码或密码登录
   - 登录成功后 NapCat 会自动启动 WebSocket 服务

### Docker 安装 (Linux/群晖等)

```bash
docker run -d \
  --name napcat \
  --restart always \
  -p 3000:3000 \
  -p 3001:3001 \
  -e NAPCAT_UID=1000 \
  -e NAPCAT_GID=1000 \
  mlikiowa/napcat-docker:latest
```

## 3. 配置 NapCat

### 3.1 配置文件位置

**Windows**: `C:\NapCat\config\onebot11.json`

**Docker**: `/app/config/onebot11.json`

### 3.2 WebSocket 客户端模式 (推荐)

编辑 `onebot11.json`：

```json
{
  "network": {
    "websocketClients": [
      {
        "name": "02mini",
        "enable": true,
        "url": "ws://localhost:3002/onebot",
        "messagePostFormat": "string",
        "reportSelfMessage": false,
        "reconnectInterval": 5000,
        "token": "your-secret-token-here"
      }
    ]
  }
}
```

### 3.3 WebSocket 服务端模式

如果希望 02mini 主动连接 NapCat：

```json
{
  "network": {
    "websocketServers": [
      {
        "name": "02mini",
        "enable": true,
        "host": "0.0.0.0",
        "port": 3001,
        "messagePostFormat": "string"
      }
    ]
  }
}
```

然后在 02mini 的 `.env` 中配置：
```env
QQ_MODE=websocket-client
QQ_NAPCAT_URL=ws://localhost:3001
```

## 4. 配置 02mini

### 4.1 启用 QQ 模块

```bash
# 进入 02mini 目录
cd 02mini

# 启动 02mini
bun start

# 在 CLI 中启用 QQ
/qq enable
```

### 4.2 配置文件

配置文件会自动创建在 `02mini/important/qq-config.json`：

```json
{
  "config": {
    "enabled": true,
    "mode": "websocket-server",
    "port": 3002,
    "host": "0.0.0.0",
    "accessToken": "your-secret-token-here",
    "autoFriendAccept": false,
    "autoGroupInviteAccept": false,
    "atRequiredInGroup": true,
    "maxMessageLength": 2000,
    "splitLongMessages": true,
    "typingIndicator": false
  },
  "permissions": {
    "allowedUsers": [],
    "blockedUsers": [],
    "allowAllPrivate": true,
    "allowedGroups": [],
    "blockedGroups": [],
    "allowAllGroups": false,
    "adminUsers": []
  }
}
```

### 4.3 环境变量 (可选)

```env
# QQ 配置
QQ_ENABLED=true
QQ_PORT=3002
QQ_TOKEN=your-secret-token-here
QQ_AT_REQUIRED=true
```

## 5. 权限管理

### 5.1 用户权限

**允许特定用户私聊**：
```
/qq allow user 123456789
```

**阻止特定用户**：
```
/qq block user 987654321
```

**允许所有用户私聊** (默认)：
```
# 默认就是允许所有，不需要设置
# 如果要改成仅允许列表中的用户：
# 编辑配置文件设置 allowAllPrivate: false
```

### 5.2 群权限

**允许特定群**：
```
/qq allow group 123456789
```

**阻止特定群**：
```
/qq block group 987654321
```

**查看权限列表**：
```
/qq list
```

### 5.3 群聊 @ 要求

默认情况下，机器人在群里**只在被 @ 时回复**。

关闭 @ 要求 (不推荐)：
```json
{
  "config": {
    "atRequiredInGroup": false
  }
}
```

## 6. 使用方法

### 6.1 私聊

私聊时和正常 CLI 一样，直接发送消息即可。

### 6.2 群聊

群聊时需要 @ 机器人：
```
@02mini 你好
```

### 6.3 AI 主动发消息

AI 可以使用 `qq` 工具主动发送消息：

```javascript
// 发送私聊消息
{
  "action": "send_private_message",
  "user_id": 123456789,
  "message": "Hello!"
}

// 发送群消息
{
  "action": "send_group_message",
  "group_id": 987654321,
  "message": "大家好!"
}

// 查看状态
{
  "action": "get_status"
}
```

## 7. 命令列表

### 7.1 CLI 命令

| 命令 | 说明 |
|------|------|
| `/qq status` | 查看 QQ 适配器状态 |
| `/qq enable` | 启用 QQ 适配器 |
| `/qq disable` | 禁用 QQ 适配器 |
| `/qq allow user <id>` | 允许用户私聊 |
| `/qq allow group <id>` | 允许群访问 |
| `/qq block user <id>` | 阻止用户私聊 |
| `/qq block group <id>` | 阻止群访问 |
| `/qq list` | 列出权限配置 |
| `/qq admin add <id>` | 添加管理员 |
| `/qq admin remove <id>` | 移除管理员 |

### 7.2 QQ 工具

| Action | 说明 |
|--------|------|
| `send_private_message` | 发送私聊消息 |
| `send_group_message` | 发送群消息 |
| `get_status` | 获取 QQ 状态 |
| `list_allowed_groups` | 列出允许的群 |
| `list_allowed_users` | 列出允许的用户 |

## 8. AI 提示词

当 QQ 模块启用时，AI 会自动收到以下提示词：

```
## QQ Bot Module (NapCat/OneBot)

You are connected to QQ via NapCat (OneBot 11 protocol).

### How QQ Works
- **Private Messages**: One-on-one chats. You can respond to all allowed users.
- **Group Messages**: Multi-user chat rooms. You should NOT reply to every message!

### When to Reply in Groups
In group chats, ONLY reply when:
1. Someone @ mentions you explicitly
2. Someone asks you a direct question
3. You have something genuinely valuable to add
4. The user specifically requests your input

**DO NOT** reply to:
- Casual conversation between users
- Messages not directed at you
- Every message in the group
```

## 9. 故障排除

### 9.1 连接问题

**问题**: NapCat 无法连接到 02mini

**检查步骤**:
1. 确认 02mini 已启动且 QQ 已启用
2. 检查端口是否被占用：`netstat -ano | findstr 3002`
3. 检查防火墙设置
4. 查看 02mini 日志是否有连接信息

### 9.2 消息不回复

**问题**: 发送消息但 AI 不回复

**检查步骤**:
1. 检查是否在允许列表中 (`/qq list`)
2. 群聊时是否 @ 了机器人
3. 查看 02mini 控制台是否有消息日志
4. 检查 AI 是否正常响应 (测试 CLI)

### 9.3 NapCat 无法启动

**问题**: NapCat 启动失败或 QQ 登录失败

**解决方案**:
1. 删除 `data/` 目录重试
2. 确保使用的是 QQ 小号
3. 检查是否被 QQ 风控
4. 尝试使用密码登录而非扫码

## 10. 安全建议

1. **使用小号**: 不要用主号运行机器人
2. **设置权限**: 只允许信任的用户和群
3. **开启 @ 要求**: 群里必须 @ 才回复，避免刷屏
4. **定期备份**: 备份 `qq-config.json`
5. **监控日志**: 注意异常登录或消息

## 11. 高级配置

### 11.1 消息分段

长消息会自动分段发送：

```json
{
  "config": {
    "maxMessageLength": 2000,
    "splitLongMessages": true
  }
}
```

### 11.2 自动通过好友

```json
{
  "config": {
    "autoFriendAccept": true
  }
}
```

### 11.3 自动通过群邀请

```json
{
  "config": {
    "autoGroupInviteAccept": true
  }
}
```

## 12. 示例对话

**私聊**:
```
用户: 你好
AI: 你好！有什么可以帮你的吗？

用户: 帮我查一下天气
AI: [使用 fetch 工具查询天气]
北京今天晴天，温度 15-25°C。
```

**群聊**:
```
用户A: 今天天气不错
用户B: @02mini 今天北京天气怎么样？
AI: [只回复这条 @ 的消息]
北京今天晴天，温度 15-25°C。

用户C: 谢谢
[AI 不会回复，因为没有 @]
```

## 13. 相关链接

- [NapCat 文档](https://napneko.github.io/)
- [OneBot 11 协议](https://github.com/botuniverse/onebot-11)
- [02mini GitHub](https://github.com/yourusername/02mini)

---

如有问题，请在 Issues 中反馈。
