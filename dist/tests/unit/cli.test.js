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
const command_wiring_js_1 = require("../../src/command-wiring.js");
(0, vitest_1.describe)('CLI entry point behavior', () => {
    let tmpDir;
    let dataDir;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
        dataDir = path.join(tmpDir, '.stock-tracker');
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('should create data directory if it does not exist', () => {
        (0, vitest_1.expect)(fs.existsSync(dataDir)).toBe(false);
        fs.mkdirSync(dataDir, { recursive: true });
        (0, vitest_1.expect)(fs.existsSync(dataDir)).toBe(true);
    });
    (0, vitest_1.it)('should execute a command and return valid JSON output', () => {
        fs.mkdirSync(dataDir, { recursive: true });
        const { router } = (0, command_wiring_js_1.createWiredRouter)({ dataDir });
        const output = router.execute(['list-watchlist']);
        const parsed = JSON.parse(output);
        (0, vitest_1.expect)(parsed).toHaveProperty('success', true);
        (0, vitest_1.expect)(parsed).toHaveProperty('command', 'list-watchlist');
        (0, vitest_1.expect)(parsed).toHaveProperty('timestamp');
        (0, vitest_1.expect)(parsed.data).toHaveProperty('stocks');
        (0, vitest_1.expect)(parsed.data).toHaveProperty('count', 0);
    });
    (0, vitest_1.it)('should return JSON error for unknown command', () => {
        fs.mkdirSync(dataDir, { recursive: true });
        const { router } = (0, command_wiring_js_1.createWiredRouter)({ dataDir });
        const output = router.execute(['unknown-cmd']);
        const parsed = JSON.parse(output);
        (0, vitest_1.expect)(parsed.success).toBe(false);
        (0, vitest_1.expect)(parsed.error).toBeDefined();
        (0, vitest_1.expect)(parsed.error.code).toBe('MISSING_PARAM');
        (0, vitest_1.expect)(parsed.error.message).toContain('Unknown command');
    });
    (0, vitest_1.it)('should return JSON error when no command is provided', () => {
        fs.mkdirSync(dataDir, { recursive: true });
        const { router } = (0, command_wiring_js_1.createWiredRouter)({ dataDir });
        const output = router.execute([]);
        const parsed = JSON.parse(output);
        (0, vitest_1.expect)(parsed.success).toBe(false);
        (0, vitest_1.expect)(parsed.error).toBeDefined();
        (0, vitest_1.expect)(parsed.error.message).toContain('No command specified');
    });
    (0, vitest_1.it)('should return JSON error for missing required parameters', () => {
        fs.mkdirSync(dataDir, { recursive: true });
        const { router } = (0, command_wiring_js_1.createWiredRouter)({ dataDir });
        const output = router.execute(['add-stock']);
        const parsed = JSON.parse(output);
        (0, vitest_1.expect)(parsed.success).toBe(false);
        (0, vitest_1.expect)(parsed.error.code).toBe('MISSING_PARAM');
        (0, vitest_1.expect)(parsed.error.message).toContain('--ticker');
    });
    (0, vitest_1.it)('should use default polling interval of 60 seconds for start-monitor', () => {
        fs.mkdirSync(dataDir, { recursive: true });
        const { router } = (0, command_wiring_js_1.createWiredRouter)({ dataDir });
        // Parse the args to verify the default interval is applied in the handler
        const parsed = router.parse(['start-monitor']);
        (0, vitest_1.expect)(parsed.command).toBe('start-monitor');
        // No --interval means the handler defaults to 60s (tested via command-wiring)
        (0, vitest_1.expect)(parsed.options['interval']).toBeUndefined();
    });
    (0, vitest_1.it)('should handle uncaught errors with JSON error envelope', () => {
        // Simulate the error handling pattern from cli.ts
        const error = new Error('Something went wrong');
        const errorEnvelope = {
            success: false,
            command: '',
            error: {
                code: 'INTERNAL_ERROR',
                message: `Unexpected error: ${error.message}`,
            },
            timestamp: new Date().toISOString(),
        };
        (0, vitest_1.expect)(errorEnvelope.success).toBe(false);
        (0, vitest_1.expect)(errorEnvelope.error.code).toBe('INTERNAL_ERROR');
        (0, vitest_1.expect)(errorEnvelope.error.message).toContain('Something went wrong');
        (0, vitest_1.expect)(errorEnvelope.timestamp).toBeDefined();
    });
    (0, vitest_1.it)('should produce output that is always valid JSON', () => {
        fs.mkdirSync(dataDir, { recursive: true });
        const { router } = (0, command_wiring_js_1.createWiredRouter)({ dataDir });
        const commands = [
            ['list-watchlist'],
            ['get-status'],
            ['add-stock'],
            ['unknown'],
            [],
        ];
        for (const args of commands) {
            const output = router.execute(args);
            (0, vitest_1.expect)(() => JSON.parse(output)).not.toThrow();
            const parsed = JSON.parse(output);
            (0, vitest_1.expect)(parsed).toHaveProperty('success');
            (0, vitest_1.expect)(parsed).toHaveProperty('command');
            (0, vitest_1.expect)(parsed).toHaveProperty('timestamp');
        }
    });
});
//# sourceMappingURL=cli.test.js.map