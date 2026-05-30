import fs from 'fs/promises';
import path from 'path';

export type AutonomousActivityType =
  | 'heartbeat'
  | 'skip'
  | 'queue-enqueued'
  | 'queue-started'
  | 'queue-completed'
  | 'queue-failed'
  | 'cron-agent-turn'
  | 'proactive'
  | 'maintenance';

export interface AutonomousActivityEntry {
  timestamp: string;
  type: AutonomousActivityType;
  message: string;
  itemId?: string;
  metadata?: Record<string, unknown>;
}

export class AutonomousActivityLog {
  private readonly logPath: string;
  private initialized = false;

  constructor(workingDir: string) {
    this.logPath = path.join(workingDir, 'memory', 'autonomous-activity.jsonl');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    this.initialized = true;
  }

  async append(entry: Omit<AutonomousActivityEntry, 'timestamp'>): Promise<void> {
    await this.init();
    const record: AutonomousActivityEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    await fs.appendFile(this.logPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async tail(limit: number = 20): Promise<AutonomousActivityEntry[]> {
    await this.init();
    try {
      const raw = await fs.readFile(this.logPath, 'utf8');
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit)
        .map(line => JSON.parse(line) as AutonomousActivityEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
