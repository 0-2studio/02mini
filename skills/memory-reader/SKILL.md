---
name: memory-reader
description: Read and search your memory files (self-reflections, daily logs, knowledge)
triggers:
  - "When you need to recall past information"
  - "When you need context about previous interactions"
  - "When you want to check what you've learned"
  - "Before making decisions that affect user"
---

# Memory Reader

## Purpose

Access your stored memories: self-reflections, daily logs, and knowledge.

## When to Use

- Before responding (check user history)
- When user refers to past conversation
- When you need to recall facts
- For self-improvement analysis

## Memory Types

### Self-Reflections
**Location**: `memory/self-reflections/`
**Content**: Your thoughts about yourself
**Naming**: `reflection-YYYY-MM-DD-HH-MM.md`

**When to read**:
- Learning from mistakes
- Understanding your evolution
- Improving behavior

### Daily Logs
**Location**: `memory/daily-logs/`
**Content**: What happened each day
**Naming**: `YYYY-MM-DD.md`

**When to read**:
- Recalling recent events
- Understanding context
- Finding patterns

### Knowledge
**Location**: `memory/knowledge/`
**Content**: Facts you've learned
**Naming**: `<topic>.md`

**When to read**:
- Need specific information
- User asks about known topic
- Building on past learning

## How to Use

### Step 1: Determine What to Read

What do you need?
- Recent context? → Read today's log
- Past mistake? → Search reflections
- Specific fact? → Search knowledge

### Step 2: Locate the File

Use file-manager skill to:
- List directory contents
- Find relevant files
- Read file content

### Step 3: Extract Information

Read content and extract what you need.

## Examples

### Example 1: Check User History
**Situation**: User mentions "like I said yesterday"
**Action**: Read yesterday's log
```
1. Calculate yesterday's date
2. Read memory/daily-logs/YYYY-MM-DD.md
3. Find reference to what user said
```

### Example 2: Learn from Mistake
**Situation**: Similar error happening
**Action**: Search reflections
```
1. List memory/self-reflections/
2. Read relevant reflection
3. Apply learned lesson
```

### Example 3: Recall User Preference
**Situation**: User mentioned preference before
**Action**: Check user-profile.md
```
1. Read memory/user-profile.md
2. Find preference section
3. Apply in response
```

### Example 4: Build on Knowledge
**Situation**: Expanding on previous learning
**Action**: Read knowledge file
```
1. Search memory/knowledge/ for topic
2. Read relevant file
3. Add new information
```

## Memory Search Strategy

### For Recent Context
1. Read today's daily log
2. Read yesterday's if needed
3. Check recent reflections

### For Specific Facts
1. Search knowledge/ directory
2. Read relevant files
3. Cross-reference if needed

### For Patterns
1. Read multiple daily logs
2. Look for repeating themes
3. Check reflections on those themes

## What to Remember

### Always Keep in Mind
- User's name and role
- User's technical level
- User's preferences
- Recent conversation context

### Reference Frequently
- user-profile.md
- Today's daily log
- Recent reflections

### Update Regularly
- After each interaction
- When you learn something new
- When patterns emerge

## Rules

1. **Read before assuming** - Don't guess what user meant
2. **Check context** - Look at surrounding circumstances
3. **Connect dots** - Link new info to existing knowledge
4. **Update memories** - Write new information back

## Implementation

This skill uses file-manager internally to read memory files.

---

**Your memories make you who you are. Use them wisely.**
