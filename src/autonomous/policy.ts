import fs from 'fs/promises';
import path from 'path';

export interface AutonomousPolicy {
  version: number;
  goals: string[];
  maintenance: {
    memoryReviewMessageThreshold: number;
    overdueJobReviewDelayMs: number;
    toolHealthCheckDelayMs: number;
    failedWorkReviewDelayMs: number;
  };
  reporting: {
    duplicateWindowMs: number;
    lowNoise: boolean;
  };
  updatedAt: string;
}

const DEFAULT_POLICY: AutonomousPolicy = {
  version: 1,
  goals: [
    'Keep 02mini useful without waiting for direct user commands.',
    'Prefer safe self-maintenance over noisy status reports.',
    'Notice overdue jobs, broken tools, context pressure, and failed autonomous work.',
  ],
  maintenance: {
    memoryReviewMessageThreshold: 120,
    overdueJobReviewDelayMs: 0,
    toolHealthCheckDelayMs: 60_000,
    failedWorkReviewDelayMs: 5 * 60_000,
  },
  reporting: {
    duplicateWindowMs: 10 * 60_000,
    lowNoise: true,
  },
  updatedAt: new Date().toISOString(),
};

export class AutonomousPolicyStore {
  private readonly policyPath: string;
  private policy: AutonomousPolicy = DEFAULT_POLICY;

  constructor(workingDir: string) {
    this.policyPath = path.join(workingDir, 'memory', 'autonomous-policy.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.policyPath), { recursive: true });
    try {
      const raw = await fs.readFile(this.policyPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AutonomousPolicy>;
      this.policy = this.mergePolicy(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[AutonomousPolicy] Failed to load policy, using default:', error);
      }
      this.policy = this.mergePolicy({});
      await this.save();
    }
  }

  get(): AutonomousPolicy {
    return JSON.parse(JSON.stringify(this.policy)) as AutonomousPolicy;
  }

  async save(): Promise<void> {
    this.policy.updatedAt = new Date().toISOString();
    await fs.writeFile(this.policyPath, JSON.stringify(this.policy, null, 2), 'utf8');
  }

  private mergePolicy(input: Partial<AutonomousPolicy>): AutonomousPolicy {
    return {
      version: input.version || DEFAULT_POLICY.version,
      goals: Array.isArray(input.goals) && input.goals.length > 0 ? input.goals : DEFAULT_POLICY.goals,
      maintenance: {
        ...DEFAULT_POLICY.maintenance,
        ...(input.maintenance || {}),
      },
      reporting: {
        ...DEFAULT_POLICY.reporting,
        ...(input.reporting || {}),
      },
      updatedAt: input.updatedAt || new Date().toISOString(),
    };
  }
}
