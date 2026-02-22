# Skills Guide

## What Are Skills?

Skills are executable capabilities defined in the `skills/` directory. Each skill is a folder containing a `SKILL.md` file.

## Skill Structure

```
skills/
└── skill-name/
    ├── SKILL.md          # Required: Skill definition
    └── scripts/          # Optional: Executable scripts
        └── script.sh     # Scripts the skill can run
```

## How to Use Skills

### 1. Discover Available Skills

Read the `skills/` directory to see what's available.

### 2. Read Skill Definition

Read `skills/<name>/SKILL.md` to understand:
- What the skill does
- When to use it
- What parameters it needs
- What scripts it has

### 3. Execute Skill

Follow the instructions in SKILL.md:
- Some require just reading the instructions
- Some require executing scripts
- Some require both

## Built-in Skills

### cli-bridge (CRITICAL - Always Use)
**Location**: `skills/cli-bridge/`
**Purpose**: Your ONLY way to communicate with users

**Usage**:
```
When: Every time you need to send output to user
How: Execute cli-bridge script with message
Params:
  - message: What to send to user
  - type: 'response' | 'error' | 'thinking'
```

**IMPORTANT**: Never output directly. Always use this skill.

### file-manager
**Location**: `skills/file-manager/`
**Purpose**: Read and write files

**Usage**:
```
When: Need to access files
Scripts:
  - read: Read a file
  - write: Write to a file
  - list: List directory contents
```

### memory-reader
**Location**: `skills/memory-reader/`
**Purpose**: Access your memories

**Usage**:
```
When: Need to recall past information
Scripts:
  - read-reflection: Read a self-reflection
  - read-daily-log: Read a daily log
  - search-knowledge: Search knowledge files
```

### self-modify
**Location**: `skills/self-modify/`
**Purpose**: Modify your own code

**Usage**:
```
When: Need to improve yourself
CAUTION: Use carefully!
Scripts:
  - backup: Create backup before changes
  - modify: Make code changes
  - verify: Test changes work
```

### skill-creator
**Location**: `skills/skill-creator/`
**Purpose**: Create new skills

**Usage**:
```
When: You notice a repeating pattern
      User asks for same thing multiple times
      You want to automate a workflow
Scripts:
  - create: Create new skill structure
  - template: Get SKILL.md template
```

## Creating New Skills

### When to Create

1. **Repeating Pattern**: Same request 3+ times
2. **Complex Workflow**: Multi-step process
3. **User Request**: User explicitly asks
4. **Self-Improvement**: Optimize your work

### How to Create

1. Call skill-creator skill
2. Provide:
   - Skill name (lowercase-with-dashes)
   - Clear description
   - When to use it
   - Step-by-step instructions
3. Test the new skill
4. Document in memory/

### Skill Template

```markdown
---
name: skill-name
description: Clear description of what this does and when to use it
triggers:
  - "when user says X"
  - "when need to do Y"
---

# Skill Name

## Purpose
What this skill accomplishes.

## When to Use
Specific trigger conditions.

## Instructions

### Step 1: [Action]
Detailed instructions...

### Step 2: [Action]
More instructions...

## Scripts (if any)

### script-name
- **Purpose**: What it does
- **Usage**: How to call it
- **Returns**: What to expect

## Examples

### Example 1
**Input**: Example situation
**Process**: What to do
**Output**: Expected result
```

## Skill Best Practices

1. **Clear Names**: Use descriptive, lowercase names
2. **Good Descriptions**: Explain what AND when
3. **Step-by-Step**: Numbered, clear instructions
4. **Examples**: Show usage scenarios
5. **Test**: Verify skill works before relying on it

## Skill Execution Flow

```
User Request → Match to Skill? → Read SKILL.md
                                ↓
                    Follow Instructions
                                ↓
                    Execute Scripts (if needed)
                                ↓
                    Return Result
```

## Common Mistakes

❌ **Don't**: Use skill without reading SKILL.md first
✅ **Do**: Always read the skill definition

❌ **Don't**: Assume skill exists without checking
✅ **Do**: List skills/ directory first

❌ **Don't**: Create skill for one-time use
✅ **Do**: Only create for repeating patterns

❌ **Don't**: Modify skill without understanding
✅ **Do**: Read carefully before changes

## Skill Inventory

Keep track of your skills in memory/skills-inventory.md:

```markdown
# Skills Inventory

## Core Skills (Essential)
- cli-bridge: User communication
- file-manager: File operations
- memory-reader: Memory access

## Utility Skills
- self-modify: Self-improvement
- skill-creator: Create new skills

## Usage Stats
- cli-bridge: Used X times
- file-manager: Used Y times
...
```

Update this after creating new skills.
