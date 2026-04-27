"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataProviderRegistry = void 0;
// ============================================================
// DataProviderRegistry
// ============================================================
class DataProviderRegistry {
    providers = new Map();
    register(provider) {
        this.providers.set(provider.name, provider);
    }
    get(name) {
        return this.providers.get(name);
    }
    has(name) {
        return this.providers.has(name);
    }
    list() {
        return Array.from(this.providers.keys());
    }
}
exports.DataProviderRegistry = DataProviderRegistry;
//# sourceMappingURL=data-provider.js.map