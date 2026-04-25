"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessManager = void 0;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const types_js_1 = require("./types.js");
function ok(data) {
    return { success: true, data };
}
function err(code, message) {
    return { success: false, error: { code, message } };
}
class ProcessManager {
    dataDir;
    childProcess = null;
    processInfo = null;
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    spawn(config) {
        // Check if already running
        if (this.isRunning()) {
            const info = this.processInfo;
            return err(types_js_1.ErrorCodes.MONITOR_ALREADY_RUNNING, `Monitoring is already running (PID: ${info.pid}, started: ${info.sessionStartTime}, interval: ${info.pollingInterval}s)`);
        }
        try {
            const sessionStartTime = new Date().toISOString();
            // Resolve the monitor-process entry point
            const monitorScript = path.resolve(__dirname, 'monitor-process.js');
            // Spawn the background process as a detached child.
            // We pass the data dir so the child can derive its own signal file path
            // from its PID: signals-{pid}.json
            const child = (0, node_child_process_1.spawn)(process.execPath, [
                monitorScript,
                '--config', config.configPath,
                '--data-dir', this.dataDir,
                '--interval', String(config.pollingInterval),
            ], {
                detached: true,
                stdio: 'ignore',
                cwd: process.cwd(),
            });
            if (!child.pid) {
                return err(types_js_1.ErrorCodes.SPAWN_FAILED, 'Background process failed to start: no PID assigned');
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
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return err(types_js_1.ErrorCodes.SPAWN_FAILED, `Failed to spawn background process: ${message}`);
        }
    }
    terminate() {
        if (!this.isRunning()) {
            return err(types_js_1.ErrorCodes.MONITOR_NOT_RUNNING, 'No monitoring session is currently running');
        }
        try {
            const info = this.processInfo;
            // Kill the child process
            if (this.childProcess) {
                this.childProcess.kill('SIGTERM');
                this.childProcess = null;
            }
            else if (info.pid) {
                // Fallback: kill by PID if we lost the child reference
                try {
                    process.kill(info.pid, 'SIGTERM');
                }
                catch {
                    // Process may have already exited
                }
            }
            // Clean up signal file
            this.cleanupSignalFile(info.signalFilePath);
            // Remove PID file
            this.removePidFile();
            this.processInfo = null;
            return ok(undefined);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return err(types_js_1.ErrorCodes.TERMINATE_FAILED, `Failed to terminate background process: ${message}`);
        }
    }
    getStatus() {
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
    isRunning() {
        if (!this.processInfo || !this.processInfo.pid) {
            return false;
        }
        // Verify the process is actually still alive
        try {
            process.kill(this.processInfo.pid, 0);
            return true;
        }
        catch {
            // Process is no longer running — clean up stale state
            this.childProcess = null;
            this.processInfo = null;
            this.removePidFile();
            return false;
        }
    }
    getSignalFilePath() {
        if (this.processInfo) {
            return this.processInfo.signalFilePath;
        }
        return null;
    }
    getPidFilePath() {
        return path.join(this.dataDir, 'monitor.pid');
    }
    writePidFile(pid) {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            fs.writeFileSync(this.getPidFilePath(), String(pid), 'utf-8');
        }
        catch {
            // Non-fatal: PID file is for convenience, not critical
        }
    }
    removePidFile() {
        try {
            const pidFile = this.getPidFilePath();
            if (fs.existsSync(pidFile)) {
                fs.unlinkSync(pidFile);
            }
        }
        catch {
            // Non-fatal
        }
    }
    cleanupSignalFile(signalFilePath) {
        try {
            if (fs.existsSync(signalFilePath)) {
                fs.unlinkSync(signalFilePath);
            }
        }
        catch {
            // Non-fatal: signal file cleanup is best-effort
        }
    }
}
exports.ProcessManager = ProcessManager;
//# sourceMappingURL=process-manager.js.map