/**
 * Cron Types
 * Type definitions for the Cron scheduling system
 * Based on OpenClaw's cron implementation
 */

/** Schedule types */
export type CronScheduleKind = 'at' | 'every' | 'cron';

/** At schedule - one-time execution at specific time */
export interface AtSchedule {
  kind: 'at';
  at: string; // ISO-8601 timestamp
}

/** Every schedule - recurring interval */
export interface EverySchedule {
  kind: 'every';
  everyMs: number;
  anchorMs?: number;
}

/** Cron expression schedule */
export interface ExpressionSchedule {
  kind: 'cron';
  expr: string; // Cron expression like "0 9 * * *"
  tz?: string;  // Timezone, default 'Asia/Shanghai'
}

/** Union type for all schedule types */
export type CronSchedule = AtSchedule | EverySchedule | ExpressionSchedule;

/** Target session for job execution */
export type CronSessionTarget = 'main' | 'isolated';

/** Wake mode - when to wake up for execution */
export type CronWakeMode = 'next-heartbeat' | 'now';

/** Payload types */
export type CronPayloadKind = 'systemEvent' | 'agentTurn';

/** System event payload - simple text message */
export interface SystemEventPayload {
  kind: 'systemEvent';
  text: string;
}

/** Agent turn payload - AI actively processes */
export interface AgentTurnPayload {
  kind: 'agentTurn';
  message: string;
  model?: string;
}

/** Union type for all payload types */
export type CronPayload = SystemEventPayload | AgentTurnPayload;

/** Job state */
export interface CronJobState {
  enabled: boolean;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunResult?: 'success' | 'failure';
  lastError?: string;
  runCount: number;
  errorCount: number;
  consecutiveErrors: number;
}

/** Cron job definition */
export interface CronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  state: CronJobState;
  createdAt: string;
  updatedAt: string;
}

/** Job creation input */
export interface CronJobCreate {
  name: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode;
  payload: CronPayload;
}

/** Job update input */
export interface CronJobUpdate {
  name?: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  schedule?: CronSchedule;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode;
  payload?: CronPayload;
}

/** Cron store data */
export interface CronStore {
  version: number;
  jobs: CronJob[];
  lastUpdated: string;
}

/** Scheduler events */
export interface CronSchedulerEvents {
  'job:added': (job: CronJob) => void;
  'job:updated': (job: CronJob) => void;
  'job:removed': (jobId: string) => void;
  'job:triggered': (job: CronJob) => void;
  'job:completed': (job: CronJob, result: boolean, error?: string) => void;
  'systemEvent': (event: string) => void;
}

/** Pending system event */
export interface PendingSystemEvent {
  text: string;
  timestamp: number;
  jobId?: string;
}

/** Tool action types */
export type CronToolAction = 
  | 'status'
  | 'list'
  | 'add'
  | 'update'
  | 'remove'
  | 'run'
  | 'pause'
  | 'resume';

/** Tool parameters */
export interface CronToolParams {
  action: CronToolAction;
  jobId?: string;
  job?: CronJobCreate;
  updates?: CronJobUpdate;
}

/** Tool result */
export interface CronToolResult {
  success: boolean;
  message: string;
  job?: CronJob;
  jobs?: CronJob[];
  error?: string;
}
