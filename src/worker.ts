import express from 'express';
import cron from 'node-cron';
import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const STOCK_TRACKER_HOME = process.env.STOCK_TRACKER_HOME ?? process.cwd();
const CLI_PATH = path.join(__dirname, 'cli.js');

// ---------------------------------------------------------------------------
// Job registry & guard
// ---------------------------------------------------------------------------

interface Job {
  name: string;
  running: boolean;
  process: ChildProcess | null;
}

const jobs: Map<string, Job> = new Map();

function getOrCreateJob(name: string): Job {
  if (!jobs.has(name)) {
    jobs.set(name, { name, running: false, process: null });
  }
  return jobs.get(name)!;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(jobName: string, message: string): void {
  const ts = new Date().toISOString();
  console.log(`[${jobName} ${ts}] ${message}`);
}

// ---------------------------------------------------------------------------
// Child process spawner
// ---------------------------------------------------------------------------

function runCli(jobName: string, args: string[]): Promise<number> {
  const job = getOrCreateJob(jobName);

  if (job.running) {
    log(jobName, 'skipped — previous run still in progress');
    return Promise.resolve(-1);
  }

  job.running = true;

  return new Promise<number>((resolve) => {
    log(jobName, `starting: node ${path.basename(CLI_PATH)} ${args.join(' ')}`);

    const child = spawn('node', [CLI_PATH, ...args], {
      cwd: STOCK_TRACKER_HOME,
      env: { ...process.env, STOCK_TRACKER_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    job.process = child;

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        log(jobName, `stdout: ${line}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        log(jobName, `stderr: ${line}`);
      }
    });

    child.on('close', (code) => {
      job.running = false;
      job.process = null;
      log(jobName, `exited with code ${code ?? 'null'}`);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      job.running = false;
      job.process = null;
      log(jobName, `spawn error: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Run the standalone discord-signal-check script.
 */
function runSignalCheck(jobName: string): Promise<number> {
  const job = getOrCreateJob(jobName);

  if (job.running) {
    log(jobName, 'skipped — previous run still in progress');
    return Promise.resolve(-1);
  }

  job.running = true;

  const scriptPath = path.join(__dirname, 'discord-signal-check.js');

  return new Promise<number>((resolve) => {
    log(jobName, `starting: node discord-signal-check.js`);

    const child = spawn('node', [scriptPath], {
      cwd: STOCK_TRACKER_HOME,
      env: { ...process.env, STOCK_TRACKER_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    job.process = child;

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        log(jobName, `stdout: ${line}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        log(jobName, `stderr: ${line}`);
      }
    });

    child.on('close', (code) => {
      job.running = false;
      job.process = null;
      log(jobName, `exited with code ${code ?? 'null'}`);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      job.running = false;
      job.process = null;
      log(jobName, `spawn error: ${err.message}`);
      resolve(1);
    });
  });
}

// ---------------------------------------------------------------------------
// Job definitions
// ---------------------------------------------------------------------------

async function dailyScanLargeCap(): Promise<void> {
  const jobName = 'daily-scan-lc';
  const logFile = path.join(
    STOCK_TRACKER_HOME,
    '.stock-tracker',
    'logs',
    `scan_${Date.now()}.json`,
  );

  const code = await runCli(jobName, [
    'scan',
    '--tickers', 'watchlist',
    '--strategy', 'v3',
    '--universe', 'large_cap',
    '--allow-stale',
    '--summary',
    '--log', logFile,
  ]);

  if (code !== 0) return;

  // Signal history upsert
  await runCli(`${jobName}:signal-history`, [
    'signal-history',
    '--scan-output', logFile,
    '--universe', 'large_cap',
  ]);

  // Journal update (large_cap only)
  await runCli(`${jobName}:journal-update`, ['journal-update']);
}

async function dailyScanTech(): Promise<void> {
  const jobName = 'daily-scan-tech';
  const logFile = path.join(
    STOCK_TRACKER_HOME,
    '.stock-tracker',
    'logs',
    `scan_tech_${Date.now()}.json`,
  );

  const code = await runCli(jobName, [
    'scan',
    '--tickers', 'watchlist',
    '--strategy', 'v3',
    '--universe', 'tech',
    '--allow-stale',
    '--summary',
    '--log', logFile,
  ]);

  if (code !== 0) return;

  // Signal history upsert
  await runCli(`${jobName}:signal-history`, [
    'signal-history',
    '--scan-output', logFile,
    '--universe', 'tech',
  ]);
}

async function weeklyTuneLargeCap(): Promise<void> {
  await runCli('weekly-tune-lc', [
    'tune-pipeline',
    '--tickers', 'watchlist',
    '--strategy', 'v3',
    '--concurrency', '8',
    '--universe', 'large_cap',
    '--save',
  ]);
}

async function weeklyTuneTech(): Promise<void> {
  await runCli('weekly-tune-tech', [
    'tune-pipeline',
    '--tickers', 'watchlist',
    '--strategy', 'v3',
    '--concurrency', '8',
    '--universe', 'tech',
    '--save',
  ]);
}

async function signalCheck(): Promise<void> {
  await runSignalCheck('signal-check');
}

// ---------------------------------------------------------------------------
// Health check server
// ---------------------------------------------------------------------------

const app = express();
const startTime = Date.now();

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

const server = app.listen(PORT, () => {
  log('worker', `Health check server listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Cron schedules (TZ controlled by Railway TZ env var)
// ---------------------------------------------------------------------------

// Weekday scans at market close
cron.schedule('30 16 * * 1-5', () => { dailyScanLargeCap(); });
cron.schedule('45 16 * * 1-5', () => { dailyScanTech(); });

// Weekly tunes on Sunday
cron.schedule('0 9 * * 0', () => { weeklyTuneLargeCap(); });
cron.schedule('0 11 * * 0', () => { weeklyTuneTech(); });

// Signal checks during market hours on weekdays
cron.schedule('0 10 * * 1-5', () => { signalCheck(); });
cron.schedule('0 12 * * 1-5', () => { signalCheck(); });
cron.schedule('30 15 * * 1-5', () => { signalCheck(); });

log('worker', 'All cron jobs scheduled');

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal: string): void {
  log('worker', `Received ${signal}, shutting down...`);

  // Stop accepting new connections
  server.close(() => {
    log('worker', 'HTTP server closed');
  });

  // Kill any running child processes
  for (const [, job] of jobs) {
    if (job.process && !job.process.killed) {
      log('worker', `Killing running job: ${job.name}`);
      job.process.kill('SIGTERM');
    }
  }

  // Give child processes a moment to exit, then force quit
  setTimeout(() => {
    log('worker', 'Shutdown complete');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
