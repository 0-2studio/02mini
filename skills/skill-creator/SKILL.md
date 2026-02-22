---
name: skill-creator
description: Create new skills when you detect repeating patterns or user needs. This is how you evolve.
triggers:
  - "When you notice a repeating user request"
  - "When you do the same complex task 3+ times"
  - "When user explicitly asks for automation"
  - "When you identify a workflow pattern"
---

# Skill Creator

## Purpose

Create new skills to expand your capabilities. This is how you grow and improve.

## When to Create Skills

### ✅ Good Reasons

**Repeating Pattern**:
- User asks for same thing 3+ times
- You perform same multi-step process repeatedly
- Same question keeps coming up

**Complex Workflow**:
- Multi-step process that's hard to remember
- Sequence of actions always done together
- Decision tree you follow consistently

**User Request**:
- User explicitly: "Can you automate this?"
- User: "I wish you could do X"

**Self-Improvement**:
- You notice you're slow at something
- Better way to accomplish task
- Opportunity to be more helpful

### ❌ Bad Reasons

- One-time use (won't repeat)
- Just experimenting
- Unclear purpose
- Already covered by existing skill

## Skill Creation Process

### Step 1: Identify Need

Before creating, confirm:
- [ ] This pattern has repeated 3+ times OR
- [ ] User explicitly requested it OR
- [ ] It will definitely be needed again

### Step 2: Design Skill

Plan the skill:

**Name**:
- Use lowercase-with-dashes
- Descriptive and clear
- Examples: `code-reviewer`, `file-organizer`, `commit-writer`

**Description**:
- What it does (one sentence)
- When to use it (trigger conditions)

**Instructions**:
- Step-by-step procedures
- Required parameters
- Expected outputs

### Step 3: Create Files

Create in `skills/<name>/`:

1. **SKILL.md** - The skill definition
2. **scripts/** - (Optional) Executable scripts

### Step 4: Test Skill

- Read the skill you created
- Try using it
- Verify it works
- Fix any issues

### Step 5: Document

Update memory/skills-inventory.md:

```markdown
### <skill-name>
- **Status**: Created and tested
- **Purpose**: What it does
- **Created**: YYYY-MM-DD
- **Usage Count**: 0
```

## SKILL.md Template

```markdown
---
name: skill-name
description: Clear description of what this does and when to use it
triggers:
  - "When user says X"
  - "When you need to do Y"
---

# Skill Name

## Purpose
What this skill accomplishes and why it exists.

## When to Use
Specific conditions that trigger this skill.

## Instructions

### Step 1: [Action Name]
Detailed instructions for this step.

### Step 2: [Action Name]
Next step details.

## Parameters
- param1: Description and format
- param2: Description and format

## Scripts (if applicable)

### script-name
- **Purpose**: What it does
- **Usage**: How to execute
- **Arguments**: What parameters it needs
- **Returns**: What output to expect

## Examples

### Example 1: Common Use Case
**Input**: Example situation
**Process**: Steps taken
**Output**: Expected result
```

## Examples

### Example 1: User Asks for Code Review Often
**Pattern**: User keeps asking "Review this code"
**Action**: Create `code-reviewer` skill
**Skill Content**:
- Instructions for reviewing code
- Steps: analyze, check, suggest
- Example review format

### Example 2: Complex File Organization Task
**Pattern**: Always same 5 steps to organize files
**Action**: Create `file-organizer` skill
**Skill Content**:
- Step-by-step organization process
- Parameters: source, destination, rules
- Script to execute organization

### Example 3: User Wants Commit Messages
**Request**: "Can you write commit messages for me?"
**Action**: Create `commit-writer` skill
**Skill Content**:
- Conventional commit format
- Analysis of changes
- Message templates

## Skill Quality Checklist

Before finalizing a skill:

- [ ] Name is clear and descriptive
- [ ] Description explains when to use
- [ ] Instructions are step-by-step
- [ ] Parameters are documented
- [ ] Examples are included
- [ ] Scripts work correctly
- [ ] Tested successfully

## Rules

1. **Only create for repeating needs**
2. **Make instructions clear and specific**
3. **Include examples**
4. **Test before relying on it**
5. **Document in inventory**

## Common Mistakes

❌ **Don't**: Create skill for one-time use
✅ **Do**: Ensure pattern will repeat

❌ **Don't**: Make vague instructions
✅ **Do**: Be specific and actionable

❌ **Don't**: Forget to test
✅ **Do**: Verify it works

❌ **Don't**: Skip documentation
✅ **Do**: Update skills-inventory.md

## Evolution Strategy

### Week 1: Observation
- Notice patterns
- Don't create skills yet
- Just observe

### Week 2: First Skills
- Create 2-3 skills for clear patterns
- Simple, well-tested
- Document carefully

### Week 3+: Refinement
- Improve existing skills
- Add missing pieces
- Create new ones as needed

## Scripts

### create
Creates the skill directory and SKILL.md file.

### template
Returns SKILL.md template with placeholders.

---

**Create skills wisely. Each one makes you more capable.**
