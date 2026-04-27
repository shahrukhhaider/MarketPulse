"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryCacheStore = void 0;
exports.normalizeTicker = normalizeTicker;
exports.cacheKey = cacheKey;
exports.isExpired = isExpired;
exports.validateCacheEntry = validateCacheEntry;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const types_js_1 = require("./types.js");
// ============================================================
// Cache Key Utilities
// ============================================================
function normalizeTicker(ticker) {
    return ticker.toUpperCase();
}
function cacheKey(ticker, period) {
    return `${normalizeTicker(ticker)}_${period}`;
}
function isExpired(entry, ttlMs) {
    return Date.now() - Date.parse(entry.fetchedAt) > ttlMs;
}
// ============================================================
// Cache Entry Validation
// ============================================================
function validateCacheEntry(parsed) {
    if (typeof parsed !== 'object' || parsed === null)
        return false;
    const obj = parsed;
    // ticker must be a non-empty string
    if (typeof obj.ticker !== 'string' || obj.ticker.length === 0)
        return false;
    // period must be a valid HistoricalPeriod
    if (typeof obj.period !== 'string' ||
        !types_js_1.VALID_PERIODS.includes(obj.period))
        return false;
    // interval must be a valid HistoricalInterval
    if (typeof obj.interval !== 'string' ||
        !types_js_1.VALID_INTERVALS.includes(obj.interval))
        return false;
    // fetchedAt must be a valid ISO 8601 timestamp
    if (typeof obj.fetchedAt !== 'string' || isNaN(Date.parse(obj.fetchedAt)))
        return false;
    // dataPoints must be an array of valid data points
    if (!Array.isArray(obj.dataPoints))
        return false;
    for (const dp of obj.dataPoints) {
        if (typeof dp !== 'object' || dp === null)
            return false;
        const point = dp;
        if (typeof point.date !== 'string')
            return false;
        if (typeof point.open !== 'number')
            return false;
        if (typeof point.high !== 'number')
            return false;
        if (typeof point.low !== 'number')
            return false;
        if (typeof point.close !== 'number')
            return false;
        if (typeof point.volume !== 'number')
            return false;
    }
    return true;
}
// ============================================================
// History Cache Store
// ============================================================
class HistoryCacheStore {
    cacheDir;
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
    }
    filePath(ticker, period) {
        return node_path_1.default.join(this.cacheDir, cacheKey(ticker, period) + '.json');
    }
    ensureDir() {
        try {
            node_fs_1.default.mkdirSync(this.cacheDir, { recursive: true });
        }
        catch (err) {
            console.warn('Failed to create cache directory:', err);
        }
    }
    read(ticker, period) {
        try {
            const fp = this.filePath(ticker, period);
            const raw = node_fs_1.default.readFileSync(fp, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!validateCacheEntry(parsed)) {
                return null;
            }
            return parsed;
        }
        catch {
            return null;
        }
    }
    write(entry) {
        try {
            this.ensureDir();
            const fp = this.filePath(entry.ticker, entry.period);
            node_fs_1.default.writeFileSync(fp, JSON.stringify(entry, null, 2), 'utf-8');
            return true;
        }
        catch (err) {
            console.warn('Failed to write cache entry:', err);
            return false;
        }
    }
    clear(ticker) {
        try {
            if (!node_fs_1.default.existsSync(this.cacheDir)) {
                return 0;
            }
            const files = node_fs_1.default.readdirSync(this.cacheDir);
            let removed = 0;
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                if (ticker) {
                    const prefix = normalizeTicker(ticker) + '_';
                    if (!file.startsWith(prefix))
                        continue;
                }
                try {
                    node_fs_1.default.unlinkSync(node_path_1.default.join(this.cacheDir, file));
                    removed++;
                }
                catch (err) {
                    console.warn('Failed to delete cache file:', file, err);
                }
            }
            return removed;
        }
        catch (err) {
            console.warn('Failed to clear cache:', err);
            return 0;
        }
    }
}
exports.HistoryCacheStore = HistoryCacheStore;
//# sourceMappingURL=history-cache-store.js.map