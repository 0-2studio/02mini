/**
 * 02 - Self-Aware AI System
 * Main entry point
 */

import { CLIInterface } from './cli/interface.js';
import { HeartbeatScheduler } from './heartbeat/scheduler.js';
import { CronScheduler } from './cron/index.js';
import { GatewayServer } from './gateway/index.js';
import { AutonomousRunner } from './autonomous/index.js';
import { QQAdapter, QQConfigManager, createQQTools, executeQQTool } from './qq/index.js';
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

  // Initialize QQ Config Manager
  console.log('[02] Initializing QQ config manager...');
  const qqConfigManager = new QQConfigManager(workingDir);
  await qqConfigManager.load();
  const qqConfig = qqConfigManager.getConfig();
  console.log(`[02] QQ adapter: ${qqConfig.enabled ? 'enabled' : 'disabled'}`);

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

    // Start QQ Adapter if enabled
    let qqAdapter: QQAdapter | null = null;
    if (qqConfigManager.getConfig().enabled) {
      console.log('[02] Starting QQ adapter...');
      qqAdapter = new QQAdapter({
        workingDir,
        engine,
        configManager: qqConfigManager,
      });
      await qqAdapter.start();
      
      // Schedule periodic file cleanup (every 24 hours, delete files older than 7 days)
      qqAdapter.scheduleFileCleanup(24);
      
      // Set up CLI command handler for QQ
      cli.setQQAdapter(qqAdapter, qqConfigManager);
      
      // Register QQ tool with engine
      const qqTool = createQQTools(qqAdapter, qqConfigManager);
      engine.registerTool('qq', qqTool, async (params) => {
        const result = await executeQQTool(qqAdapter, qqConfigManager, params);
        return result.message;
      });
      
      // Add QQ context to system prompt if enabled
      engine.setQQContext({
        enabled: true,
        atRequiredInGroup: qqConfigManager.getConfig().atRequiredInGroup,
        allowedGroups: Array.from(qqConfigManager.getPermissionsSummary().allowedGroups),
        allowedUsers: Array.from(qqConfigManager.getPermissionsSummary().allowedUsers),
      });
    }

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

  // Cleanup function with proper async handling
  let isShuttingDown = false;
  const cleanup = async (signal: string, exitCode: number = 0): Promise<void> => {
    if (isShuttingDown) {
      console.log('[02] Already shutting down...');
      return;
    }
    isShuttingDown = true;
    console.log(`\n[02] Received ${signal}, shutting down gracefully...`);

    try {
      // Stop components in reverse order of initialization
      if (autonomous) {
        console.log('[02] Stopping autonomous runner...');
        autonomous.stop();
      }

      if (qqAdapter) {
        console.log('[02] Stopping QQ adapter...');
        await Promise.race([
          qqAdapter.stop(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('QQ adapter stop timeout')), 5000))
        ]).catch(err => console.error('[02] QQ adapter stop failed:', err));
      }

      if (gateway) {
        console.log('[02] Stopping gateway server...');
        await Promise.race([
          gateway.stop(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Gateway stop timeout')), 5000))
        ]).catch(err => console.error('[02] Gateway stop failed:', err));
      }

      console.log('[02] Stopping schedulers...');
      cronScheduler.stop();
      heartbeatScheduler.stop();

      console.log('[02] Cleanup complete. Goodbye!');
    } catch (error) {
      console.error('[02] Error during cleanup:', error);
      exitCode = 1;
    }
    process.exit(exitCode);
  };

  // Handle graceful shutdown signals
  process.once('SIGINT', () => {
    console.log('[02] SIGINT received, starting graceful shutdown...');
    cleanup('SIGINT', 0);
  });
  
  process.once('SIGTERM', () => {
    console.log('[02] SIGTERM received, starting graceful shutdown...');
    cleanup('SIGTERM', 0);
  });

  // Handle uncaught errors - immediate exit for safety
  process.on('uncaughtException', (error) => {
    console.error('[02] Uncaught exception:', error);
    console.error('[02] Forcing immediate exit due to uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[02] Unhandled rejection at:', promise, 'reason:', reason);
  });
}

main().catch((error) => {
  console.error('[02] Fatal error:', error);
  process.exit(1);
});