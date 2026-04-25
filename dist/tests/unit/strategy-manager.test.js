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
const strategy_manager_js_1 = require("../../src/strategy-manager.js");
const config_store_js_1 = require("../../src/config-store.js");
const types_js_1 = require("../../src/types.js");
(0, vitest_1.describe)('StrategyManager', () => {
    let tmpDir;
    let configPath;
    let config;
    let manager;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-test-'));
        configPath = path.join(tmpDir, 'config.json');
        config = (0, config_store_js_1.getDefault)();
        config.watchlist.push({
            ticker: 'AAPL',
            addedAt: new Date().toISOString(),
            strategies: [],
        });
        manager = new strategy_manager_js_1.StrategyManager(config, configPath);
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // ── validateParams ──────────────────────────────────────────
    (0, vitest_1.describe)('validateParams', () => {
        (0, vitest_1.describe)('moving_average_crossover', () => {
            (0, vitest_1.it)('accepts valid params', () => {
                const result = manager.validateParams('moving_average_crossover', {
                    shortWindow: 10,
                    longWindow: 50,
                });
                (0, vitest_1.expect)(result.success).toBe(true);
            });
            (0, vitest_1.it)('rejects shortWindow <= 0', () => {
                const result = manager.validateParams('moving_average_crossover', {
                    shortWindow: 0,
                    longWindow: 50,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
                if (!result.success) {
                    (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
                    (0, vitest_1.expect)(result.error).toContain('shortWindow');
                }
            });
            (0, vitest_1.it)('rejects longWindow <= shortWindow', () => {
                const result = manager.validateParams('moving_average_crossover', {
                    shortWindow: 50,
                    longWindow: 50,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
                if (!result.success) {
                    (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
                    (0, vitest_1.expect)(result.error).toContain('longWindow');
                }
            });
        });
        (0, vitest_1.describe)('rsi_threshold', () => {
            (0, vitest_1.it)('accepts valid params', () => {
                const result = manager.validateParams('rsi_threshold', {
                    period: 14,
                    overbought: 70,
                    oversold: 30,
                });
                (0, vitest_1.expect)(result.success).toBe(true);
            });
            (0, vitest_1.it)('rejects period <= 0', () => {
                const result = manager.validateParams('rsi_threshold', {
                    period: 0,
                    overbought: 70,
                    oversold: 30,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
                if (!result.success) {
                    (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
                    (0, vitest_1.expect)(result.error).toContain('period');
                }
            });
            (0, vitest_1.it)('rejects oversold >= overbought', () => {
                const result = manager.validateParams('rsi_threshold', {
                    period: 14,
                    overbought: 30,
                    oversold: 70,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
                if (!result.success) {
                    (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
                    (0, vitest_1.expect)(result.error).toContain('oversold');
                }
            });
            (0, vitest_1.it)('rejects oversold out of (0, 100) range', () => {
                const result = manager.validateParams('rsi_threshold', {
                    period: 14,
                    overbought: 70,
                    oversold: 0,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
            });
            (0, vitest_1.it)('rejects overbought out of (0, 100) range', () => {
                const result = manager.validateParams('rsi_threshold', {
                    period: 14,
                    overbought: 100,
                    oversold: 30,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
            });
        });
        (0, vitest_1.describe)('price_breakout', () => {
            (0, vitest_1.it)('accepts valid params', () => {
                const result = manager.validateParams('price_breakout', {
                    upperLevel: 200,
                    lowerLevel: 150,
                });
                (0, vitest_1.expect)(result.success).toBe(true);
            });
            (0, vitest_1.it)('rejects lowerLevel <= 0', () => {
                const result = manager.validateParams('price_breakout', {
                    upperLevel: 200,
                    lowerLevel: 0,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
                if (!result.success) {
                    (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
                    (0, vitest_1.expect)(result.error).toContain('lowerLevel');
                }
            });
            (0, vitest_1.it)('rejects upperLevel <= lowerLevel', () => {
                const result = manager.validateParams('price_breakout', {
                    upperLevel: 150,
                    lowerLevel: 150,
                });
                (0, vitest_1.expect)(result.success).toBe(false);
                if (!result.success) {
                    (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
                    (0, vitest_1.expect)(result.error).toContain('upperLevel');
                }
            });
        });
        (0, vitest_1.it)('rejects unknown strategy type', () => {
            const result = manager.validateParams('unknown_strategy', {});
            (0, vitest_1.expect)(result.success).toBe(false);
        });
    });
    // ── configureStrategy ───────────────────────────────────────
    (0, vitest_1.describe)('configureStrategy', () => {
        (0, vitest_1.it)('adds a new strategy to a watchlist stock', () => {
            const result = manager.configureStrategy('AAPL', 'moving_average_crossover', {
                shortWindow: 10,
                longWindow: 50,
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            const strategies = manager.getStrategies('AAPL');
            (0, vitest_1.expect)(strategies).toHaveLength(1);
            (0, vitest_1.expect)(strategies[0].type).toBe('moving_average_crossover');
            (0, vitest_1.expect)(strategies[0].enabled).toBe(true);
        });
        (0, vitest_1.it)('persists strategy to config file', () => {
            manager.configureStrategy('AAPL', 'rsi_threshold', {
                period: 14,
                overbought: 70,
                oversold: 30,
            });
            const loaded = (0, config_store_js_1.load)(configPath);
            (0, vitest_1.expect)(loaded.success).toBe(true);
            if (loaded.success) {
                const entry = loaded.data.watchlist.find((e) => e.ticker === 'AAPL');
                (0, vitest_1.expect)(entry?.strategies).toHaveLength(1);
                (0, vitest_1.expect)(entry?.strategies[0].type).toBe('rsi_threshold');
            }
        });
        (0, vitest_1.it)('updates existing strategy params while preserving enabled state', () => {
            manager.configureStrategy('AAPL', 'moving_average_crossover', {
                shortWindow: 10,
                longWindow: 50,
            });
            manager.disableStrategy('AAPL', 'moving_average_crossover');
            manager.configureStrategy('AAPL', 'moving_average_crossover', {
                shortWindow: 5,
                longWindow: 20,
            });
            const strategies = manager.getStrategies('AAPL');
            (0, vitest_1.expect)(strategies).toHaveLength(1);
            (0, vitest_1.expect)(strategies[0].params.shortWindow).toBe(5);
            (0, vitest_1.expect)(strategies[0].enabled).toBe(false); // preserved
        });
        (0, vitest_1.it)('returns error for stock not in watchlist', () => {
            const result = manager.configureStrategy('MSFT', 'rsi_threshold', {
                period: 14,
                overbought: 70,
                oversold: 30,
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
            }
        });
        (0, vitest_1.it)('returns error for invalid params', () => {
            const result = manager.configureStrategy('AAPL', 'moving_average_crossover', {
                shortWindow: -1,
                longWindow: 50,
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            }
        });
        (0, vitest_1.it)('supports multiple strategies on the same stock', () => {
            manager.configureStrategy('AAPL', 'moving_average_crossover', {
                shortWindow: 10,
                longWindow: 50,
            });
            manager.configureStrategy('AAPL', 'rsi_threshold', {
                period: 14,
                overbought: 70,
                oversold: 30,
            });
            const strategies = manager.getStrategies('AAPL');
            (0, vitest_1.expect)(strategies).toHaveLength(2);
        });
    });
    // ── enableStrategy / disableStrategy ────────────────────────
    (0, vitest_1.describe)('enableStrategy / disableStrategy', () => {
        (0, vitest_1.beforeEach)(() => {
            manager.configureStrategy('AAPL', 'moving_average_crossover', {
                shortWindow: 10,
                longWindow: 50,
            });
        });
        (0, vitest_1.it)('disables a strategy', () => {
            const result = manager.disableStrategy('AAPL', 'moving_average_crossover');
            (0, vitest_1.expect)(result.success).toBe(true);
            const strategies = manager.getStrategies('AAPL');
            (0, vitest_1.expect)(strategies[0].enabled).toBe(false);
        });
        (0, vitest_1.it)('enables a disabled strategy', () => {
            manager.disableStrategy('AAPL', 'moving_average_crossover');
            const result = manager.enableStrategy('AAPL', 'moving_average_crossover');
            (0, vitest_1.expect)(result.success).toBe(true);
            const strategies = manager.getStrategies('AAPL');
            (0, vitest_1.expect)(strategies[0].enabled).toBe(true);
        });
        (0, vitest_1.it)('preserves params when toggling enabled state', () => {
            manager.disableStrategy('AAPL', 'moving_average_crossover');
            manager.enableStrategy('AAPL', 'moving_average_crossover');
            const strategies = manager.getStrategies('AAPL');
            const params = strategies[0].params;
            (0, vitest_1.expect)(params.shortWindow).toBe(10);
            (0, vitest_1.expect)(params.longWindow).toBe(50);
            (0, vitest_1.expect)(strategies[0].type).toBe('moving_average_crossover');
        });
        (0, vitest_1.it)('persists toggle to config file', () => {
            manager.disableStrategy('AAPL', 'moving_average_crossover');
            const loaded = (0, config_store_js_1.load)(configPath);
            (0, vitest_1.expect)(loaded.success).toBe(true);
            if (loaded.success) {
                const entry = loaded.data.watchlist.find((e) => e.ticker === 'AAPL');
                (0, vitest_1.expect)(entry?.strategies[0].enabled).toBe(false);
            }
        });
        (0, vitest_1.it)('returns error for stock not in watchlist', () => {
            const result = manager.enableStrategy('MSFT', 'moving_average_crossover');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
            }
        });
        (0, vitest_1.it)('returns error for strategy not configured on stock', () => {
            const result = manager.disableStrategy('AAPL', 'rsi_threshold');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
            }
        });
    });
    // ── getStrategies ───────────────────────────────────────────
    (0, vitest_1.describe)('getStrategies', () => {
        (0, vitest_1.it)('returns empty array for stock with no strategies', () => {
            (0, vitest_1.expect)(manager.getStrategies('AAPL')).toEqual([]);
        });
        (0, vitest_1.it)('returns empty array for unknown stock', () => {
            (0, vitest_1.expect)(manager.getStrategies('UNKNOWN')).toEqual([]);
        });
        (0, vitest_1.it)('returns all configured strategies', () => {
            manager.configureStrategy('AAPL', 'moving_average_crossover', {
                shortWindow: 10,
                longWindow: 50,
            });
            manager.configureStrategy('AAPL', 'price_breakout', {
                upperLevel: 200,
                lowerLevel: 150,
            });
            const strategies = manager.getStrategies('AAPL');
            (0, vitest_1.expect)(strategies).toHaveLength(2);
            (0, vitest_1.expect)(strategies.map((s) => s.type)).toContain('moving_average_crossover');
            (0, vitest_1.expect)(strategies.map((s) => s.type)).toContain('price_breakout');
        });
    });
    // ── case-insensitive ticker matching ────────────────────────
    (0, vitest_1.describe)('case-insensitive ticker matching', () => {
        (0, vitest_1.it)('configureStrategy matches case-insensitively', () => {
            const result = manager.configureStrategy('aapl', 'rsi_threshold', {
                period: 14,
                overbought: 70,
                oversold: 30,
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(manager.getStrategies('AAPL')).toHaveLength(1);
        });
        (0, vitest_1.it)('enable/disable matches case-insensitively', () => {
            manager.configureStrategy('AAPL', 'rsi_threshold', {
                period: 14,
                overbought: 70,
                oversold: 30,
            });
            (0, vitest_1.expect)(manager.disableStrategy('aapl', 'rsi_threshold').success).toBe(true);
            (0, vitest_1.expect)(manager.enableStrategy('Aapl', 'rsi_threshold').success).toBe(true);
        });
    });
});
//# sourceMappingURL=strategy-manager.test.js.map