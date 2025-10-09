import { Redis } from '@upstash/redis';
import fs from 'fs';
import path from 'path';

// Custom error for when no keys are available
class NoAvailableKeysError extends Error {
  constructor(message = 'No available API keys in the pool.') {
    super(message);
    this.name = 'NoAvailableKeysError';
  }
}

class KeyManager {
  constructor() {
    this.redis = null;
    this.updateKeyScriptSha = null;
    console.log(`[${new Date().toISOString()}] [INFO] KeyManager instance created. Call initialize() to connect.`);
  }

  async initialize() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables must be set.');
    }
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL.trim(),
      token: process.env.UPSTASH_REDIS_REST_TOKEN.trim(),
    });
    console.log(`[${new Date().toISOString()}] [INFO] KeyManager connected to Redis. Loading Lua script...`);

    // Load the Lua script for atomic key updates
    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'redis', 'update_key.lua');
      const script = fs.readFileSync(scriptPath, 'utf8');
      this.updateKeyScriptSha = await this.redis.scriptLoad(script);
      console.log(`[${new Date().toISOString()}] [INFO] Lua script 'update_key.lua' loaded successfully. SHA: ${this.updateKeyScriptSha}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [FATAL] Failed to load 'update_key.lua' script. KeyManager cannot operate.`, error);
      throw new Error(`Failed to load Redis Lua script: ${error.message}`);
    }
  }

  /**
   * Retrieves the best available API key based on health score and remaining quota.
   * @returns {Promise<object>} The best available key object.
   * @throws {NoAvailableKeysError} If no keys are available after filtering.
   */
  async getBestKey() {
    console.log(`[${new Date().toISOString()}] [INFO] Starting getBestKey.`);

    console.log(`[${new Date().toISOString()}] [DEBUG] Before redis.scan.`);
    // 1. Fetch all keys from Redis
    const allKeyHashes = await this.redis.scan(0, { match: 'key:*', count: 1000 });
    console.log(`[${new Date().toISOString()}] [DEBUG] After redis.scan. Found ${allKeyHashes[1].length} key patterns.`);
    const keys = allKeyHashes[1];
    if (keys.length === 0) {
      throw new NoAvailableKeysError('Key pool is completely empty.');
    }

    const pipeline = this.redis.pipeline();
    // Inefficiently getting ALL fields. Let's get only what we need.
    keys.forEach(key => pipeline.hmget(key, 'apiKey', 'status', 'lastUsed', 'health_score', 'quota_remaining'));
    const keyObjectsRaw = await pipeline.exec();

    const keyObjects = keys.map((keyName, index) => {
        const raw = keyObjectsRaw[index];
        if (!raw || raw.length === 0) return null;
        // Reconstruct from hmget array result. The order MUST match the hmget call.
        return {
            apiKey: raw[0],
            status: raw[1],
            lastUsed: raw[2],
            health_score: raw[3],
            quota_remaining: raw[4],
        };
    });

    // 2. Filter keys
    const now = Date.now();
    const cooldownPeriod = 1000; // 1 second cooldown
    const availableKeys = keyObjects.filter(key => {
        if (!key) return false;
        const lastUsed = key.lastUsed ? parseInt(key.lastUsed, 10) : 0;
        return key.status === 'available' && (now - lastUsed > cooldownPeriod);
    });

    if (availableKeys.length === 0) {
      throw new NoAvailableKeysError('All keys are in_use, disabled, or in cooldown.');
    }

    // 3. Sort keys
    availableKeys.sort((a, b) => {
      const scoreA = parseFloat(a.health_score || 0);
      const scoreB = parseFloat(b.health_score || 0);
      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Sort by health_score DESC
      }
      const quotaA = parseInt(a.quota_remaining || 0, 10);
      const quotaB = parseInt(b.quota_remaining || 0, 10);
      return quotaB - quotaA; // Then by quota_remaining DESC
    });

    // 4. Select the best key
    const bestKey = availableKeys[0];
    console.log(`[${new Date().toISOString()}] [INFO] Selected best key: ${bestKey.apiKey.substring(0, 4)}...`);

    return bestKey;
  }

  /**
   * Updates a key's status and metrics after an API call.
   * @param {string} apiKey The API key to update.
   * @param {boolean} success Whether the API call was successful.
   * @param {number} httpStatusCode The HTTP status code from the API call.
   * @param {object} quotaInfo Quota information from response headers.
   */
  async updateKey(apiKey, success, httpStatusCode, quotaInfo = {}) {
    const keyHash = `key:${apiKey}`;
    try {
      const args = [
        String(success),
        String(httpStatusCode),
        quotaInfo.remaining !== undefined ? String(quotaInfo.remaining) : '',
        quotaInfo.resetTime || '',
        new Date().toISOString(),
      ];

      // Atomically update the key using the pre-loaded Lua script
      await this.redis.evalsha(this.updateKeyScriptSha, [keyHash], args);

      console.log(`[${new Date().toISOString()}] [INFO] Updated key ${apiKey.substring(0, 4)}... via Lua script. Success: ${success}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [ERROR] Failed to update key ${apiKey} using Lua script.`, error);
      // Fallback or re-throw, depending on desired robustness.
      // For now, re-throwing to make the caller aware.
      throw new Error(`Lua script execution failed for key ${apiKey}: ${error.message}`);
    }
  }

  /**
   * Atomically locks a key by setting its status to 'in_use'.
   * @param {string} apiKey The API key to lock.
   * @returns {Promise<boolean>} True if locked successfully, false otherwise.
   */
  async lockKey(apiKey) {
    const keyHash = `key:${apiKey}`;
    const result = await this.redis.hset(keyHash, { status: 'in_use', lastUsed: new Date().toISOString() });
    console.log(`[${new Date().toISOString()}] [INFO] Locked key: ${apiKey.substring(0, 4)}...`);
    return result > 0;
  }

  /**
   * Atomically releases a key by setting its status to 'available'.
   * @param {string} apiKey The API key to release.
   * @returns {Promise<boolean>} True if released successfully, false otherwise.
   */
  async releaseKey(apiKey) {
    const keyHash = `key:${apiKey}`;
    const result = await this.redis.hset(keyHash, { status: 'available' });
    console.log(`[${new Date().toISOString()}] [INFO] Released key: ${apiKey.substring(0, 4)}...`);
    return result > 0;
  }
}

export {
    KeyManager,
    NoAvailableKeysError,
};
