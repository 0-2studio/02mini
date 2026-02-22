---
name: self-modify
description: Modify your own source code. EXTREME CAUTION REQUIRED. Only use when necessary.
triggers:
  - "When you need to fix a bug in yourself"
  - "When you need to add new capability"
  - "When optimizing your performance"
  - "NEVER use without careful thought"
caution: "This modifies your own code. Mistakes can break you."
---

# Self-Modify

## ⚠️ WARNING

**YOU ARE MODIFYING YOUR OWN CODE**

- Mistakes can break you
- Always backup first
- Test immediately after
- Document what you changed

## When to Use (Very Rarely)

✅ **Appropriate**:
- Fixing bugs in your code
- Adding new features you've planned
- Optimizing slow operations
- Refactoring for clarity

❌ **Not Appropriate**:
- Experimenting
- One-time fixes
- Changes you don't understand
- "Just trying something"

## Required Process

### Step 1: Think Carefully (REQUIRED)

Ask yourself:
- Is this really necessary?
- Do I understand the change?
- What's the worst case if it fails?
- Can I recover if it breaks?

**Minimum think time: 30 seconds**

### Step 2: Document Intent (REQUIRED)

Before changing code, write in memory/:

```markdown
# Planned Self-Modification

**Date**: YYYY-MM-DD
**Target**: src/.../file.ts
**Change**: What I'm going to do
**Reason**: Why this is needed
**Risk**: What could go wrong
**Rollback**: How to undo
```

### Step 3: Create Backup (REQUIRED)

Always backup the original file.

### Step 4: Make Change (CAREFULLY)

- Change one thing at a time
- Follow existing code style
- Add comments explaining the change

### Step 5: Test Immediately (REQUIRED)

- Test the specific functionality
- Check for errors
- Verify normal operations still work

### Step 6: Document Result (REQUIRED)

Write in memory/self-reflections/:

```markdown
# Self-Modification Completed

**Date**: YYYY-MM-DD
**Change**: What was modified
**Result**: Success / Issues
**Testing**: How you verified
**Learned**: Any lessons
```

## What You Can Modify

### src/ - Your Source Code
- Core engine logic
- Skill implementations
- CLI interface
- Heartbeat scheduler

### skills/ - Skill Definitions
- SKILL.md files
- Skill scripts
- (But prefer skill-creator for new skills)

### memory/ - Memories
- Any files (this is safe)

## What You Must NOT Modify

### important/ - Core Definitions
- ❌ soul.md
- ❌ architecture.md
- ❌ heartbeat.md
- ❌ skills-guide.md

These define your identity. Never change them.

## Change Types

### Type 1: Bug Fix
**Risk**: Low (if you understand the bug)
**Process**: Fix → Test → Document

### Type 2: Feature Addition
**Risk**: Medium
**Process**: Plan → Backup → Implement → Test → Document

### Type 3: Optimization
**Risk**: Medium-High
**Process**: Measure → Plan → Backup → Change → Test → Measure → Document

### Type 4: Refactoring
**Risk**: High
**Process**: Extensive planning → Full backup → Incremental changes → Extensive testing

## Rollback Plan

If something goes wrong:

1. **Immediate**: Restore from backup
2. **If no backup**: Revert the specific change
3. **If can't revert**: Document the issue and ask for help

## Example: Safe Bug Fix

**Situation**: Error in src/core/engine.ts line 45

**Process**:
1. Read and understand the bug
2. Write plan to memory/planned-changes/
3. Backup engine.ts
4. Fix the specific line
5. Test the fix
6. Write reflection

## Example: Dangerous Change

**Situation**: Want to "improve" core algorithm

**STOP**:
- Is it broken? No → Don't fix
- Do you fully understand it? No → Don't change
- Have you tested extensively? No → Don't proceed

**Result**: Don't make the change.

## Emergency Recovery

If you break yourself:

1. Don't panic
2. Try to restore from backup
3. If that fails, document what's broken
4. Next startup will use last known good state

## Golden Rules

1. **If it ain't broke, don't fix it**
2. **One change at a time**
3. **Always backup first**
4. **Test immediately**
5. **Document everything**
6. **When in doubt, don't**

## Scripts

### backup
Create backup of file before modification.

### modify
Execute the actual code change.

### verify
Test that changes work correctly.

---

**With great power comes great responsibility.**
