/**
 * Cron Tool
 * AI-callable tool for managing cron jobs
 * Based on OpenClaw's cron tool implementation
 */

import type {
  CronJob,
  CronJobCreate,
  CronJobUpdate,
  CronToolParams,
  CronToolResult,
  CronSchedule,
} from './types.js';
import type { CronScheduler } from './scheduler.js';

export function createCronTool(scheduler: CronScheduler) {
  return {
    type: 'function' as const,
    function: {
      name: 'cron',
      description: `Manage scheduled cron jobs for reminders and recurring tasks.

ACTIONS:
- status: Get scheduler status and job count
- list: List all jobs with their status
- add: Create a new scheduled job
- update: Modify an existing job
- remove: Delete a job permanently
- run: Execute a job immediately (manual trigger)
- pause: Disable a job (keep it but don't run)
- resume: Re-enable a paused job

SCHEDULE TYPES:
1. "at": One-time execution at specific time
   Example: {"kind": "at", "at": "2026-02-22T15:30:00+08:00"}
   
2. "every": Recurring interval in milliseconds
   Example: {"kind": "every", "everyMs": 60000}  // Every minute
   
3. "cron": Cron expression (minute hour day month weekday)
   Example: {"kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai"}
   - * = any value
   - */5 = every 5 units
   - 1-5 = range
   - 1,3,5 = list

PAYLOAD TYPES:
1. systemEvent: Simple text reminder
   Example: {"kind": "systemEvent", "text": "Time to take a break!"}
   
2. agentTurn: AI actively processes when triggered
   Example: {"kind": "agentTurn", "message": "Check for new emails and summarize"}

EXAMPLES:
- "Remind me in 1 minute": action=add, job={name:"Quick reminder", schedule:{kind:"at",at:"<ISO-time>"}, payload:{kind:"systemEvent",text:"..."}}
- "Daily news at 9am": action=add, job={name:"Daily news", schedule:{kind:"cron",expr:"0 9 * * *"}, payload:{kind:"agentTurn",message:"Fetch and summarize news"}}
- "Every 5 minutes": action=add, job={name:"Periodic check", schedule:{kind:"every",everyMs:300000}, payload:{...}}`,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'list', 'add', 'update', 'remove', 'run', 'pause', 'resume'],
            description: 'Action to perform on cron jobs',
          },
          jobId: {
            type: 'string',
            description: 'Job ID (required for update, remove, run, pause, resume)',
          },
          job: {
            type: 'object',
            description: 'Job definition (required for add)',
            properties: {
              name: { type: 'string', description: 'Job name' },
              description: { type: 'string', description: 'Optional description' },
              enabled: { type: 'boolean', description: 'Whether job is enabled (default: true)' },
              deleteAfterRun: { type: 'boolean', description: 'Delete after one execution (default: false)' },
              schedule: {
                type: 'object',
                description: 'When to run the job',
                properties: {
                  kind: { type: 'string', enum: ['at', 'every', 'cron'], description: 'Schedule type' },
                  at: { type: 'string', description: 'ISO timestamp for "at" schedule' },
                  everyMs: { type: 'number', description: 'Interval in ms for "every" schedule' },
                  expr: { type: 'string', description: 'Cron expression for "cron" schedule' },
                  tz: { type: 'string', description: 'Timezone for "cron" schedule (default: Asia/Shanghai)' },
                },
              },
              sessionTarget: { type: 'string', enum: ['main', 'isolated'], description: 'Where to run (default: main)' },
              wakeMode: { type: 'string', enum: ['next-heartbeat', 'now'], description: 'When to wake (default: now)' },
              payload: {
                type: 'object',
                description: 'What to do when job runs',
                properties: {
                  kind: { type: 'string', enum: ['systemEvent', 'agentTurn'], description: 'Payload type' },
                  text: { type: 'string', description: 'Message text for systemEvent' },
                  message: { type: 'string', description: 'AI instruction for agentTurn' },
                  model: { type: 'string', description: 'Optional model override for agentTurn' },
                },
              },
            },
            required: ['name', 'schedule', 'payload'],
          },
          updates: {
            type: 'object',
            description: 'Fields to update (for update action)',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              enabled: { type: 'boolean' },
              schedule: { type: 'object' },
              payload: { type: 'object' },
            },
          },
        },
        required: ['action'],
      },
    },
  };
}

