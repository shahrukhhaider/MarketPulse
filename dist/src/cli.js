#!/usr/bin/env node
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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const command_wiring_js_1 = require("./command-wiring.js");
/**
 * CLI entry point for the stock-price-tracker tool.
 * Parses process.argv, sets up the data directory, and delegates to the CommandRouter.
 */
function main() {
    const dataDir = path.join(process.cwd(), '.stock-tracker');
    // Ensure the data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    // Create the wired router with the data directory
    const { router } = (0, command_wiring_js_1.createWiredRouter)({ dataDir });
    // Parse CLI args (skip node and script path)
    const args = process.argv.slice(2);
    const output = router.execute(args);
    process.stdout.write(output + '\n');
    process.exit(0);
}
try {
    main();
}
catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorEnvelope = {
        success: false,
        command: '',
        error: {
            code: 'INTERNAL_ERROR',
            message: `Unexpected error: ${message}`,
        },
        timestamp: new Date().toISOString(),
    };
    process.stdout.write(JSON.stringify(errorEnvelope, null, 2) + '\n');
    process.exit(1);
}
//# sourceMappingURL=cli.js.map