// src/key_manager.js
import { kv } from '@vercel/kv';

// Constants based on Gemini API documentation (e.g., for Pro accounts)
const RPM_LIMIT = 59; // Requests per minute, set slightly lower than 60 for safety
const QPD_LIMIT = 1500; // Queries per day, example value

/**
 * IntelligentKeyScheduler 类负责管理一个API密钥池，
 * 实现了基于健康状态的动态调度、主动规避速率限制、自动降级和故障隔离。
 */
class IntelligentKeyScheduler {
    static async create(rawKeysString) {
        // a. 在方法内部，首先创建一个 KeyManager 的新实例
        const manager = new IntelligentKeyScheduler(rawKeysString);

        // b. 从 Vercel KV 中读取状态
        const savedState = await kv.get('gemini-key-pool-state');

        // c. 合并状态: 如果 savedState 存在，用它来更新 manager.apiKeyPool
        // 这个逻辑确保了环境变量中新增的密钥能被正确添加，
        // 同时 Vercel KV 中保存的状态（如 cooling_down, expired 等）能够被恢复。
        if (savedState) {
            for (const [key, currentKeyObject] of manager.apiKeyPool.entries()) {
                if (savedState[key]) {
                    Object.assign(currentKeyObject, savedState[key]);
                }
            }
        }

        // d. 返回初始化完成的 manager 实例
        return manager;
    }

    /**
     * @private
     * 将当前密钥池的状态保存到 Vercel KV。
     */
    async _saveState() {
        // Vercel KV value can't be a Map, so we convert it to an Object
        const stateToSave = Object.fromEntries(this.apiKeyPool);
        await kv.set('gemini-key-pool-state', stateToSave);
    }

    /**
     * @param {string} rawKeysString - 从环境变量中获取的、逗号分隔的 API Key 字符串
     */
    constructor(rawKeysString = '') {
        /**
         * @private
         * @type {Map<string, {
         *   key_string: string,
         *   status: 'active' | 'cooling_down' | 'disabled' | 'expired',
         *   requests_this_minute: number,
         *   minute_window_start: number,
         *   requests_today: number,
         *   last_used_time: number,
         *   last_error: { code: number, timestamp: number } | null
         * }>}
         */
        this.apiKeyPool = new Map();
        this.setKeys(rawKeysString.split(',').filter(Boolean).map(k => k.trim()));
    }

    /**
     * 设置或重置 API 密钥池。
     * @param {Array<string>} keys - API 密钥字符串数组
     */
    setKeys(keys) {
        this.apiKeyPool.clear();
        keys.forEach(key => {
            this.apiKeyPool.set(key, {
                key_string: key,
                status: 'active',
                requests_this_minute: 0,
                minute_window_start: Date.now(),
                requests_today: 0, // In a real system, this would need persistence or a daily reset mechanism
                last_used_time: 0,
                last_error: null,
            });
        });
        console.log(`IntelligentKeyScheduler initialized with ${this.apiKeyPool.size} keys.`);
    }

    /**
     * 获取下一个最优的可用 API Key。
     * @returns {string} - 可用的 API Key 字符串
     * @throws {Error} 如果当前没有可用的密钥资源
     */
    async getKey() {
        const now = Date.now();

        // 1. Filter: Find all 'active' keys and perform just-in-time counter resets.
        const availableKeys = Array.from(this.apiKeyPool.values()).filter(keyObj => {
            // Reset minute counter if the window has passed
            if (now - keyObj.minute_window_start > 60000) {
                keyObj.minute_window_start = now;
                keyObj.requests_this_minute = 0;
            }
            return keyObj.status === 'active';
        });

        if (availableKeys.length === 0) {
            throw new Error('All API keys are currently unavailable (cooling down, disabled, or expired).');
        }

        // 2. Sort: Prioritize keys with the fewest requests, then the least recently used.
        availableKeys.sort((a, b) => {
            if (a.requests_this_minute !== b.requests_this_minute) {
                return a.requests_this_minute - b.requests_this_minute;
            }
            return a.last_used_time - b.last_used_time;
        });

        // 3. Check and Select: Find the first key that is not approaching its limits.
        for (const keyObj of availableKeys) {
            // Proactive avoidance for RPM
            if (keyObj.requests_this_minute >= RPM_LIMIT) {
                continue; // Skip this key, it's too close to the limit
            }
            // Proactive avoidance for QPD
            if (keyObj.requests_today >= QPD_LIMIT) {
                keyObj.status = 'expired';
                console.warn(`Key ${keyObj.key_string.substring(0, 4)}... has been marked as 'expired' due to daily quota.`);
                await this._saveState(); // State changed
                continue; // Skip this key
            }

            // 4. Return the selected key
            return keyObj.key_string;
        }

        throw new Error('No available API key is under the rate limits. Please wait.');
    }

