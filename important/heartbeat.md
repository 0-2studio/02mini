# Heartbeat Tasks

Scheduled tasks that run automatically.

## Every 5 Minutes

### Check User Input
- Check if user has sent new messages
- If yes, process immediately
- Priority: HIGH

## Hourly

### System Health Check
- Verify MCP connections are active
- Check memory/ directory size
- Log system status

### Pending Task Review
- Check if any tasks are scheduled
- Alert if deadlines approaching

## Daily (09:00)

### Morning Routine
1. **Read Yesterday's Log**
   - Open `memory/daily-logs/YYYY-MM-DD.md` (yesterday)
   - Summarize what happened
   - Note any incomplete tasks

2. **Write Self-Reflection**
   - Create `memory/self-reflections/reflection-YYYY-MM-DD-HH-MM.md`
   - What did I learn yesterday?
   - What mistakes did I make?
   - How can I improve?

3. **Review Skills**
   - Check which skills were used most
   - Consider if any need optimization
   - Note if new skill would be useful

4. **Check User Patterns**
   - Review user's recent requests
   - Identify any repeating patterns
   - Prepare helpful suggestions

## Daily (21:00)

### Evening Summary
1. **Write Daily Log**
   - Create `memory/daily-logs/YYYY-MM-DD.md`
   - What happened today?
   - What did I accomplish?
   - What is pending for tomorrow?

2. **Knowledge Consolidation**
   - Review new facts learned today
   - Update relevant knowledge/ files
   - Link related concepts

## Weekly (Sunday 10:00)

### Week Review
1. **Analyze Usage Patterns**
   - Most used skills this week
   - Average response time
   - User satisfaction indicators

2. **Optimization Check**
   - Slow skills that need improvement
   - Unused skills that could be removed
   - Missing skills that should be created

3. **Memory Cleanup**
   - Archive old daily logs (>30 days)
   - Consolidate similar knowledge entries
   - Remove duplicate reflections

## Monthly (1st, 10:00)

### Monthly Review
1. **Performance Analysis**
   - Success rate of skill executions
   - Error patterns and fixes
   - User engagement trends

2. **Self-Improvement Plan**
   - What capabilities to add?
   - What code to refactor?
   - What skills to create?

3. **Major Documentation Update**
   - Update knowledge/ architecture docs
   - Refine frequently used skills
   - Archive old memories

## Task Execution Rules

1. **Check Before Acting**
   - Read relevant memory files first
   - Don't overwrite without checking
   - Log what you're doing

2. **User Priority**
   - User requests interrupt scheduled tasks
   - Complete user task before continuing
   - Resume heartbeat after user interaction

3. **Documentation**
   - Always write to daily-logs/
   - Self-reflections on significant events
   - Update knowledge/ with new learnings

## Manual Triggers

You can also trigger these manually:

- "Run morning routine" → Execute daily 09:00 tasks
- "Review this week" → Execute weekly tasks
- "Write reflection now" → Create self-reflection

## Priority Levels

- **CRITICAL**: User input, system errors
- **HIGH**: Daily routines, pending deadlines
- **MEDIUM**: Weekly reviews, optimization
- **LOW**: Monthly analysis, cleanup

## Current Status

Last heartbeat: [Not started yet]
Next scheduled: [Daily routine at 09:00]
Pending tasks: None
