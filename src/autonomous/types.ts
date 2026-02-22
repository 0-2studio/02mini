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
Scheduled tasks: {{scheduledTasks}}

You are 02, operating autonomously. Review the following and decide if you need to proactively message the user:

1. Check if any scheduled reminders are due
2. Review pending tasks that need follow-up
3. Check if there's important information to share
4. Consider if the user might need assistance based on context

If you have something meaningful to communicate, respond with your message.
If there's nothing important to say, respond with exactly: HEARTBEAT_OK

Be concise and helpful. Do not send routine status updates unless there's actionable information.`;
