import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProcessStatus } from '../types.js';
import { ErrorCodes } from '../types.js';

export type SuccessResult<T> = { success: true; data: T };
export type ErrorResult = { success: false; error: { code: string; message: string } };
export type Result<T> = SuccessResult<T> | ErrorResult;

function ok<T>(data: T): SuccessResult<T> {
  return { success: true, data };
}

function err(code: string, message: string): ErrorResult {
  return { success: false, error: { code, message } };
}

export interface MonitorConfig {
  configPath: string;
  pollingInterval: number;
  dataDir: string;
}

export interface ProcessInfo {
  pid: number;
  signalFilePath: string;
  sessionStartTime: string;
  pollingInterval: number;
}

export class ProcessManager {
  private readonly dataDir: string;
  private childProcess: ChildProcess | null = null;
  private processInfo: ProcessInfo | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  spawn(config: MonitorConfig): Result<ProcessInfo> {
    // Check if already running
    if (this.isRunning()) {
      const info = this.processInfo!;
      return err(
        ErrorCodes.MONITOR_ALREADY_RUNNING,
        `Monitoring is already running (PID: ${info.pid}, started: ${info.sessionStartTime}, interval: ${info.pollingInterval}s)`,
      );
    }

    try {
      const sessionStartTime = new Date().toISOString();

      // Resolve the monitor-process entry point
      const monitorScript = path.resolve(
        __dirname,
        'monitor-process.js',
      );

      // Spawn the background process as a detached child.
      // We pass the data dir so the child can derive its own signal file path
      // from its PID: signals-{pid}.json
      const child = spawn(
        process.execPath,
        [
          monitorScript,
          '--config', config.configPath,
          '--data-dir', this.dataDir,
          '--interval', String(config.pollingInterval),
        ],
        {
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd(),
        },
      );

      if (!child.pid) {
        return err(
          ErrorCodes.SPAWN_FAILED,
          'Background process failed to start: no PID assigned',
        );
      }

      // Unref so the parent can exit independently
      child.unref();

      const pid = child.pid;
      const signalFilePath = path.join(this.dataDir, `signals-${pid}.json`);

      this.childProcess = child;
      this.processInfo = {
        pid,
        signalFilePath,
        sessionStartTime,
        pollingInterval: config.pollingInterval,
      };

      // Write PID file
      this.writePidFile(pid);

      // Listen for unexpected exit
      child.on('exit', () => {
        this.childProcess = null;
        this.processInfo = null;
        this.removePidFile();
      });

      return ok({ ...this.processInfo });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return err(ErrorCodes.SPAWN_FAILED, `Failed to spawn background process: ${message}`);
    }
  }

  terminate(): Result<void> {
    if (!this.isRunning()) {
      return err(
        ErrorCodes.MONITOR_NOT_RUNNING,
        'No monitoring session is currently running',
      );
    }

    try {
      const info = this.processInfo!;

      // Kill the child process
      if (this.childProcess) {
        this.childProcess.kill('SIGTERM');
        this.childProcess = null;
      } else if (info.pid) {
        // Fallback: kill by PID if we lost the child reference
        try {
          process.kill(info.pid, 'SIGTERM');
        } catch {
          // Process may have already exited
        }
      }

      // Clean up signal file
      this.cleanupSignalFile(info.signalFilePath);

      // Remove PID file
      this.removePidFile();

      this.processInfo = null;

      return ok(undefined);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return err(ErrorCodes.TERMINATE_FAILED, `Failed to terminate background process: ${message}`);
    }
  }

  getStatus(): ProcessStatus {
    if (this.isRunning() && this.processInfo) {
      return {
        state: 'running',
        pid: this.processInfo.pid,
        signalFilePath: this.processInfo.signalFilePath,
        sessionStartTime: this.processInfo.sessionStartTime,
        pollingInterval: this.processInfo.pollingInterval,
      };
    }

    return { state: 'stopped' };
  }

  isRunning(): boolean {
    if (!this.processInfo || !this.processInfo.pid) {
      return false;
    }

    // Verify the process is actually still alive
    try {
      process.kill(this.processInfo.pid, 0);
      return true;
    } catch {
      // Process is no longer running — clean up stale state
      this.childProcess = null;
      this.processInfo = null;
      this.removePidFile();
      return false;
    }
  }

  getSignalFilePath(): string | null {
    if (this.processInfo) {
      return this.processInfo.signalFilePath;
    }
    return null;
  }

  private getPidFilePath(): string {
    return path.join(this.dataDir, 'monitor.pid');
  }

  private writePidFile(pid: number): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      fs.writeFileSync(this.getPidFilePath(), String(pid), 'utf-8');
    } catch {
      // Non-fatal: PID file is for convenience, not critical
    }
  }

  private removePidFile(): void {
    try {
      const pidFile = this.getPidFilePath();
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }
    } catch {
      // Non-fatal
    }
  }

  private cleanupSignalFile(signalFilePath: string): void {
    try {
      if (fs.existsSync(signalFilePath)) {
        fs.unlinkSync(signalFilePath);
      }
    } catch {
      // Non-fatal: signal file cleanup is best-effort
    }
  }
}
