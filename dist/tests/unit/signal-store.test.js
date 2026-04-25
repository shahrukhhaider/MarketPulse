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
const vitest_1 = require("vitest");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const signal_store_js_1 = require("../../src/signal-store.js");
function makeSignal(overrides = {}) {
    return {
        id: 'sig_001',
        ticker: 'AAPL',
        direction: 'BUY',
        strategyType: 'moving_average_crossover',
        price: 196.2,
        timestamp: '2025-01-15T10:01:00Z',
        ...overrides,
    };
}
(0, vitest_1.describe)('SignalStore', () => {
    let tmpDir;
    let signalFilePath;
    let store;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-store-test-'));
        signalFilePath = path.join(tmpDir, 'signals-12345.json');
        store = new signal_store_js_1.SignalStore(signalFilePath);
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('constructor and getFilePath', () => {
        (0, vitest_1.it)('returns the file path passed to constructor', () => {
            (0, vitest_1.expect)(store.getFilePath()).toBe(signalFilePath);
        });
        (0, vitest_1.it)('extracts PID from file path pattern', () => {
            const customPath = path.join(tmpDir, 'signals-99999.json');
            const customStore = new signal_store_js_1.SignalStore(customPath);
            (0, vitest_1.expect)(customStore.getFilePath()).toBe(customPath);
        });
    });
    (0, vitest_1.describe)('writeSignals', () => {
        (0, vitest_1.it)('writes signals to a new file', () => {
            const signal = makeSignal();
            const result = store.writeSignals([signal]);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(fs.existsSync(signalFilePath)).toBe(true);
            const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
            (0, vitest_1.expect)(content.signals).toHaveLength(1);
            (0, vitest_1.expect)(content.signals[0].ticker).toBe('AAPL');
            (0, vitest_1.expect)(content.sessionPid).toBe(12345);
            (0, vitest_1.expect)(content.lastUpdated).toBeTruthy();
        });
        (0, vitest_1.it)('appends signals to existing file', () => {
            store.writeSignals([makeSignal({ id: 'sig_001' })]);
            store.writeSignals([makeSignal({ id: 'sig_002', ticker: 'GOOGL' })]);
            const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
            (0, vitest_1.expect)(content.signals).toHaveLength(2);
            (0, vitest_1.expect)(content.signals[0].ticker).toBe('AAPL');
            (0, vitest_1.expect)(content.signals[1].ticker).toBe('GOOGL');
        });
        (0, vitest_1.it)('creates parent directories if needed', () => {
            const nestedPath = path.join(tmpDir, 'nested', 'dir', 'signals-100.json');
            const nestedStore = new signal_store_js_1.SignalStore(nestedPath);
            const result = nestedStore.writeSignals([makeSignal()]);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(fs.existsSync(nestedPath)).toBe(true);
        });
        (0, vitest_1.it)('writes multiple signals at once', () => {
            const signals = [
                makeSignal({ id: 'sig_001', ticker: 'AAPL' }),
                makeSignal({ id: 'sig_002', ticker: 'GOOGL' }),
                makeSignal({ id: 'sig_003', ticker: 'MSFT' }),
            ];
            const result = store.writeSignals(signals);
            (0, vitest_1.expect)(result.success).toBe(true);
            const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
            (0, vitest_1.expect)(content.signals).toHaveLength(3);
        });
    });
    (0, vitest_1.describe)('readSignals', () => {
        (0, vitest_1.it)('returns empty array when file does not exist', () => {
            const signals = store.readSignals();
            (0, vitest_1.expect)(signals).toEqual([]);
        });
        (0, vitest_1.it)('returns all signals when no since date provided', () => {
            store.writeSignals([
                makeSignal({ id: 'sig_001', timestamp: '2025-01-15T10:00:00Z' }),
                makeSignal({ id: 'sig_002', timestamp: '2025-01-15T11:00:00Z' }),
            ]);
            const signals = store.readSignals();
            (0, vitest_1.expect)(signals).toHaveLength(2);
        });
        (0, vitest_1.it)('filters signals by since date', () => {
            store.writeSignals([
                makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
                makeSignal({ id: 'sig_002', timestamp: '2025-01-15T10:00:00Z' }),
                makeSignal({ id: 'sig_003', timestamp: '2025-01-15T12:00:00Z' }),
            ]);
            const since = new Date('2025-01-15T09:00:00Z');
            const signals = store.readSignals(since);
            (0, vitest_1.expect)(signals).toHaveLength(2);
            (0, vitest_1.expect)(signals[0].id).toBe('sig_002');
            (0, vitest_1.expect)(signals[1].id).toBe('sig_003');
        });
        (0, vitest_1.it)('returns empty array when all signals are before since date', () => {
            store.writeSignals([
                makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
            ]);
            const since = new Date('2025-01-16T00:00:00Z');
            const signals = store.readSignals(since);
            (0, vitest_1.expect)(signals).toEqual([]);
        });
    });
    (0, vitest_1.describe)('getSignalHistory', () => {
        (0, vitest_1.it)('returns empty array when file does not exist', () => {
            const history = store.getSignalHistory();
            (0, vitest_1.expect)(history).toEqual([]);
        });
        (0, vitest_1.it)('returns signals ordered by timestamp descending', () => {
            store.writeSignals([
                makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
                makeSignal({ id: 'sig_003', timestamp: '2025-01-15T12:00:00Z' }),
                makeSignal({ id: 'sig_002', timestamp: '2025-01-15T10:00:00Z' }),
            ]);
            const history = store.getSignalHistory();
            (0, vitest_1.expect)(history).toHaveLength(3);
            (0, vitest_1.expect)(history[0].id).toBe('sig_003');
            (0, vitest_1.expect)(history[1].id).toBe('sig_002');
            (0, vitest_1.expect)(history[2].id).toBe('sig_001');
        });
        (0, vitest_1.it)('limits results when limit is provided', () => {
            store.writeSignals([
                makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
                makeSignal({ id: 'sig_002', timestamp: '2025-01-15T10:00:00Z' }),
                makeSignal({ id: 'sig_003', timestamp: '2025-01-15T12:00:00Z' }),
            ]);
            const history = store.getSignalHistory(2);
            (0, vitest_1.expect)(history).toHaveLength(2);
            (0, vitest_1.expect)(history[0].id).toBe('sig_003');
            (0, vitest_1.expect)(history[1].id).toBe('sig_002');
        });
        (0, vitest_1.it)('returns all signals when limit exceeds count', () => {
            store.writeSignals([makeSignal()]);
            const history = store.getSignalHistory(100);
            (0, vitest_1.expect)(history).toHaveLength(1);
        });
        (0, vitest_1.it)('returns empty array when limit is 0', () => {
            store.writeSignals([makeSignal()]);
            const history = store.getSignalHistory(0);
            (0, vitest_1.expect)(history).toEqual([]);
        });
    });
    (0, vitest_1.describe)('isDuplicate', () => {
        (0, vitest_1.it)('returns false when file does not exist', () => {
            const signal = makeSignal();
            (0, vitest_1.expect)(store.isDuplicate(signal)).toBe(false);
        });
        (0, vitest_1.it)('returns true for same ticker, strategyType, and direction', () => {
            store.writeSignals([makeSignal({
                    ticker: 'AAPL',
                    strategyType: 'moving_average_crossover',
                    direction: 'BUY',
                })]);
            const signal = makeSignal({
                id: 'sig_new',
                ticker: 'AAPL',
                strategyType: 'moving_average_crossover',
                direction: 'BUY',
                timestamp: '2025-01-16T10:00:00Z',
            });
            (0, vitest_1.expect)(store.isDuplicate(signal)).toBe(true);
        });
        (0, vitest_1.it)('returns false for different ticker', () => {
            store.writeSignals([makeSignal({ ticker: 'AAPL' })]);
            const signal = makeSignal({ ticker: 'GOOGL' });
            (0, vitest_1.expect)(store.isDuplicate(signal)).toBe(false);
        });
        (0, vitest_1.it)('returns false for different strategyType', () => {
            store.writeSignals([makeSignal({ strategyType: 'moving_average_crossover' })]);
            const signal = makeSignal({ strategyType: 'rsi_threshold' });
            (0, vitest_1.expect)(store.isDuplicate(signal)).toBe(false);
        });
        (0, vitest_1.it)('returns false for different direction', () => {
            store.writeSignals([makeSignal({ direction: 'BUY' })]);
            const signal = makeSignal({ direction: 'SELL' });
            (0, vitest_1.expect)(store.isDuplicate(signal)).toBe(false);
        });
    });
    (0, vitest_1.describe)('corrupted file handling', () => {
        (0, vitest_1.it)('returns empty signals for corrupted JSON', () => {
            fs.writeFileSync(signalFilePath, '{{not valid json}}');
            const signals = store.readSignals();
            (0, vitest_1.expect)(signals).toEqual([]);
        });
        (0, vitest_1.it)('returns empty signals for invalid structure', () => {
            fs.writeFileSync(signalFilePath, JSON.stringify({ foo: 'bar' }));
            const signals = store.readSignals();
            (0, vitest_1.expect)(signals).toEqual([]);
        });
        (0, vitest_1.it)('writeSignals overwrites corrupted file', () => {
            fs.writeFileSync(signalFilePath, '{{not valid json}}');
            const result = store.writeSignals([makeSignal()]);
            (0, vitest_1.expect)(result.success).toBe(true);
            const signals = store.readSignals();
            (0, vitest_1.expect)(signals).toHaveLength(1);
        });
    });
    (0, vitest_1.describe)('signal file format', () => {
        (0, vitest_1.it)('writes correct signal file structure', () => {
            store.writeSignals([makeSignal()]);
            const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
            (0, vitest_1.expect)(content).toHaveProperty('sessionPid');
            (0, vitest_1.expect)(content).toHaveProperty('signals');
            (0, vitest_1.expect)(content).toHaveProperty('lastUpdated');
            (0, vitest_1.expect)(typeof content.sessionPid).toBe('number');
            (0, vitest_1.expect)(Array.isArray(content.signals)).toBe(true);
            (0, vitest_1.expect)(typeof content.lastUpdated).toBe('string');
        });
        (0, vitest_1.it)('sessionPid matches PID from file path', () => {
            store.writeSignals([makeSignal()]);
            const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
            (0, vitest_1.expect)(content.sessionPid).toBe(12345);
        });
    });
});
//# sourceMappingURL=signal-store.test.js.map