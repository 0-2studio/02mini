/**
 * 02 - Self-Aware AI System
 * Main entry point
 */

import { CLIInterface } from './cli/interface.js';
import { HeartbeatScheduler } from './heartbeat/scheduler.js';
import { CronScheduler } from './cron/index.js';
import { GatewayServer } from './gateway/index.js';
import { AutonomousRunner } from './autonomous/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const workingDir = path.resolve(__dirname, '..');

  console.log('[02] Starting up...');
  console.log(`[02] Working directory: ${workingDir}`);

  // Initialize Cron Scheduler
  console.log('[02] Initializing cron scheduler...');
  const cronScheduler = new CronScheduler(workingDir);
  await cronScheduler.init();
  cronScheduler.start();
  console.log(`[02] Cron scheduler started with ${cronScheduler.getJobs().length} job(s)`);

  // Listen for cron events
  cronScheduler.on('job:triggered', (job) => {
    console.log(`[Cron] Job triggered: ${job.name}`);
  });

  cronScheduler.on('job:completed', (job, success, error) => {
    if (success) {
      console.log(`[Cron] Job completed: ${job.name}`);
    } else {
      console.error(`[Cron] Job failed: ${job.name} - ${error}`);
    }
  });

  cronScheduler.on('systemEvent', (event) => {
    console.log(`[Cron] System event: ${event.slice(0, 50)}...`);
  });

  // Start legacy heartbeat scheduler (integrates with Cron)
  const heartbeatPath = path.join(workingDir, 'important', 'heartbeat.md');
  const heartbeatScheduler = new HeartbeatScheduler(heartbeatPath);
  await heartbeatScheduler.loadTasks();
  heartbeatScheduler.setCronScheduler(cronScheduler);
  heartbeatScheduler.start();

  // Forward heartbeat events to CLI
  heartbeatScheduler.on('task', (task) => {
    console.log(`[Heartbeat Task] ${task.name}: ${task.action}`);
  });

  // Start CLI
  const cli = new CLIInterface(workingDir, cronScheduler);

  // Start Gateway (will be initialized after CLI creates engine)
  let gateway: GatewayServer | null = null;
  let autonomous: AutonomousRunner | null = null;

  // Wait for CLI to initialize and create engine
  cli.onEngineReady = async (engine) => {
    // Start Gateway
    const gatewayPort = parseInt(process.env.GATEWAY_PORT || '3000');
    const gatewayToken = process.env.GATEWAY_TOKEN;

    gateway = new GatewayServer(
      {
        port: gatewayPort,
        host: '0.0.0.0',
        authToken: gatewayToken,
        enableCORS: true,
      },
      engine,
      cronScheduler
    );

    await gateway.start();

    // Start Autonomous Runner
    autonomous = new AutonomousRunner(engine, cronScheduler, {
      enabled: process.env.AUTONOMOUS_ENABLED !== 'false',
      intervalMinutes: parseInt(process.env.HEARTBEAT_INTERVAL || '5'),
      maxProactivePerHour: parseInt(process.env.MAX_PROACTIVE_PER_HOUR || '10'),
    });

    // Connect autonomous to CLI for proactive messages
    autonomous.onProactiveMessage((content, trigger) => {
      cli.printProactiveMessage(content, trigger);
    });

    // Connect autonomous to Gateway for WebSocket broadcast
    autonomous.onProactiveMessage((content, trigger) => {
      const context = gateway?.getContext();
      if (context) {
        context.broadcast({
          type: 'proactive',
          content,
          timestamp: Date.now(),
          reason: trigger.reason,
        });
      }
    });

    autonomous.start();

    // Record user interactions for silence period
    cli.onUserInteraction = () => {
      autonomous?.recordUserInteraction();
    };
  };

  await cli.start();

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n[02] Shutting down...');
    autonomous?.stop();
    gateway?.stop();
    cronScheduler.stop();
    heartbeatScheduler.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[02] Fatal error:', error);
  process.exit(1);
});