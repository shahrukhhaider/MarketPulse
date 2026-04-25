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
const watchlist_manager_js_1 = require("../../src/watchlist-manager.js");
const config_store_js_1 = require("../../src/config-store.js");
const types_js_1 = require("../../src/types.js");
(0, vitest_1.describe)('WatchlistManager', () => {
    let tmpDir;
    let configPath;
    let config;
    let manager;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-test-'));
        configPath = path.join(tmpDir, 'config.json');
        config = (0, config_store_js_1.getDefault)();
        manager = new watchlist_manager_js_1.WatchlistManager(config, configPath);
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('addStock', () => {
        (0, vitest_1.it)('adds a stock to an empty watchlist', () => {
            const result = manager.addStock('AAPL');
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
                (0, vitest_1.expect)(result.data.strategies).toEqual([]);
                (0, vitest_1.expect)(result.data.addedAt).toBeTruthy();
            }
        });
        (0, vitest_1.it)('normalizes ticker to uppercase', () => {
            const result = manager.addStock('aapl');
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
            }
        });
        (0, vitest_1.it)('persists the change to disk', () => {
            manager.addStock('AAPL');
            const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            (0, vitest_1.expect)(content.watchlist).toHaveLength(1);
            (0, vitest_1.expect)(content.watchlist[0].ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('returns DUPLICATE_STOCK error for existing stock', () => {
            manager.addStock('AAPL');
            const result = manager.addStock('AAPL');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.DUPLICATE_STOCK);
            }
        });
        (0, vitest_1.it)('returns DUPLICATE_STOCK for case-insensitive duplicate', () => {
            manager.addStock('AAPL');
            const result = manager.addStock('aapl');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.DUPLICATE_STOCK);
            }
        });
        (0, vitest_1.it)('adds multiple different stocks', () => {
            manager.addStock('AAPL');
            manager.addStock('GOOGL');
            manager.addStock('MSFT');
            (0, vitest_1.expect)(manager.listStocks()).toHaveLength(3);
        });
        (0, vitest_1.it)('sets addedAt to a valid ISO timestamp', () => {
            const result = manager.addStock('AAPL');
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                const date = new Date(result.data.addedAt);
                (0, vitest_1.expect)(date.getTime()).not.toBeNaN();
            }
        });
    });
    (0, vitest_1.describe)('removeStock', () => {
        (0, vitest_1.it)('removes an existing stock', () => {
            manager.addStock('AAPL');
            const result = manager.removeStock('AAPL');
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(manager.listStocks()).toHaveLength(0);
        });
        (0, vitest_1.it)('removes stock case-insensitively', () => {
            manager.addStock('AAPL');
            const result = manager.removeStock('aapl');
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(manager.listStocks()).toHaveLength(0);
        });
        (0, vitest_1.it)('persists the removal to disk', () => {
            manager.addStock('AAPL');
            manager.removeStock('AAPL');
            const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            (0, vitest_1.expect)(content.watchlist).toHaveLength(0);
        });
        (0, vitest_1.it)('returns STOCK_NOT_FOUND for missing stock', () => {
            const result = manager.removeStock('AAPL');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
            }
        });
        (0, vitest_1.it)('only removes the targeted stock', () => {
            manager.addStock('AAPL');
            manager.addStock('GOOGL');
            manager.removeStock('AAPL');
            const stocks = manager.listStocks();
            (0, vitest_1.expect)(stocks).toHaveLength(1);
            (0, vitest_1.expect)(stocks[0].ticker).toBe('GOOGL');
        });
    });
    (0, vitest_1.describe)('listStocks', () => {
        (0, vitest_1.it)('returns empty array for empty watchlist', () => {
            (0, vitest_1.expect)(manager.listStocks()).toEqual([]);
        });
        (0, vitest_1.it)('returns all added stocks', () => {
            manager.addStock('AAPL');
            manager.addStock('GOOGL');
            const stocks = manager.listStocks();
            (0, vitest_1.expect)(stocks).toHaveLength(2);
            (0, vitest_1.expect)(stocks.map((s) => s.ticker)).toEqual(['AAPL', 'GOOGL']);
        });
    });
    (0, vitest_1.describe)('hasStock', () => {
        (0, vitest_1.it)('returns false for empty watchlist', () => {
            (0, vitest_1.expect)(manager.hasStock('AAPL')).toBe(false);
        });
        (0, vitest_1.it)('returns true for existing stock', () => {
            manager.addStock('AAPL');
            (0, vitest_1.expect)(manager.hasStock('AAPL')).toBe(true);
        });
        (0, vitest_1.it)('is case-insensitive', () => {
            manager.addStock('AAPL');
            (0, vitest_1.expect)(manager.hasStock('aapl')).toBe(true);
            (0, vitest_1.expect)(manager.hasStock('Aapl')).toBe(true);
        });
        (0, vitest_1.it)('returns false after stock is removed', () => {
            manager.addStock('AAPL');
            manager.removeStock('AAPL');
            (0, vitest_1.expect)(manager.hasStock('AAPL')).toBe(false);
        });
    });
    (0, vitest_1.describe)('getStock', () => {
        (0, vitest_1.it)('returns the stock entry for an existing stock', () => {
            manager.addStock('AAPL');
            const result = manager.getStock('AAPL');
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
                (0, vitest_1.expect)(result.data.strategies).toEqual([]);
            }
        });
        (0, vitest_1.it)('is case-insensitive', () => {
            manager.addStock('AAPL');
            const result = manager.getStock('aapl');
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
            }
        });
        (0, vitest_1.it)('returns STOCK_NOT_FOUND for missing stock', () => {
            const result = manager.getStock('AAPL');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
            }
        });
    });
    (0, vitest_1.describe)('config mutation', () => {
        (0, vitest_1.it)('modifies the config object in-place on add', () => {
            manager.addStock('AAPL');
            (0, vitest_1.expect)(config.watchlist).toHaveLength(1);
            (0, vitest_1.expect)(config.watchlist[0].ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('modifies the config object in-place on remove', () => {
            manager.addStock('AAPL');
            manager.addStock('GOOGL');
            manager.removeStock('AAPL');
            (0, vitest_1.expect)(config.watchlist).toHaveLength(1);
            (0, vitest_1.expect)(config.watchlist[0].ticker).toBe('GOOGL');
        });
    });
});
//# sourceMappingURL=watchlist-manager.test.js.map