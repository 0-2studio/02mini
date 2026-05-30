import fs from 'fs/promises';
import path from 'path';

export type AutonomousWorkStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface AutonomousWorkItem {
  id: string;
  title: string;
  prompt: string;
  source: 'heartbeat' | 'cron' | 'self-maintenance' | 'manual';
  priority: number;
  status: AutonomousWorkStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAtMs: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  lastResult?: string;
}

interface AutonomousQueueStore {
  version: number;
  items: AutonomousWorkItem[];
  lastUpdated: string;
}

export interface AutonomousQueueSummary {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  due: number;
}

export class AutonomousQueueStoreManager {
  private readonly storePath: string;
  private store: AutonomousQueueStore = {
    version: 1,
    items: [],
    lastUpdated: new Date().toISOString(),
  };

  constructor(workingDir: string) {
    this.storePath = path.join(workingDir, 'memory', 'autonomous-queue.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as AutonomousQueueStore;
      this.store = {
        version: parsed.version || 1,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        lastUpdated: parsed.lastUpdated || new Date().toISOString(),
      };
      this.recoverRunningItems();
      await this.save();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[AutonomousQueue] Failed to load store, creating new:', error);
      }
      await this.save();
    }
  }

  getAll(): AutonomousWorkItem[] {
    return [...this.store.items].sort((a, b) => {
      if (a.status !== b.status) return this.statusRank(a.status) - this.statusRank(b.status);
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.nextRunAtMs - b.nextRunAtMs;
    });
  }

  getSummary(nowMs: number = Date.now()): AutonomousQueueSummary {
    const summary: AutonomousQueueSummary = {
      total: this.store.items.length,
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      due: 0,
    };

    for (const item of this.store.items) {
      summary[item.status]++;
      if (item.status === 'queued' && item.nextRunAtMs <= nowMs) summary.due++;
    }

    return summary;
  }

  getDue(limit: number = 1, nowMs: number = Date.now()): AutonomousWorkItem[] {
    return this.store.items
      .filter(item => item.status === 'queued' && item.nextRunAtMs <= nowMs)
      .sort((a, b) => b.priority - a.priority || a.nextRunAtMs - b.nextRunAtMs)
      .slice(0, limit);
  }

  async enqueue(input: {
    title: string;
    prompt: string;
    source: AutonomousWorkItem['source'];
    priority?: number;
    maxAttempts?: number;
    delayMs?: number;
  }): Promise<AutonomousWorkItem> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const existing = this.findSimilarQueued(input.title, input.source);
    if (existing) return existing;

    const item: AutonomousWorkItem = {
      id: `auto_${now}_${Math.random().toString(36).slice(2, 9)}`,
      title: input.title,
      prompt: input.prompt,
      source: input.source,
      priority: input.priority ?? 5,
      status: 'queued',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextRunAtMs: now + (input.delayMs ?? 0),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.store.items.push(item);
    await this.save();
    return item;
  }

  async markRunning(id: string): Promise<AutonomousWorkItem | null> {
    const item = this.store.items.find(x => x.id === id);
    if (!item || item.status !== 'queued') return null;
    const nowIso = new Date().toISOString();
    item.status = 'running';
    item.attempts++;
    item.startedAt = nowIso;
    item.updatedAt = nowIso;
    item.lastError = undefined;
    await this.save();
    return item;
  }

  async markDone(id: string, result: string): Promise<void> {
    const item = this.store.items.find(x => x.id === id);
    if (!item) return;
    const nowIso = new Date().toISOString();
    item.status = 'done';
    item.completedAt = nowIso;
    item.updatedAt = nowIso;
    item.lastResult = result.slice(0, 4000);
    await this.save();
  }

  async markFailed(id: string, error: string): Promise<void> {
    const item = this.store.items.find(x => x.id === id);
    if (!item) return;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    item.lastError = error.slice(0, 1000);
    item.updatedAt = nowIso;

    if (item.attempts < item.maxAttempts) {
      item.status = 'queued';
      item.nextRunAtMs = now + this.backoffMs(item.attempts);
    } else {
      item.status = 'failed';
      item.completedAt = nowIso;
    }

    await this.save();
  }

  async cancel(id: string): Promise<boolean> {
    const item = this.store.items.find(x => x.id === id);
    if (!item || item.status === 'done' || item.status === 'cancelled') return false;
    item.status = 'cancelled';
    item.updatedAt = new Date().toISOString();
    await this.save();
    return true;
  }

  private findSimilarQueued(title: string, source: AutonomousWorkItem['source']): AutonomousWorkItem | undefined {
    const normalized = title.trim().toLowerCase();
    return this.store.items.find(item =>
      item.source === source &&
      item.status === 'queued' &&
      item.title.trim().toLowerCase() === normalized
    );
  }

  private recoverRunningItems(): void {
    const now = Date.now();
    for (const item of this.store.items) {
      if (item.status === 'running') {
        item.status = 'queued';
        item.nextRunAtMs = now + this.backoffMs(item.attempts);
        item.updatedAt = new Date(now).toISOString();
        item.lastError = item.lastError || 'Recovered from interrupted autonomous run';
      }
    }
  }

  private async save(): Promise<void> {
    this.store.lastUpdated = new Date().toISOString();
    await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2), 'utf8');
  }

  private backoffMs(attempts: number): number {
    return Math.min(60 * 60 * 1000, Math.max(1, attempts) * 5 * 60 * 1000);
  }

  private statusRank(status: AutonomousWorkStatus): number {
    switch (status) {
      case 'running': return 0;
      case 'queued': return 1;
      case 'failed': return 2;
      case 'done': return 3;
      case 'cancelled': return 4;
    }
  }
}
