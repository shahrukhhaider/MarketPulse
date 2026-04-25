import type { Config } from './types.js';
export type SuccessResult<T> = {
    success: true;
    data: T;
};
export type ErrorResult = {
    success: false;
    error: string;
};
export type Result<T> = SuccessResult<T> | ErrorResult;
export declare function getDefault(): Config;
export declare function serialize(config: Config): string;
export declare function deserialize(json: string): Result<Config>;
export declare function load(filePath: string): Result<Config>;
export declare function save(config: Config, filePath: string): Result<void>;
//# sourceMappingURL=config-store.d.ts.map