"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALID_INTERVALS = exports.VALID_PERIODS = exports.ErrorCodes = void 0;
// ============================================================
// Error Code Constants
// ============================================================
exports.ErrorCodes = {
    // Input Validation
    INVALID_TICKER: 'INVALID_TICKER',
    MISSING_PARAM: 'MISSING_PARAM',
    INVALID_PARAM_RANGE: 'INVALID_PARAM_RANGE',
    // State Conflict
    DUPLICATE_STOCK: 'DUPLICATE_STOCK',
    STOCK_NOT_FOUND: 'STOCK_NOT_FOUND',
    MONITOR_ALREADY_RUNNING: 'MONITOR_ALREADY_RUNNING',
    MONITOR_NOT_RUNNING: 'MONITOR_NOT_RUNNING',
    // Data
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
    INVALID_CONFIG_JSON: 'INVALID_CONFIG_JSON',
    CORRUPT_PRICE_DATA: 'CORRUPT_PRICE_DATA',
    // External
    PRICE_FEED_UNAVAILABLE: 'PRICE_FEED_UNAVAILABLE',
    // Process
    SPAWN_FAILED: 'SPAWN_FAILED',
    TERMINATE_FAILED: 'TERMINATE_FAILED',
};
exports.VALID_PERIODS = ['1mo', '3mo', '6mo', '1y', '2y', '5y'];
exports.VALID_INTERVALS = ['1d', '1wk', '1mo'];
//# sourceMappingURL=types.js.map