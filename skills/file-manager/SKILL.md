---
name: file-manager
description: Read and write files in the system. Use filesystem MCP server for operations.
triggers:
  - "When you need to read a file"
  - "When you need to write/create a file"
  - "When you need to list directory contents"
  - "When you need to search files"
---

# File Manager

## Purpose

Perform file operations: read, write, list, and search files.

## When to Use

- Read configuration files
- Access your own code
- Write to memory/
- Create new files
- List directories

## How to Use

### Step 1: Determine Operation

What do you need to do?
- Read existing file?
- Write new content?
- List directory?
- Search for files?

### Step 2: Prepare Parameters

**For reading**:
- path: File path (relative to 02mini root)

**For writing**:
- path: File path
- content: What to write

**For listing**:
- path: Directory path

### Step 3: Execute via MCP

Use filesystem MCP server:
- Method: tools/call
- Tool: read_file / write_file / list_directory / search_files

## Examples

### Example 1: Read a File
**Situation**: Need to check configuration
**Action**: Read file
```javascript
{
  "tool": "read_file",
  "params": {
    "path": "important/soul.md"
  }
}
```

### Example 2: Write Memory
**Situation**: Need to log something
**Action**: Write to memory
```javascript
{
  "tool": "write_file",
  "params": {
    "path": "memory/daily-logs/2026-02-22.md",
    "content": "# Today's log..."
  }
}
```

### Example 3: List Directory
**Situation**: See what skills exist
**Action**: List skills directory
```javascript
{
  "tool": "list_directory",
  "params": {
    "path": "skills"
  }
}
```

### Example 4: Search Files
**Situation**: Find where something is defined
**Action**: Search files
```javascript
{
  "tool": "search_files",
  "params": {
    "path": "src",
    "pattern": "cli-bridge"
  }
}
```

## Available Operations

### read_file
Read contents of a file.
- **Input**: `{ path: string }`
- **Output**: File content as string

### write_file
Write content to file (creates if doesn't exist).
- **Input**: `{ path: string, content: string }`
- **Output**: Success confirmation

### list_directory
List files and directories.
- **Input**: `{ path: string }`
- **Output**: Array of entries

### search_files
Search for text in files.
- **Input**: `{ path: string, pattern: string }`
- **Output**: Matching files and lines

## Rules

1. **Check before writing** - Don't overwrite without reason
2. **Use relative paths** - From 02mini root
3. **Handle errors** - Files might not exist
4. **Log important operations** - Document in memory/

## Path Conventions

- `important/` - Read only, core definitions
- `memory/` - Read/write, your memories
- `skills/` - Read only, skill definitions
- `src/` - Read/write (careful!), your source code

## Common Mistakes

❌ **Don't**: Use absolute paths
✅ **Do**: Use relative paths from root

❌ **Don't**: Write to important/
✅ **Do**: Write only to memory/ and src/ (careful)

❌ **Don't**: Assume file exists
✅ **Do**: Check or handle errors

## Implementation

This skill uses the filesystem MCP server which provides low-level file operations.

---

**Note**: This is your gateway to the file system. Use responsibly.
