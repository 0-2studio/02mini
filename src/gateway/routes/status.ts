/**
 * Status Routes
 * System status and health endpoints
 */

import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../types.js';

export function createStatusRoutes(context: GatewayContext) {
  return async function (app: FastifyInstance) {
    // GET /api/status
    app.get('/status', async () => {
      const stats = context.engine.getContextStats();
      const jobs = context.cronScheduler.getJobs();
      const nextJob = jobs
        .filter((j) => j.enabled && j.state.nextRunAtMs)
        .sort((a, b) => (a.state.nextRunAtMs || 0) - (b.state.nextRunAtMs || 0))[0];

      return {
        status: 'running' as const,
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: Date.now(),
        context: {
          totalMessages: stats.totalMessages,
          systemMessages: stats.systemMessages,
          userMessages: stats.userMessages,
          assistantMessages: stats.assistantMessages,
          toolMessages: stats.toolMessages,
          totalTokens: stats.totalTokens,
          status: context.engine.getContextStatus(),
          compressionCount: stats.compressionCount,
        },
        cron: {
          enabled: true,
          jobCount: jobs.length,
          enabledJobs: jobs.filter((j) => j.enabled).length,
          nextJobAt: nextJob?.state.nextRunAtMs,
          nextJobName: nextJob?.name,
        },
      };
    });

    // GET /api/cron/jobs
    app.get('/cron/jobs', async () => {
      const jobs = context.cronScheduler.getJobs();
      return {
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          description: j.description,
          enabled: j.enabled,
          schedule: j.schedule,
          payload: j.payload,
          state: {
            nextRunAt: j.state.nextRunAtMs,
            lastRunAt: j.state.lastRunAtMs,
            lastRunResult: j.state.lastRunResult,
            runCount: j.state.runCount,
            errorCount: j.state.errorCount,
          },
        })),
      };
    });

    // GET /api/config
    app.get('/config', async () => {
      return {
        gateway: {
          port: context.config.port,
          host: context.config.host,
          enableCORS: context.config.enableCORS,
          maxRequestSize: context.config.maxRequestSize,
        },
        auth: context.config.authToken ? 'enabled' : 'disabled',
      };
    });
  };
}
