// src/key_manager.js

/**
 * KeyManager 类负责管理一个API密钥池，
 * 并实现智能的密钥轮换、状态跟踪和定期重置机制。
 */
class KeyManager {
    /**
     * @param {string} rawKeysString - 从环境变量中获取的、逗号分隔的 API Key 字符串
     */
    constructor(rawKeysString = '') {
        const keys = rawKeysString.split(',').filter(Boolean).map(k => k.trim());

        /**
         * @private
         * @type {Array<{key: string, quotaExceeded: boolean, lastUsed: number|null}>}
         */
        this.apiKeyPool = keys.map(key => ({
            key: key,
            quotaExceeded: false,
            lastUsed: null,
        }));

        /**
         * @private
         * @type {number}
         */
        this.currentKeyIndex = 0;

        console.log(`KeyManager initialized with ${this.apiKeyPool.length} keys.`);
    }

    /**
     * 获取下一个可用的 API Key。
     * 它会过滤掉所有超出配额的密钥，并在剩余的密钥中进行轮换。
     * @returns {{key: string, quotaExceeded: boolean, lastUsed: number|null}}
     * @throws {Error} 如果所有密钥都已超出配额
     */
    getNextAvailableKey() {
        const availableKeys = this.apiKeyPool.filter(k => !k.quotaExceeded);

        if (availableKeys.length === 0) {
            throw new Error('All API keys have exceeded their quota. Please wait for the quota to reset.');
        }

        // 使用循环索引在可用密钥中选择一个
        this.currentKeyIndex = (this.currentKeyIndex + 1) % availableKeys.length;
        const keyObject = availableKeys[this.currentKeyIndex];

        // 更新最后使用时间
        keyObject.lastUsed = Date.now();

        return keyObject;
    }

    /**
     * 将指定的密钥标记为已超出配额。
     * @param {string} key - 要标记的 API Key 字符串
     */
    markQuotaExceeded(key) {
        const keyObject = this.apiKeyPool.find(k => k.key === key);
        if (keyObject) {
            if (!keyObject.quotaExceeded) {
                keyObject.quotaExceeded = true;
                console.warn(`API Key ${key.substring(0, 4)}... has been marked as quota exceeded.`);
            }
        } else {
            console.error(`Attempted to mark an unknown key as quota exceeded: ${key.substring(0, 4)}...`);
        }
    }

    /**
     * 将池中所有密钥的配额状态重置为 false。
     * 这可以用于定期（例如每小时）恢复所有密钥，以便系统重新尝试使用它们。
     */
    resetAllQuotaStatus() {
        console.log('Resetting quota status for all API keys...');
        this.apiKeyPool.forEach(keyObject => {
            keyObject.quotaExceeded = false;
        });
        console.log('All API key quotas have been reset.');
    }
}

// 从环境变量中获取 API 密钥
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS || '';

// 创建并导出一个 KeyManager 的单例实例，确保整个应用共享同一个密钥池状态。
const keyManagerInstance = new KeyManager(GEMINI_API_KEYS);

export default keyManagerInstance;
