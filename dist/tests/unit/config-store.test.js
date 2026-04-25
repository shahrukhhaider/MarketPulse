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
const config_store_js_1 = require("../../src/config-store.js");
(0, vitest_1.describe)('ConfigStore', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-store-test-'));
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('getDefault', () => {
        (0, vitest_1.it)('returns a config with empty watchlist', () => {
            const config = (0, config_store_js_1.getDefault)();
            (0, vitest_1.expect)(config.watchlist).toEqual([]);
        });
        (0, vitest_1.it)('returns default settings', () => {
            const config = (0, config_store_js_1.getDefault)();
            (0, vitest_1.expect)(config.settings.pollingInterval).toBe(60);
            (0, vitest_1.expect)(config.settings.retentionDays).toBe(30);
            (0, vitest_1.expect)(config.settings.dataDir).toBe('.stock-tracker');
        });
    });
    (0, vitest_1.describe)('serialize', () => {
        (0, vitest_1.it)('produces pretty-printed JSON', () => {
            const config = (0, config_store_js_1.getDefault)();
            const json = (0, config_store_js_1.serialize)(config);
            (0, vitest_1.expect)(json).toContain('\n');
            (0, vitest_1.expect)(json).toBe(JSON.stringify(config, null, 2));
        });
    });
    (0, vitest_1.describe)('deserialize', () => {
        (0, vitest_1.it)('parses valid config JSON', () => {
            const config = (0, config_store_js_1.getDefault)();
            const json = (0, config_store_js_1.serialize)(config);
            const result = (0, config_store_js_1.deserialize)(json);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual(config);
            }
        });
        (0, vitest_1.it)('returns error for invalid JSON', () => {
            const result = (0, config_store_js_1.deserialize)('not valid json {{{');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain('Failed to parse config JSON');
            }
        });
        (0, vitest_1.it)('returns error for valid JSON with missing fields', () => {
            const result = (0, config_store_js_1.deserialize)('{"foo": "bar"}');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain('Invalid config structure');
            }
        });
    });
    (0, vitest_1.describe)('load', () => {
        (0, vitest_1.it)('returns default config when file does not exist', () => {
            const result = (0, config_store_js_1.load)(path.join(tmpDir, 'nonexistent.json'));
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual((0, config_store_js_1.getDefault)());
            }
        });
        (0, vitest_1.it)('loads a valid config file', () => {
            const config = {
                watchlist: [
                    {
                        ticker: 'AAPL',
                        addedAt: '2025-01-15T10:00:00Z',
                        strategies: [
                            {
                                type: 'moving_average_crossover',
                                params: { shortWindow: 10, longWindow: 50 },
                                enabled: true,
                            },
                        ],
                    },
                ],
                settings: {
                    pollingInterval: 30,
                    retentionDays: 14,
                    dataDir: '.my-tracker',
                },
            };
            const filePath = path.join(tmpDir, 'config.json');
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
            const result = (0, config_store_js_1.load)(filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual(config);
            }
        });
        (0, vitest_1.it)('returns error for file with invalid JSON', () => {
            const filePath = path.join(tmpDir, 'bad.json');
            fs.writeFileSync(filePath, '{{invalid json}}');
            const result = (0, config_store_js_1.load)(filePath);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toBeTruthy();
            }
        });
    });
    (0, vitest_1.describe)('save', () => {
        (0, vitest_1.it)('writes config to file as pretty-printed JSON', () => {
            const config = (0, config_store_js_1.getDefault)();
            const filePath = path.join(tmpDir, 'config.json');
            const result = (0, config_store_js_1.save)(config, filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            const content = fs.readFileSync(filePath, 'utf-8');
            (0, vitest_1.expect)(content).toBe(JSON.stringify(config, null, 2));
        });
        (0, vitest_1.it)('creates parent directories if they do not exist', () => {
            const config = (0, config_store_js_1.getDefault)();
            const filePath = path.join(tmpDir, 'nested', 'dir', 'config.json');
            const result = (0, config_store_js_1.save)(config, filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(fs.existsSync(filePath)).toBe(true);
        });
        (0, vitest_1.it)('round-trips through save and load', () => {
            const config = {
                watchlist: [
                    {
                        ticker: 'GOOGL',
                        addedAt: '2025-06-01T12:00:00Z',
                        strategies: [],
                    },
                ],
                settings: {
                    pollingInterval: 120,
                    retentionDays: 60,
                    dataDir: '.data',
                },
            };
            const filePath = path.join(tmpDir, 'roundtrip.json');
            (0, config_store_js_1.save)(config, filePath);
            const result = (0, config_store_js_1.load)(filePath);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.data).toEqual(config);
            }
        });
    });
});
//# sourceMappingURL=config-store.test.js.map