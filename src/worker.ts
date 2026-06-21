import express from 'express';
import cron from 'node-cron';
import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { initDiscordBot } from './discord-bot/index.js';
import { updateMemberTradePnL } from './db/update-member-pnl.js';
import { registerApiRoutes } from './web/routes.js';
import { setupBrokerAdapters } from './broker/setup.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const STOCK_TRACKER_HOME = process.env.STOCK_TRACKER_HOME ?? process.cwd();
const CLI_PATH = path.join(__dirname, 'cli.js');

// Warn if running in production without STOCK_TRACKER_HOME — data may be ephemeral
if (process.env.NODE_ENV === 'production' && !process.env.STOCK_TRACKER_HOME) {
  console.error(
    '[worker] WARNING: STOCK_TRACKER_HOME is not set. Data will write to ephemeral ' +
    `${STOCK_TRACKER_HOME}/.stock-tracker/ which is lost on redeploy. ` +
    'Set STOCK_TRACKER_HOME to your persistent volume mount path.'
  );
}

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

interface RunCliOptions {
  /** Suppress stdout logging (stderr and exit code are still logged). */
  quiet?: boolean;
}

function runCli(jobName: string, args: string[], entryScript?: string, options?: RunCliOptions): Promise<number> {
  const job = getOrCreateJob(jobName);
  const quiet = options?.quiet ?? false;

  if (job.running) {
    log(jobName, 'skipped — previous run still in progress');
    return Promise.resolve(-1);
  }

  job.running = true;

  const script = entryScript ?? CLI_PATH;

  return new Promise<number>((resolve) => {
    log(jobName, `starting: node ${path.basename(script)} ${args.join(' ')}`);

    const child = spawn('node', [script, ...args], {
      cwd: STOCK_TRACKER_HOME,
      env: { ...process.env, STOCK_TRACKER_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    job.process = child;

    child.stdout?.on('data', (data: Buffer) => {
      if (quiet) return; // Skip verbose stdout logging
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
  const scriptPath = path.join(__dirname, 'discord-signal-check.js');
  return runCli(jobName, [], scriptPath);
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

/**
 * Discord notification (chart generation + posting) for the latest scan logs.
 * Runs as a separate job after scans complete so Puppeteer has full memory available.
 */
async function discordNotify(): Promise<void> {
  const logsDir = path.join(STOCK_TRACKER_HOME, '.stock-tracker', 'logs');
  const notifyScript = path.join(__dirname, 'discord-notify.js');

  // Find the most recent large_cap scan log
  const lcLogs = require('node:fs').readdirSync(logsDir)
    .filter((f: string) => f.startsWith('scan_') && !f.startsWith('scan_tech_') && f.endsWith('.json'))
    .sort((a: string, b: string) => b.localeCompare(a));

  if (lcLogs.length > 0) {
    const lcLogFile = path.join(logsDir, lcLogs[0]);
    await runCli('notify-lc', [lcLogFile], notifyScript);
  }

  // Find the most recent tech scan log
  const techLogs = require('node:fs').readdirSync(logsDir)
    .filter((f: string) => f.startsWith('scan_tech_') && f.endsWith('.json'))
    .sort((a: string, b: string) => b.localeCompare(a));

  if (techLogs.length > 0) {
    const techLogFile = path.join(logsDir, techLogs[0]);
    await runCli('notify-tech', [techLogFile], notifyScript);
  }
}

async function weeklyTuneLargeCap(): Promise<void> {
  await runCli('weekly-tune-lc', [
    'tune-pipeline',
    '--tickers', 'watchlist',
    '--strategy', 'v3',
    '--concurrency', '8',
    '--universe', 'large_cap',
    '--save',
  ], undefined, { quiet: true });
}

async function weeklyTuneTech(): Promise<void> {
  await runCli('weekly-tune-tech', [
    'tune-pipeline',
    '--tickers', 'watchlist',
    '--strategy', 'v3',
    '--concurrency', '8',
    '--universe', 'tech',
    '--save',
  ], undefined, { quiet: true });
}

async function signalCheck(): Promise<void> {
  await runSignalCheck('signal-check');
}

async function winningTrades(): Promise<void> {
  await runCli('winning-trades', ['winning-trades']);
}

async function morningSentimentDigest(): Promise<void> {
  await runCli('morning-sentiment-digest', ['sentiment-check']);
}

async function regenerateBacktestManifest(): Promise<void> {
  await runCli('backtest-manifest', ['generate-backtest-manifest']);
}

// ---------------------------------------------------------------------------
// Broker adapter registration (before routes/cron that may use broker)
// ---------------------------------------------------------------------------

setupBrokerAdapters();

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

// Body parsing middleware (required for POST /connect/webull form submission)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

registerApiRoutes(app, STOCK_TRACKER_HOME);

const server = app.listen(PORT, () => {
  log('worker', `Health check server listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Discord bot (non-blocking — failure does not crash worker)
// ---------------------------------------------------------------------------

initDiscordBot().catch((err) => {
  console.error('[worker] Discord bot init failed:', err instanceof Error ? err.message : String(err));
});

// ---------------------------------------------------------------------------
// Cron schedules (TZ controlled by Railway TZ env var)
// ---------------------------------------------------------------------------

const ET = { timezone: 'America/Los_Angeles' } as const;

// Weekday scans at 2 PM PT (1h after market close for data to settle)
cron.schedule('0 14 * * 1-5', () => {
  (async () => {
    try {
      await dailyScanLargeCap();
    } catch (err) {
      console.error('[worker] dailyScanLargeCap error:', err instanceof Error ? err.message : err);
    }
    try {
      await dailyScanTech();
    } catch (err) {
      console.error('[worker] dailyScanTech error:', err instanceof Error ? err.message : err);
    }
    try {
      await updateMemberTradePnL();
    } catch (err) {
      console.warn('[worker] updateMemberTradePnL error:', err);
    }
  })();
}, ET);

// Discord notification with charts — 3 min after scan to avoid memory pressure from Puppeteer
cron.schedule('3 14 * * 1-5', () => {
  (async () => {
    try {
      await discordNotify();
    } catch (err) {
      console.error('[worker] discordNotify error:', err instanceof Error ? err.message : err);
    }
  })();
}, ET);

// Monday market-open scan at 6:30 AM PT
cron.schedule('30 6 * * 1', () => {
  (async () => {
    try {
      await dailyScanLargeCap();
    } catch (err) {
      console.error('[worker] mondayScanLargeCap error:', err instanceof Error ? err.message : err);
    }
    try {
      await dailyScanTech();
    } catch (err) {
      console.error('[worker] mondayScanTech error:', err instanceof Error ? err.message : err);
    }
  })();
}, ET);

// Monday notification with charts — 3 min after Monday scan
cron.schedule('33 6 * * 1', () => {
  (async () => {
    try {
      await discordNotify();
    } catch (err) {
      console.error('[worker] mondayDiscordNotify error:', err instanceof Error ? err.message : err);
    }
  })();
}, ET);

// Weekly tunes on Sunday
cron.schedule('0 9 * * 0', () => { weeklyTuneLargeCap(); }, ET);
cron.schedule('0 11 * * 0', () => { weeklyTuneTech(); }, ET);

// Regenerate backtest manifest after both tunes complete (Sunday 12 PM PT)
cron.schedule('0 12 * * 0', () => { regenerateBacktestManifest(); }, ET);

// Weekly winning trades showcase (Sunday 1 PM PT — after manifest generation)
cron.schedule('0 13 * * 0', () => { winningTrades(); }, ET);

// Morning sentiment digest at 6 AM PT on weekdays (before market open)
cron.schedule('0 6 * * 1-5', () => { morningSentimentDigest(); }, ET);

// Nightly news timeline at 6 PM PT on weekdays
cron.schedule('0 18 * * 1-5', () => { runCli('news-timeline', ['news-timeline']); }, ET);

// Signal checks during market hours on weekdays (market: 6:30 AM – 1 PM PT)
cron.schedule('0 7 * * 1-5', () => { signalCheck(); }, ET);
cron.schedule('0 9 * * 1-5', () => { signalCheck(); }, ET);
cron.schedule('30 12 * * 1-5', () => { signalCheck(); }, ET);

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
