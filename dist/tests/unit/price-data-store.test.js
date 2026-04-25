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
const price_data_store_js_1 = require("../../src/price-data-store.js");
(0, vitest_1.describe)('PriceDataStore', () => {
    let tmpDir;
    let store;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-data-store-test-'));
        store = new price_data_store_js_1.PriceDataStore();
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('load', () => {
        (0, vitest_1.it)('returns empty history when file does not exist', () => {
            const result = store.load(path.join(tmpDir, 'nonexistent.json'));
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual({});
                (0, vitest_1.expect)(result.warning).toBeUndefined();
            }
        });
        (0, vitest_1.it)('loads valid price history from file', () => {
            const history = {
                AAPL: [
                    { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' },
                ],
            };
            const filePath = path.join(tmpDir, 'prices.json');
            fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
            const result = store.load(filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual(history);
                (0, vitest_1.expect)(result.warning).toBeUndefined();
            }
        });
        (0, vitest_1.it)('returns empty history with warning for corrupted JSON', () => {
            const filePath = path.join(tmpDir, 'bad.json');
            fs.writeFileSync(filePath, '{{not valid json}}');
            const result = store.load(filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual({});
                (0, vitest_1.expect)(result.warning).toBeDefined();
                (0, vitest_1.expect)(result.warning).toContain('corrupted');
            }
        });
        (0, vitest_1.it)('returns empty history with warning for invalid structure', () => {
            const filePath = path.join(tmpDir, 'invalid.json');
            fs.writeFileSync(filePath, JSON.stringify({ AAPL: 'not an array' }));
            const result = store.load(filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual({});
                (0, vitest_1.expect)(result.warning).toBeDefined();
            }
        });
        (0, vitest_1.it)('returns empty history with warning for array instead of object', () => {
            const filePath = path.join(tmpDir, 'array.json');
            fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]));
            const result = store.load(filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual({});
                (0, vitest_1.expect)(result.warning).toBeDefined();
            }
        });
    });
    (0, vitest_1.describe)('save', () => {
        (0, vitest_1.it)('writes price history to file as pretty-printed JSON', () => {
            const history = {
                AAPL: [
                    { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' },
                ],
            };
            const filePath = path.join(tmpDir, 'prices.json');
            const result = store.save(history, filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            const content = fs.readFileSync(filePath, 'utf-8');
            (0, vitest_1.expect)(content).toBe(JSON.stringify(history, null, 2));
        });
        (0, vitest_1.it)('creates parent directories if they do not exist', () => {
            const filePath = path.join(tmpDir, 'nested', 'dir', 'prices.json');
            const result = store.save({}, filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(fs.existsSync(filePath)).toBe(true);
        });
        (0, vitest_1.it)('round-trips through save and load', () => {
            const history = {
                AAPL: [
                    { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' },
                    { ticker: 'AAPL', price: 196.2, timestamp: '2025-01-15T10:01:00Z', change: 0.7, changePercent: 0.36 },
                ],
                GOOGL: [
                    { ticker: 'GOOGL', price: 2800.0, timestamp: '2025-01-15T10:00:00Z' },
                ],
            };
            const filePath = path.join(tmpDir, 'roundtrip.json');
            store.save(history, filePath);
            const newStore = new price_data_store_js_1.PriceDataStore();
            const result = newStore.load(filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual(history);
            }
        });
    });
    (0, vitest_1.describe)('addPricePoint', () => {
        (0, vitest_1.it)('adds a price point for a new ticker', () => {
            const point = { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' };
            store.addPricePoint('AAPL', point);
            (0, vitest_1.expect)(store.getPriceHistory('AAPL')).toEqual([point]);
        });
        (0, vitest_1.it)('appends to existing ticker history', () => {
            const p1 = { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' };
            const p2 = { ticker: 'AAPL', price: 196.2, timestamp: '2025-01-15T10:01:00Z' };
            store.addPricePoint('AAPL', p1);
            store.addPricePoint('AAPL', p2);
            (0, vitest_1.expect)(store.getPriceHistory('AAPL')).toEqual([p1, p2]);
        });
    });
    (0, vitest_1.describe)('getPriceHistory', () => {
        (0, vitest_1.it)('returns empty array for unknown ticker', () => {
            (0, vitest_1.expect)(store.getPriceHistory('UNKNOWN')).toEqual([]);
        });
        (0, vitest_1.it)('returns all points when no limit specified', () => {
            const points = [
                { ticker: 'AAPL', price: 195.0, timestamp: '2025-01-15T10:00:00Z' },
                { ticker: 'AAPL', price: 196.0, timestamp: '2025-01-15T10:01:00Z' },
                { ticker: 'AAPL', price: 197.0, timestamp: '2025-01-15T10:02:00Z' },
            ];
            for (const p of points)
                store.addPricePoint('AAPL', p);
            (0, vitest_1.expect)(store.getPriceHistory('AAPL')).toEqual(points);
        });
        (0, vitest_1.it)('returns last N points when limit is specified', () => {
            const points = [
                { ticker: 'AAPL', price: 195.0, timestamp: '2025-01-15T10:00:00Z' },
                { ticker: 'AAPL', price: 196.0, timestamp: '2025-01-15T10:01:00Z' },
                { ticker: 'AAPL', price: 197.0, timestamp: '2025-01-15T10:02:00Z' },
            ];
            for (const p of points)
                store.addPricePoint('AAPL', p);
            (0, vitest_1.expect)(store.getPriceHistory('AAPL', 2)).toEqual([points[1], points[2]]);
        });
        (0, vitest_1.it)('returns all points when limit exceeds count', () => {
            const point = { ticker: 'AAPL', price: 195.0, timestamp: '2025-01-15T10:00:00Z' };
            store.addPricePoint('AAPL', point);
            (0, vitest_1.expect)(store.getPriceHistory('AAPL', 10)).toEqual([point]);
        });
    });
    (0, vitest_1.describe)('pruneOldData', () => {
        (0, vitest_1.it)('removes data older than retention days', () => {
            const now = new Date();
            const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
            const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
            const oldPoint = { ticker: 'AAPL', price: 190.0, timestamp: oldDate.toISOString() };
            const recentPoint = { ticker: 'AAPL', price: 195.0, timestamp: recentDate.toISOString() };
            store.addPricePoint('AAPL', oldPoint);
            store.addPricePoint('AAPL', recentPoint);
            store.pruneOldData(30);
            (0, vitest_1.expect)(store.getPriceHistory('AAPL')).toEqual([recentPoint]);
        });
        (0, vitest_1.it)('removes ticker key when all data is pruned', () => {
            const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
            const oldPoint = { ticker: 'AAPL', price: 190.0, timestamp: oldDate.toISOString() };
            store.addPricePoint('AAPL', oldPoint);
            store.pruneOldData(30);
            (0, vitest_1.expect)(store.getHistory()).toEqual({});
        });
        (0, vitest_1.it)('retains all data within retention window', () => {
            const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            const point = { ticker: 'AAPL', price: 195.0, timestamp: recentDate.toISOString() };
            store.addPricePoint('AAPL', point);
            store.pruneOldData(30);
            (0, vitest_1.expect)(store.getPriceHistory('AAPL')).toEqual([point]);
        });
        (0, vitest_1.it)('prunes across multiple tickers', () => {
            const now = new Date();
            const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
            const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
            store.addPricePoint('AAPL', { ticker: 'AAPL', price: 190.0, timestamp: oldDate.toISOString() });
            store.addPricePoint('GOOGL', { ticker: 'GOOGL', price: 2800.0, timestamp: recentDate.toISOString() });
            store.pruneOldData(30);
            (0, vitest_1.expect)(store.getHistory()).toEqual({
                GOOGL: [{ ticker: 'GOOGL', price: 2800.0, timestamp: recentDate.toISOString() }],
            });
        });
    });
});
//# sourceMappingURL=price-data-store.test.js.map