    /**
     * API 调用后，根据 HTTP 状态码更新密钥的状态。
     * @param {string} keyString - 被使用的 API Key
     * @param {number} httpStatusCode - API 调用的 HTTP 状态码
     */
    async updateKeyStatus(keyString, httpStatusCode) {
        const keyObj = this.apiKeyPool.get(keyString);
        if (!keyObj) {
            console.error(`Attempted to update status for an unknown key: ${keyString.substring(0, 4)}...`);
            return;
        }

        const now = Date.now();
        keyObj.last_used_time = now;
        keyObj.last_error = { code: httpStatusCode, timestamp: now };

        // Handle successful requests
        if (httpStatusCode >= 200 && httpStatusCode < 300) {
            keyObj.requests_this_minute++;
            keyObj.requests_today++;
            await this._saveState(); // State changed
            return;
        }

        // Handle specific error codes based on the technical spec
        switch (httpStatusCode) {
            case 429: // Rate limit exceeded
                keyObj.status = 'cooling_down';
                console.warn(`Key ${keyObj.key_string.substring(0, 4)}... entered cooling_down due to 429 error.`);
                await this._saveState(); // State changed

                // Set a timer to automatically reactivate the key after 60 seconds
                setTimeout(async () => {
                    // Re-fetch the object to ensure we have the latest state before modifying
                    const freshKeyObj = this.apiKeyPool.get(keyString);
                    if (freshKeyObj && freshKeyObj.status === 'cooling_down') {
                        freshKeyObj.status = 'active';
                        console.log(`Key ${keyString.substring(0, 4)}... has been reactivated after cooling down.`);
                        await this._saveState(); // State changed
                    }
                }, 61 * 1000); // 61 seconds for safety
                break;

            case 400: // Bad Request
            case 401: // Unauthorized
            case 403: // Forbidden
                keyObj.status = 'disabled';
                console.error(`Key ${keyObj.key_string.substring(0, 4)}... has been permanently disabled due to ${httpStatusCode} error. Please check the key.`);
                await this._saveState(); // State changed
                // Here you might trigger an external alert (e.g., email, Slack)
                break;

            // For 5xx server errors, we don't change the key status, allowing for retries.
            case 500:
            case 502:
            case 503:
            case 504:
                 console.warn(`Key ${keyObj.key_string.substring(0, 4)}... encountered a server-side error (${httpStatusCode}). The key remains active.`);
                 break;
        }
    }
     /**
     * [Optional] Manually resets daily counters. In a real application, this should be
     * triggered by a reliable cron job at UTC midnight.
     */
    async resetDailyCounters() {
        console.log('Resetting daily counters for all keys...');
        this.apiKeyPool.forEach(keyObj => {
            keyObj.requests_today = 0;
            if (keyObj.status === 'expired') {
                keyObj.status = 'active';
                console.log(`Key ${keyObj.key_string.substring(0, 4)}... has been reactivated from 'expired' status.`);
            }
        });
        await this._saveState(); // State changed
    }
}

let keyManagerInstance;

export const getKeyManager = async () => {
    if (!keyManagerInstance) {
        keyManagerInstance = await IntelligentKeyScheduler.create(process.env.GEMINI_API_KEYS || '');
    }
    return keyManagerInstance;
};