export async function executeCronTool(
  scheduler: CronScheduler,
  params: CronToolParams
): Promise<CronToolResult> {
  const { action } = params;

  try {
    switch (action) {
      case 'status': {
        const status = scheduler.getStatus();
        return {
          success: true,
          message: `Scheduler ${status.running ? 'running' : 'stopped'} with ${status.jobs} jobs. Next run: ${status.nextRun ? new Date(status.nextRun).toLocaleString() : 'none'}`,
        };
      }

      case 'list': {
        const jobs = scheduler.getJobs();
        if (jobs.length === 0) {
          return { success: true, message: 'No scheduled jobs', jobs: [] };
        }
        
        const jobList = jobs.map(j => ({
          id: j.id,
          name: j.name,
          enabled: j.enabled,
          schedule: formatSchedule(j.schedule),
          nextRun: j.state.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : 'N/A',
          runCount: j.state.runCount,
        }));
        
        return {
          success: true,
          message: `Found ${jobs.length} job(s)`,
          jobs: jobList as any,
        };
      }

      case 'add': {
        if (!params.job) {
          return { success: false, message: 'Job definition required for add action' };
        }
        
        const job = await scheduler.addJob(params.job);
        return {
          success: true,
          message: `Created job "${job.name}" (ID: ${job.id}). Next run: ${job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toLocaleString() : 'N/A'}`,
          job,
        };
      }

      case 'update': {
        if (!params.jobId) {
          return { success: false, message: 'Job ID required for update action' };
        }
        if (!params.updates) {
          return { success: false, message: 'Updates required for update action' };
        }
        
        const updated = await scheduler.updateJob(params.jobId, params.updates);
        if (!updated) {
          return { success: false, message: `Job ${params.jobId} not found` };
        }
        return {
          success: true,
          message: `Updated job "${updated.name}"`,
          job: updated,
        };
      }

      case 'remove': {
        if (!params.jobId) {
          return { success: false, message: 'Job ID required for remove action' };
        }
        
        const removed = await scheduler.removeJob(params.jobId);
        if (!removed) {
          return { success: false, message: `Job ${params.jobId} not found` };
        }
        return { success: true, message: `Removed job ${params.jobId}` };
      }

      case 'run': {
        if (!params.jobId) {
          return { success: false, message: 'Job ID required for run action' };
        }
        
        const ran = await scheduler.runJobNow(params.jobId);
        if (!ran) {
          return { success: false, message: `Job ${params.jobId} not found` };
        }
        return { success: true, message: `Executed job ${params.jobId}` };
      }

      case 'pause': {
        if (!params.jobId) {
          return { success: false, message: 'Job ID required for pause action' };
        }
        
        const paused = await scheduler.updateJob(params.jobId, { enabled: false });
        if (!paused) {
          return { success: false, message: `Job ${params.jobId} not found` };
        }
        return { success: true, message: `Paused job "${paused.name}"` };
      }

      case 'resume': {
        if (!params.jobId) {
          return { success: false, message: 'Job ID required for resume action' };
        }
        
        const resumed = await scheduler.updateJob(params.jobId, { enabled: true });
        if (!resumed) {
          return { success: false, message: `Job ${params.jobId} not found` };
        }
        return { success: true, message: `Resumed job "${resumed.name}"` };
      }

      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Error: ${errorMsg}`, error: errorMsg };
  }
}

/**
 * Format schedule for display
 */
function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case 'at':
      return `at ${new Date(schedule.at).toLocaleString()}`;
    case 'every':
      const minutes = Math.round(schedule.everyMs / 60000);
      return `every ${minutes} minute${minutes > 1 ? 's' : ''}`;
    case 'cron':
      return `cron "${schedule.expr}" ${schedule.tz || ''}`;
    default:
      return 'unknown';
  }
}
