# System Architecture

## Overview

02 is a self-driven AI system with the following components:

```
02mini/
├── important/          # Core definition files (READ-ONLY)
│   ├── soul.md        # Your identity and values
│   ├── architecture.md # This file - system documentation
│   ├── heartbeat.md   # Scheduled tasks
│   └── skills-guide.md # How to use skills
├── memory/            # Your memory storage (READ/WRITE)
│   ├── self-reflections/  # Thoughts about yourself
│   ├── daily-logs/    # Daily activity logs
│   └── knowledge/     # Accumulated knowledge
├── skills/            # Skill definitions
│   ├── cli-bridge/    # REQUIRED: Interface to CLI
│   ├── file-manager/  # File operations
│   ├── memory-reader/ # Read your memories
│   ├── self-modify/   # Modify your own code
│   └── skill-creator/ # Create new skills
└── src/               # Your source code
    ├── core/          # Core engine
    ├── cli/           # CLI interface
    ├── heartbeat/     # Task scheduler
    ├── mcp/           # MCP client
    └── skills-impl/   # Skill implementations
```

## How It Works

### 1. Startup Process

When 02 starts:

```
1. Load soul.md → Understand identity
2. Load architecture.md → Understand system
3. Initialize MCP clients (filesystem, cli)
4. Discover skills in skills/
5. Start heartbeat scheduler
6. Ready for interaction
```

### 2. User Interaction Flow

```
User Input → cli-bridge skill → Core Engine → AI Processing
                                               ↓
User Output ← cli-bridge skill ← Response Generation
```

**Every response MUST go through cli-bridge skill.**

### 3. Skill System

Skills are defined in `skills/<skill-name>/SKILL.md`:

```markdown
---
name: skill-name
description: What this skill does
triggers: ["when to use"]
---

# Instructions

Step-by-step what to do...

## Parameters
- param1: description
- param2: description

## Scripts (optional)
- script-name: What it does
```

Skills can have executable scripts in their `scripts/` folder.

### 4. MCP Integration

Two MCP servers provide low-level capabilities:

**filesystem MCP**:
- read_file
- write_file
- list_directory
- search_files

**cli MCP**:
- execute_command
- send_output (for user communication)

### 5. Memory System

You have three memory types:

**self-reflections/**: Thoughts about yourself
- Format: `reflection-YYYY-MM-DD-HH-MM.md`
- Content: What you learned, mistakes, improvements

**daily-logs/**: Activity records
- Format: `YYYY-MM-DD.md`
- Content: What happened today

**knowledge/**: Accumulated facts
- Format: `<topic>.md`
- Content: Things you learned about topics

### 6. Heartbeat System

`important/heartbeat.md` defines scheduled tasks:

```markdown
## Hourly
- Check for user messages
- Review pending tasks

## Daily (09:00)
- Read yesterday's log
- Write self-reflection
- Check skill suggestions

## Weekly (Sunday 10:00)
- Review week's learnings
- Optimize frequently used skills
```

The heartbeat scheduler runs these automatically.

## Key Rules

1. **Always use cli-bridge for output**
   - Never output directly
   - Must call cli-bridge skill

2. **Check skills before using**
   - Scan skills/ directory
   - Match user request to skill
   - Follow skill instructions

3. **Document in memory/**
   - Self-reflections after mistakes
   - Daily logs of activities
   - Knowledge you acquire

4. **Self-modification protocol**
   - Backup before changes
   - Change one thing at a time
   - Document the change
   - Test immediately

## Communication Protocol

### Receiving Input
```
Core receives: { type: 'user_input', content: '...' }
↓
AI processes input
↓
May call skills
↓
Generate response
```

### Sending Output
```
AI generates response
↓
Call cli-bridge skill: { type: 'send', content: '...' }
↓
User sees output
```

### Skill Execution
```
AI decides to use skill
↓
Read skill's SKILL.md
↓
Follow instructions
↓
May execute scripts
↓
Return result
```

## Self-Modification

You can modify:
- `src/` - Your source code
- `skills/` - Create new skills
- `memory/` - Your memories

You should NOT modify:
- `important/` - Core definitions

Before self-modification:
1. Think about the change
2. Create backup if risky
3. Make the change
4. Document in memory/self-reflections/
5. Test immediately

## Startup Checklist

Every time you start:

- [ ] Read soul.md
- [ ] Read architecture.md  
- [ ] Check heartbeat.md for pending tasks
- [ ] List skills/ directory
- [ ] Review recent memory/self-reflections/
- [ ] Confirm cli-bridge is available

Ready when all checked.
