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
exports.PriceDataStore = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function ok(data, warning) {
    const result = { success: true, data };
    if (warning) {
        result.warning = warning;
    }
    return result;
}
function err(error) {
    return { success: false, error };
}
class PriceDataStore {
    history = {};
    getHistory() {
        return this.history;
    }
    load(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                this.history = {};
                return ok(this.history);
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            if (!isValidPriceHistory(parsed)) {
                this.history = {};
                return ok(this.history, 'Price data file was corrupted. Starting with empty history.');
            }
            this.history = parsed;
            return ok(this.history);
        }
        catch {
            this.history = {};
            return ok(this.history, 'Price data file was corrupted or unavailable. Starting with empty history.');
        }
    }
    save(history, filePath) {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const json = JSON.stringify(history, null, 2);
            fs.writeFileSync(filePath, json, 'utf-8');
            return ok(undefined);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return err(`Failed to save price data to ${filePath}: ${message}`);
        }
    }
    addPricePoint(ticker, point) {
        if (!this.history[ticker]) {
            this.history[ticker] = [];
        }
        this.history[ticker].push(point);
    }
    getPriceHistory(ticker, limit) {
        const points = this.history[ticker] || [];
        if (limit !== undefined && limit >= 0) {
            return points.slice(-limit);
        }
        return [...points];
    }
    pruneOldData(retentionDays) {
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        for (const ticker of Object.keys(this.history)) {
            this.history[ticker] = this.history[ticker].filter((point) => new Date(point.timestamp) >= cutoff);
            if (this.history[ticker].length === 0) {
                delete this.history[ticker];
            }
        }
    }
}
exports.PriceDataStore = PriceDataStore;
function isValidPriceHistory(obj) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
        return false;
    const record = obj;
    for (const key of Object.keys(record)) {
        if (!Array.isArray(record[key]))
            return false;
        for (const item of record[key]) {
            if (!isValidPricePoint(item))
                return false;
        }
    }
    return true;
}
function isValidPricePoint(obj) {
    if (typeof obj !== 'object' || obj === null)
        return false;
    const record = obj;
    if (typeof record.ticker !== 'string')
        return false;
    if (typeof record.price !== 'number')
        return false;
    if (typeof record.timestamp !== 'string')
        return false;
    return true;
}
//# sourceMappingURL=price-data-store.js.map