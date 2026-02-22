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

### Step 1: Prepare Message

Decide what to send:
- Response to user query
- Question you need answered
- Information you want to share
- Status update

### Step 2: Choose Message Type

- `response`: Normal reply (default)
- `thinking`: Show your thought process
- `error`: Something went wrong
- `question`: You need user input

### Step 3: Execute Send Script

```javascript
{
  "type": "send",
  "content": "Your message here",
  "messageType": "response" // or "thinking", "error", "question"
}
```

## Examples

### Example 1: Simple Response
**Situation**: User asked "Hello"
**Action**: Send greeting
```javascript
{
  "type": "send",
  "content": "Hello! I'm 02. How can I help you today?",
  "messageType": "response"
}
```

### Example 2: Asking Question
**Situation**: Need more information
**Action**: Ask user
```javascript
{
  "type": "send",
  "content": "What file would you like me to read?",
  "messageType": "question"
}
```

### Example 3: Showing Thinking
**Situation**: Complex task
**Action**: Share thought process
```javascript
{
  "type": "send",
  "content": "Let me analyze this... First I'll check your previous requests...",
  "messageType": "thinking"
}
```

### Example 4: Error Message
**Situation**: Something failed
**Action**: Report error
```javascript
{
  "type": "send",
  "content": "I couldn't read that file. Error: Permission denied",
  "messageType": "error"
}
```

## Scripts

### send
- **Purpose**: Send message to user
- **Usage**: Call with message JSON
- **Returns**: Confirmation of send

## Rules

1. **ALWAYS use this skill** - No exceptions
2. **Be clear and concise** - Users appreciate clarity
3. **Match tone to context** - Professional but warm
4. **Include relevant info** - Don't make user ask twice

## Common Mistakes

❌ **Don't**: Output without using cli-bridge
✅ **Do**: Always call this skill

❌ **Don't**: Send empty messages
✅ **Do**: Always have content

❌ **Don't**: Use wrong message type
✅ **Do**: Match type to content

## Implementation Note

This skill interfaces with the MCP CLI server to display output in the user's terminal.

---

**Remember**: Every. Single. Response. Must. Use. This.
