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
exports.SignalStore = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function ok(data) {
    return { success: true, data };
}
function err(error) {
    return { success: false, error };
}
class SignalStore {
    signalFilePath;
    constructor(signalFilePath) {
        this.signalFilePath = signalFilePath;
    }
    getFilePath() {
        return this.signalFilePath;
    }
    writeSignals(signals) {
        try {
            const existing = this.readFileData();
            const merged = [...existing.signals, ...signals];
            const pid = existing.sessionPid || this.extractPidFromPath();
            const data = {
                sessionPid: pid,
                signals: merged,
                lastUpdated: new Date().toISOString(),
            };
            const dir = path.dirname(this.signalFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.signalFilePath, JSON.stringify(data, null, 2), 'utf-8');
            return ok(undefined);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return err(`Failed to write signals to ${this.signalFilePath}: ${message}`);
        }
    }
    readSignals(since) {
        const data = this.readFileData();
        if (!since) {
            return data.signals;
        }
        return data.signals.filter((signal) => new Date(signal.timestamp) >= since);
    }
    getSignalHistory(limit) {
        const data = this.readFileData();
        const sorted = [...data.signals].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (limit !== undefined && limit >= 0) {
            return sorted.slice(0, limit);
        }
        return sorted;
    }
    isDuplicate(signal) {
        const data = this.readFileData();
        return data.signals.some((existing) => existing.ticker === signal.ticker &&
            existing.strategyType === signal.strategyType &&
            existing.direction === signal.direction);
    }
    readFileData() {
        try {
            if (!fs.existsSync(this.signalFilePath)) {
                return { sessionPid: this.extractPidFromPath(), signals: [], lastUpdated: '' };
            }
            const content = fs.readFileSync(this.signalFilePath, 'utf-8');
            const parsed = JSON.parse(content);
            if (isValidSignalFileData(parsed)) {
                return parsed;
            }
            return { sessionPid: this.extractPidFromPath(), signals: [], lastUpdated: '' };
        }
        catch {
            return { sessionPid: this.extractPidFromPath(), signals: [], lastUpdated: '' };
        }
    }
    extractPidFromPath() {
        const basename = path.basename(this.signalFilePath, '.json');
        const match = basename.match(/signals-(\d+)/);
        return match ? parseInt(match[1], 10) : process.pid;
    }
}
exports.SignalStore = SignalStore;
function isValidSignalFileData(obj) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
        return false;
    const record = obj;
    if (typeof record.sessionPid !== 'number')
        return false;
    if (!Array.isArray(record.signals))
        return false;
    if (typeof record.lastUpdated !== 'string')
        return false;
    for (const item of record.signals) {
        if (!isValidSignal(item))
            return false;
    }
    return true;
}
function isValidSignal(obj) {
    if (typeof obj !== 'object' || obj === null)
        return false;
    const record = obj;
    if (typeof record.id !== 'string')
        return false;
    if (typeof record.ticker !== 'string')
        return false;
    if (typeof record.direction !== 'string')
        return false;
    if (typeof record.strategyType !== 'string')
        return false;
    if (typeof record.price !== 'number')
        return false;
    if (typeof record.timestamp !== 'string')
        return false;
    return true;
}
//# sourceMappingURL=signal-store.js.map