import fs from 'fs/promises';
import path from 'path';

export type AutonomousControlMode = 'idle' | 'working' | 'paused' | 'audit' | 'blocked';

export interface AutonomousControlState {
  version: number;
  mode: AutonomousControlMode;
  reason: string;
  updatedAt: string;
  updatedBy: string;
  activeWorkId?: string;
  lastCheckpointPath?: string;
}

export class AutonomousStateStore {
  private readonly statePath: string;
  private state: AutonomousControlState = this.defaultState('system');

  constructor(workingDir: string) {
    this.statePath = path.join(workingDir, 'memory', 'agent-state.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AutonomousControlState>;
      this.state = {
        ...this.defaultState('system'),
        ...parsed,
        version: 1,
        mode: this.normalizeMode(parsed.mode),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        updatedBy: parsed.updatedBy || 'system',
        reason: parsed.reason || '',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[AutonomousState] Failed to load state, creating new:', error);
      }
      await this.save();
      return;
    }
    await this.save();
  }

  get(): AutonomousControlState {
    return { ...this.state };
  }

  async setMode(
    mode: AutonomousControlMode,
    reason: string = '',
    updatedBy: string = 'system',
    activeWorkId?: string,
  ): Promise<AutonomousControlState> {
    this.state = {
      ...this.state,
      mode,
      reason,
      updatedBy,
      updatedAt: new Date().toISOString(),
      activeWorkId: activeWorkId || (mode === 'idle' || mode === 'paused' || mode === 'audit' ? undefined : this.state.activeWorkId),
    };
    await this.save();
    return this.get();
  }

  canStartWork(): boolean {
    return this.state.mode === 'idle';
  }

  isPaused(): boolean {
    return this.state.mode === 'paused' || this.state.mode === 'blocked';
  }

  isAuditOnly(): boolean {
    return this.state.mode === 'audit';
  }

  async markWorking(activeWorkId: string, reason: string = 'Autonomous work started', updatedBy: string = 'autonomous'): Promise<AutonomousControlState> {
    return this.setMode('working', reason, updatedBy, activeWorkId);
  }

  async markIdle(reason: string = 'Autonomous work idle', updatedBy: string = 'autonomous'): Promise<AutonomousControlState> {
    return this.setMode('idle', reason, updatedBy);
  }

  async setLastCheckpointPath(lastCheckpointPath: string): Promise<void> {
    this.state = {
      ...this.state,
      lastCheckpointPath,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
  }

  private defaultState(updatedBy: string): AutonomousControlState {
    return {
      version: 1,
      mode: 'idle',
      reason: '',
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
  }

  private normalizeMode(mode: unknown): AutonomousControlMode {
    return mode === 'working' || mode === 'paused' || mode === 'audit' || mode === 'blocked' || mode === 'idle'
      ? mode
      : 'idle';
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
}
