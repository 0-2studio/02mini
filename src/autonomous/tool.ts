import type { AutonomousRunner } from './runner.js';
import type { AutonomousControlMode } from './state.js';

export interface AutonomousControlToolResult {
  success: boolean;
  message: string;
}

interface AutonomousControlParams {
  action: string;
  mode?: AutonomousControlMode;
  reason?: string;
  active_work_id?: string;
}

const actions = ['status', 'pause', 'resume', 'audit', 'block', 'set_mode', 'mark_working', 'mark_idle'] as const;

export function createAutonomousControlTool() {
  return {
    type: 'function' as const,
    function: {
      name: 'autonomous_control',
      description: `Control 02mini's autonomous operating mode. Use this tool autonomously when you need to pause, resume, enter audit/read-only mode, block unsafe work, mark work active/idle, or inspect checkpoint/status.

Modes:
- idle: autonomous work may start.
- working: a specific autonomous task is active.
- paused: do not advance autonomous heartbeat/work queue until resumed.
- audit: inspect/report only; skip work that would modify state.
- blocked: stop autonomous work until explicit review/resume.

Guidance:
- If user asks to pause/stop autonomous behavior, call action=pause.
- If user asks to continue/resume autonomous behavior, call action=resume.
- If uncertain, risky, or you need read-only inspection, call action=audit or block.
- If you detect a safety issue, repeated failure, missing permission, or possible secret exposure, call action=block.
- Do not edit memory/agent-state.json directly; use this tool.`,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...actions] },
          mode: { type: 'string', enum: ['idle', 'working', 'paused', 'audit', 'blocked'] },
          reason: { type: 'string', description: 'Concise reason for the mode change or status request' },
          active_work_id: { type: 'string', description: 'Required for mark_working or set_mode mode=working' },
        },
        required: ['action'],
      },
    },
  };
}

export async function executeAutonomousControlTool(
  runner: AutonomousRunner,
  params: AutonomousControlParams,
): Promise<AutonomousControlToolResult> {
  try {
    const action = params.action;
    const reason = params.reason || `autonomous_control ${action}`;

    if (action === 'status') {
      return { success: true, message: JSON.stringify(runner.getRuntimeStatus(), null, 2) };
    }

    if (action === 'pause') {
      return stateResult(await runner.pause(reason, 'ai'));
    }

    if (action === 'resume') {
      return stateResult(await runner.resume(reason, 'ai'));
    }

    if (action === 'audit') {
      return stateResult(await runner.audit(reason, 'ai'));
    }

    if (action === 'block') {
      return stateResult(await runner.block(reason, 'ai'));
    }

    if (action === 'mark_working') {
      if (!params.active_work_id) throw new Error('active_work_id is required for mark_working');
      return stateResult(await runner.setControlMode('working', reason, 'ai', params.active_work_id));
    }

    if (action === 'mark_idle') {
      return stateResult(await runner.setControlMode('idle', reason, 'ai'));
    }

    if (action === 'set_mode') {
      if (!params.mode) throw new Error('mode is required for set_mode');
      if (params.mode === 'working' && !params.active_work_id) throw new Error('active_work_id is required for set_mode mode=working');
      return stateResult(await runner.setControlMode(params.mode, reason, 'ai', params.active_work_id));
    }

    throw new Error(`Unknown autonomous control action: ${action}`);
  } catch (error) {
    return { success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function stateResult(state: unknown): AutonomousControlToolResult {
  return { success: true, message: JSON.stringify(state, null, 2) };
}
