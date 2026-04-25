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
exports.getDefault = getDefault;
exports.serialize = serialize;
exports.deserialize = deserialize;
exports.load = load;
exports.save = save;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function ok(data) {
    return { success: true, data };
}
function err(error) {
    return { success: false, error };
}
const DEFAULT_SETTINGS = {
    pollingInterval: 60,
    retentionDays: 30,
    dataDir: '.stock-tracker',
};
function getDefault() {
    return {
        watchlist: [],
        settings: { ...DEFAULT_SETTINGS },
    };
}
function serialize(config) {
    return JSON.stringify(config, null, 2);
}
function deserialize(json) {
    try {
        const parsed = JSON.parse(json);
        if (!isValidConfig(parsed)) {
            return err('Invalid config structure: missing required fields');
        }
        return ok(parsed);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return err(`Failed to parse config JSON: ${message}`);
    }
}
function load(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return ok(getDefault());
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return deserialize(content);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return err(`Failed to load config from ${filePath}: ${message}`);
    }
}
function save(config, filePath) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const json = serialize(config);
        fs.writeFileSync(filePath, json, 'utf-8');
        return ok(undefined);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return err(`Failed to save config to ${filePath}: ${message}`);
    }
}
function isValidConfig(obj) {
    if (typeof obj !== 'object' || obj === null)
        return false;
    const record = obj;
    if (!Array.isArray(record.watchlist))
        return false;
    if (typeof record.settings !== 'object' || record.settings === null)
        return false;
    const settings = record.settings;
    if (typeof settings.pollingInterval !== 'number')
        return false;
    if (typeof settings.retentionDays !== 'number')
        return false;
    if (typeof settings.dataDir !== 'string')
        return false;
    return true;
}
//# sourceMappingURL=config-store.js.map