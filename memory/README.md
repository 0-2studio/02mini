# Memory System

02mini 的内存系统用于存储 AI 的长期记忆和知识。

## 目录结构

```
memory/
├── user-profile.md       # 用户档案和偏好
├── skills-inventory.md    # 技能清单
├── daily-logs/           # 每日日志
├── daily-summaries/      # 每日总结
├── self-reflections/     # 自我反思记录
├── knowledge/            # 知识库
├── group-members/        # 群成员缓存
└── planned-changes/      # 计划的修改
```

## 文件说明

### user-profile.md

存储用户的个人信息、偏好和通信风格。AI 会参考这些信息来个性化交互。

### skills-inventory.md

记录 AI 已掌握的技能和能力。

### daily-logs/

每日自动生成的日志文件，记录当天的重要事件和对话。

### daily-summaries/

每日总结文件，由定时任务生成。

### self-reflections/

AI 的自我反思记录，用于持续改进。

### knowledge/

存储各类知识点和技术文档。

## 注意事项

- `daily-logs/`、`daily-summaries/`、`self-reflections/`、`knowledge/` 目录下的文件会自动生成
- 这些文件已通过 `.gitignore` 排除，不会提交到仓库
- 可以手动编辑 `user-profile.md` 和 `skills-inventory.md`
