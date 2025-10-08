import { Redis } from '@upstash/redis';

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
    console.log(`[${new Date().toISOString()}] [INFO] KeyManager initialized and connected to Redis.`);
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
    const key = await this.redis.hgetall(keyHash);
    if (!key) {
      console.error(`[${new Date().toISOString()}] [ERROR] Key not found for update: ${apiKey}`);
      throw new Error(`Attempted to update a non-existent key: ${apiKey}`);
    }

    let current_score = parseFloat(key.health_score) || 1.0;
    let new_score;

    const updateData = {};

    if (success) {
      new_score = current_score + 0.05 * (1 - current_score);
      updateData.totalUses = (parseInt(key.totalUses, 10) || 0) + 1;
      // START of change
      if (quotaInfo && typeof quotaInfo.remaining !== 'undefined') {
          updateData.quota_remaining = quotaInfo.remaining;
      }
      if (quotaInfo && quotaInfo.resetTime) {
          updateData.quota_reset_time = quotaInfo.resetTime;
      }
      // END of change
    } else {
      new_score = current_score * 0.75;
      updateData.totalFailures = (parseInt(key.totalFailures, 10) || 0) + 1;
      updateData.lastFailure = new Date().toISOString();

      const statusCode = parseInt(httpStatusCode, 10);
      if ([401, 403].includes(statusCode)) {
        updateData.status = 'disabled';
        updateData.reason = 'invalid_auth';
      } else if (statusCode === 429) {
        updateData.status = 'disabled';
        updateData.reason = 'quota_exceeded';
      } else if (statusCode >= 500 && statusCode < 600) {
        // For server errors, we just lower the score but don't disable immediately
        updateData.reason = 'server_error';
        updateData.status = 'disabled';
      }
    }

    updateData.health_score = new_score.toFixed(4);

    const totalUses = parseInt(updateData.totalUses || key.totalUses, 10) || 0;
    const totalFailures = parseInt(updateData.totalFailures || key.totalFailures, 10) || 0;
    if (totalUses > 0) {
        updateData.error_rate = (totalFailures / totalUses).toFixed(4);
    }

    await this.redis.hset(keyHash, updateData);
    console.log(`[${new Date().toISOString()}] [INFO] Updated key ${apiKey.substring(0, 4)}... Success: ${success}, New Score: ${updateData.health_score}`);
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
