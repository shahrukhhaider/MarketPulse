import type { PriceHistory, PricePoint } from './types.js';
export type SuccessResult<T> = {
    success: true;
    data: T;
    warning?: string;
};
export type ErrorResult = {
    success: false;
    error: string;
};
export type Result<T> = SuccessResult<T> | ErrorResult;
export declare class PriceDataStore {
    private history;
    getHistory(): PriceHistory;
    load(filePath: string): Result<PriceHistory>;
    save(history: PriceHistory, filePath: string): Result<void>;
    addPricePoint(ticker: string, point: PricePoint): void;
    getPriceHistory(ticker: string, limit?: number): PricePoint[];
    pruneOldData(retentionDays: number): void;
}
//# sourceMappingURL=price-data-store.d.ts.map