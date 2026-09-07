import type { RpcResponse, SkkRpcRequest } from "./messages";

/**
 * Interface for runtime messaging abstraction.
 */
export interface IRuntimeClient {
    sendMessage<T = any>(message: SkkRpcRequest): Promise<T>;
}

/**
 * Resolves the available browser extension runtime sendMessage function.
 * Supports WXT polyfill, Firefox `browser.runtime`, Chrome `chrome.runtime`, or null if not in extension environment.
 */
export function sendRuntimeMessage<T = any>(message: SkkRpcRequest): Promise<T> {
    const g = globalThis as any;

    // 1. Check browser.runtime.sendMessage (Promise-based, Firefox / WXT)
    if (typeof g.browser !== "undefined" && typeof g.browser.runtime?.sendMessage === "function") {
        return g.browser.runtime.sendMessage(message).then((response: RpcResponse<T>) => {
            if (!response || typeof response !== "object") {
                return response as any;
            }
            if (!response.ok) {
                throw new Error(response.error ?? "RPC request failed");
            }
            return response.data as T;
        });
    }

    // 2. Check chrome.runtime.sendMessage (callback-based in MV2 / Promise-based in MV3)
    if (typeof g.chrome !== "undefined" && typeof g.chrome.runtime?.sendMessage === "function") {
        return new Promise<T>((resolve, reject) => {
            try {
                g.chrome.runtime.sendMessage(message, (response: RpcResponse<T>) => {
                    const err = g.chrome.runtime.lastError;
                    if (err) {
                        reject(new Error(err.message ?? String(err)));
                        return;
                    }
                    if (!response || typeof response !== "object") {
                        resolve(response as any);
                        return;
                    }
                    if (!response.ok) {
                        reject(new Error(response.error ?? "RPC request failed"));
                        return;
                    }
                    resolve(response.data as T);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    return Promise.reject(new Error("Browser extension runtime is not available"));
}

/**
 * Checks if browser extension runtime is available.
 */
export function isRuntimeAvailable(): boolean {
    const g = globalThis as any;
    return (
        (typeof g.browser !== "undefined" && typeof g.browser.runtime?.sendMessage === "function") ||
        (typeof g.chrome !== "undefined" && typeof g.chrome.runtime?.sendMessage === "function")
    );
}
