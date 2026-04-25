"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fast_check_1 = __importDefault(require("fast-check"));
(0, vitest_1.describe)('Project Setup', () => {
    (0, vitest_1.it)('should have vitest working', () => {
        (0, vitest_1.expect)(1 + 1).toBe(2);
    });
    (0, vitest_1.it)('should have fast-check working', () => {
        fast_check_1.default.assert(fast_check_1.default.property(fast_check_1.default.integer(), fast_check_1.default.integer(), (a, b) => {
            (0, vitest_1.expect)(a + b).toBe(b + a);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=setup.test.js.map