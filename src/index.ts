/**
 * 02 - Self-Aware AI System
 * Main entry point
 */

import { CLIInterface } from './cli/interface.js';
import { HeartbeatScheduler } from './heartbeat/scheduler.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const workingDir = path.resolve(__dirname, '..');
  
  console.log('[02] Starting up...');
  console.log(`[02] Working directory: ${workingDir}`);

  // Start heartbeat scheduler
  const heartbeatPath = path.join(workingDir, 'important', 'heartbeat.md');
  const scheduler = new HeartbeatScheduler(heartbeatPath);
  await scheduler.loadTasks();
  
  scheduler.on('task', (task) => {
    console.log(`[Heartbeat Task] ${task.name}: ${task.action}`);
    // In a full implementation, this would trigger the AI to handle the task
  });
  
  scheduler.start();

  // Start CLI
  const cli = new CLIInterface(workingDir);
  await cli.start();
}

main().catch((error) => {
  console.error('[02] Fatal error:', error);
  process.exit(1);
});
