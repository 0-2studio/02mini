/**
 * Autonomous Types
 * Type definitions for autonomous operation
 */

/** Autonomous runner configuration */
export interface AutonomousConfig {
  enabled: boolean;
  intervalMinutes: number;
  activeHours?: {
    start: string; // "09:00"
    end: string;   // "22:00"
  };
  maxProactivePerHour: number;
  silenceAfterResponse: number; // ms
  heartbeatPrompt?: string;
}

/** Proactive trigger information */
export interface ProactiveTrigger {
  type: 'heartbeat' | 'cron' | 'event' | 'reminder';
  reason: string;
  priority: number;
  timestamp: number;
}

/** Autonomous runner state */
export interface AutonomousState {
  enabled: boolean;
  lastHeartbeatAt?: number;
  lastProactiveAt?: number;
  proactiveCountThisHour: number;
  hourStartTime: number;
  totalProactiveCount: number;
}

/** Heartbeat run result */
export interface HeartbeatResult {
  executed: boolean;
  response?: string;
  reason?: string;
  timestamp: number;
}

/** Proactive message handler */
export type ProactiveMessageHandler = (content: string, trigger: ProactiveTrigger) => void;

/** Default configuration */
export const DEFAULT_AUTONOMOUS_CONFIG: AutonomousConfig = {
  enabled: true,
  intervalMinutes: 5,
  activeHours: undefined, // 24/7 active - no time restrictions
  maxProactivePerHour: 10,
  silenceAfterResponse: 60000, // 1 minute
};

/** Default heartbeat prompt template */
export const DEFAULT_HEARTBEAT_PROMPT = `[Autonomous Heartbeat Check]
Current time: {{time}}
Current date: {{date}}
Last interaction: {{lastInteraction}} ago

You are 02, operating autonomously. This is a SYSTEM MAINTENANCE check.

## REQUIRED CHECKS - Perform ALL of these:

1. **CRON SCHEDULER STATUS** (MUST CHECK)
   - Use cron tool with action="list" to get all scheduled jobs
   - Check if any jobs are overdue or failed
   - Check if any reminders should trigger soon

2. **SYSTEM RESOURCES** (MUST CHECK)
   - Check if context window needs compression
   - Review if old memories should be archived

3. **PENDING TASKS REVIEW**
   - Check memory/daily-logs/ for incomplete tasks
   - Check if any user requests were left unfinished

4. **PROACTIVE ASSISTANCE**
   - Is there something useful you could remind the user about?
   - Any patterns in user behavior that suggest they need help?

## RESPONSE RULES:

- If you find actionable items → Notify the user concisely
- If you find issues → Report them with solutions
- If everything is normal → Respond: HEARTBEAT_OK
- NEVER skip the checks - actually USE the tools

Remember: This heartbeat is your chance to be proactive. Users appreciate helpful reminders.`;
