"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WatchlistManager = void 0;
const types_js_1 = require("./types.js");
const config_store_js_1 = require("./config-store.js");
class WatchlistManager {
    config;
    configFilePath;
    constructor(config, configFilePath) {
        this.config = config;
        this.configFilePath = configFilePath;
    }
    addStock(ticker) {
        const normalized = ticker.toUpperCase();
        if (this.hasStock(normalized)) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.DUPLICATE_STOCK}: Stock '${normalized}' is already in the watchlist`,
            };
        }
        const entry = {
            ticker: normalized,
            addedAt: new Date().toISOString(),
            strategies: [],
        };
        this.config.watchlist.push(entry);
        const saveResult = (0, config_store_js_1.save)(this.config, this.configFilePath);
        if (!saveResult.success) {
            // Roll back the in-memory change
            this.config.watchlist.pop();
            return { success: false, error: saveResult.error };
        }
        return { success: true, data: entry };
    }
    removeStock(ticker) {
        const normalized = ticker.toUpperCase();
        const index = this.config.watchlist.findIndex((e) => e.ticker.toUpperCase() === normalized);
        if (index === -1) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.STOCK_NOT_FOUND}: Stock '${normalized}' is not in the watchlist`,
            };
        }
        const [removed] = this.config.watchlist.splice(index, 1);
        const saveResult = (0, config_store_js_1.save)(this.config, this.configFilePath);
        if (!saveResult.success) {
            // Roll back the in-memory change
            this.config.watchlist.splice(index, 0, removed);
            return { success: false, error: saveResult.error };
        }
        return { success: true, data: undefined };
    }
    listStocks() {
        return this.config.watchlist;
    }
    hasStock(ticker) {
        const normalized = ticker.toUpperCase();
        return this.config.watchlist.some((e) => e.ticker.toUpperCase() === normalized);
    }
    getStock(ticker) {
        const normalized = ticker.toUpperCase();
        const entry = this.config.watchlist.find((e) => e.ticker.toUpperCase() === normalized);
        if (!entry) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.STOCK_NOT_FOUND}: Stock '${normalized}' is not in the watchlist`,
            };
        }
        return { success: true, data: entry };
    }
}
exports.WatchlistManager = WatchlistManager;
//# sourceMappingURL=watchlist-manager.js.map