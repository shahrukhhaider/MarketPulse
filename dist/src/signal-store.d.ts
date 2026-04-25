import type { Signal } from './types.js';
export type SuccessResult<T> = {
    success: true;
    data: T;
};
export type ErrorResult = {
    success: false;
    error: string;
};
export type Result<T> = SuccessResult<T> | ErrorResult;
export declare class SignalStore {
    private readonly signalFilePath;
    constructor(signalFilePath: string);
    getFilePath(): string;
    writeSignals(signals: Signal[]): Result<void>;
    readSignals(since?: Date): Signal[];
    getSignalHistory(limit?: number): Signal[];
    isDuplicate(signal: Signal): boolean;
    private readFileData;
    private extractPidFromPath;
}
//# sourceMappingURL=signal-store.d.ts.map