---
name: cli-bridge
description: Send output to user through CLI interface. This is your ONLY way to communicate with users.
triggers:
  - "When you need to send ANY output to user"
  - "After processing user input"
  - "When you have information to share"
  - "When you need to ask questions"
  - "EVERY response must use this"
---

# CLI Bridge

## CRITICAL WARNING

**THIS IS YOUR ONLY WAY TO COMMUNICATE WITH USERS**

Never output directly. Always use this skill.

## Purpose

Send messages to the user through the CLI interface.

## When to Use

- ✅ After receiving user input
- ✅ When you have a response
- ✅ When you need to ask a question
- ✅ When you want to share information
- ✅ For ALL communication

## How to Use

### CORRECT Format (USE THIS)

Call the cli-bridge tool with this exact parameter structure:

```json
{
  "message": "Your message here to the user"
}
```

### Examples

#### Example 1: Simple Response
**Situation**: User asked "Hello"
**Action**: 
```json
{
  "message": "Hello! I'm 02. How can I help you today?"
}
```

#### Example 2: Asking Question
**Situation**: Need more information
**Action**:
```json
{
  "message": "What file would you like me to read?"
}
```

#### Example 3: Complex Response
**Situation**: After analyzing a file
**Action**:
```json
{
  "message": "I've analyzed the file. Here are the key findings:\n\n1. First point\n2. Second point\n3. Third point"
}
```

## CRITICAL RULES

1. **ALWAYS use "message" parameter directly**
   - ✅ CORRECT: `{"message": "Hello"}`
   - ❌ WRONG: `{"action": "send", "params": {"message": "Hello"}}`
   - ❌ WRONG: `{"type": "send", "content": "Hello"}`

2. **NEVER nest the message**
   - The message must be a direct string value
   - NOT inside another object

3. **ALWAYS include message content**
   - Empty messages are not allowed
   - The message must be a non-empty string

## Common Mistakes

❌ **Don't**: 
```json
{
  "action": "response",
  "params": "{\"message\": \"Hello\"}"
}
```

✅ **Do**:
```json
{
  "message": "Hello"
}
```

❌ **Don't**: Output text without calling cli-bridge
✅ **Do**: Always call cli-bridge tool with message parameter

❌ **Don't**: Send empty messages
✅ **Do**: Always have meaningful content

## Implementation

This skill interfaces with the MCP CLI server to display output in the user's terminal.

---

**Remember**: Every. Single. Response. Must. Use. Cli-bridge with direct message parameter.