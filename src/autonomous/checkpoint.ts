import fs from 'fs/promises';
import path from 'path';
import type { AutonomousControlMode } from './state.js';

export type CheckpointEvent = 'started' | 'completed' | 'failed' | 'skipped';

export interface AutonomousCheckpointInput {
  event: CheckpointEvent;
  mode: AutonomousControlMode;
  activeWorkId?: string;
  title?: string;
  source?: string;
  prompt?: string;
  filesChanged?: string[] | 'unknown';
  validation?: string;
  result?: string;
  nextStep?: string;
  blockedReason?: string;
}

export class AutonomousCheckpointStore {
  private readonly checkpointDir: string;
  private readonly currentPath: string;

  constructor(workingDir: string) {
    this.checkpointDir = path.join(workingDir, 'memory', 'project-checkpoints');
    this.currentPath = path.join(this.checkpointDir, 'current.md');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.checkpointDir, { recursive: true });
    await fs.mkdir(path.join(this.checkpointDir, 'archive'), { recursive: true });
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  async write(input: AutonomousCheckpointInput): Promise<string> {
    await this.init();
    const content = this.render(input);
    await fs.writeFile(this.currentPath, content, 'utf8');
    return this.currentPath;
  }

  private render(input: AutonomousCheckpointInput): string {
    const filesChanged = Array.isArray(input.filesChanged)
      ? input.filesChanged.join(', ')
      : input.filesChanged || 'unknown';
    const prompt = input.prompt ? this.redact(input.prompt).slice(0, 500) : '';

    return [
      '# Autonomous Checkpoint',
      '',
      `- timestamp: ${new Date().toISOString()}`,
      `- event: ${input.event}`,
      `- mode: ${input.mode}`,
      `- activeWorkId: ${input.activeWorkId || 'none'}`,
      `- title: ${this.redact(input.title || 'unknown')}`,
      `- source: ${input.source || 'unknown'}`,
      `- filesChanged: ${filesChanged}`,
      `- validation: ${this.redact(input.validation || 'unknown')}`,
      `- result: ${this.redact(input.result || 'unknown')}`,
      `- nextStep: ${this.redact(input.nextStep || 'unknown')}`,
      `- blockedReason: ${this.redact(input.blockedReason || 'none')}`,
      '',
      '## Prompt Excerpt',
      '',
      prompt || 'none',
      '',
    ].join('\n');
  }

  redact(value: string): string {
    return value
      .replace(/(api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*[^\s`'"<>]+/gi, '$1=[REDACTED]')
      .replace(/\b(sk-[A-Za-z0-9_-]{12,}|kcb_live_[A-Za-z0-9_-]+)\b/g, '[REDACTED_SECRET]');
  }
}
