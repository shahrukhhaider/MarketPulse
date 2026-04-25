import type { ProcessStatus } from './types.js';
export type SuccessResult<T> = {
    success: true;
    data: T;
};
export type ErrorResult = {
    success: false;
    error: {
        code: string;
        message: string;
    };
};
export type Result<T> = SuccessResult<T> | ErrorResult;
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
export declare class ProcessManager {
    private readonly dataDir;
    private childProcess;
    private processInfo;
    constructor(dataDir: string);
    spawn(config: MonitorConfig): Result<ProcessInfo>;
    terminate(): Result<void>;
    getStatus(): ProcessStatus;
    isRunning(): boolean;
    getSignalFilePath(): string | null;
    private getPidFilePath;
    private writePidFile;
    private removePidFile;
    private cleanupSignalFile;
}
//# sourceMappingURL=process-manager.d.ts.map