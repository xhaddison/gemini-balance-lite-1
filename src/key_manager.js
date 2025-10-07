import { Redis } from '@upstash/redis';

// Custom error for when no keys are available
class NoAvailableKeysError extends Error {
  constructor(message = 'No available API keys in the pool.') {
    super(message);
    this.name = 'NoAvailableKeysError';
  }
}

// Custom error for non-retriable client-side errors
class NonRetriableError extends Error {
  constructor(message = 'Request error based on HTTP status code. Do not retry.') {
    super(message);
    this.name = 'NonRetriableError';
  }
}

class KeyManager {
  constructor() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables must be set.');
    }
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    this.lastUsedIndexKey = 'key_manager:last_used_index';
    console.log(`[${new Date().toISOString()}] [DIAG] KeyManager initialized.`);
  }

  // The connect and disconnect methods are no longer needed with the HTTP-based Upstash SDK.

  /**
   * Retrieves an available API key using a round-robin strategy and locks it.
   * @returns {Promise<string>} The selected API key.
   * @throws {NoAvailableKeysError} If no keys are available.
   */
  async getKey() {
    console.log(`[${new Date().toISOString()}] [DIAG] PRE: Starting getKey.`);

    let cursor = 0;
    const availableKeys = [];
    let scanCount = 0;
    do {
      console.log(`[${new Date().toISOString()}] [DIAG] PRE: Executing redis.scan with cursor: ${cursor}.`);
      const [nextCursor, keys] = await this.redis.scan(cursor, { match: 'key:*:available', count: 100 });
      console.log(`[${new Date().toISOString()}] [DIAG] POST: redis.scan ${scanCount} completed. Found ${keys.length} keys. Next cursor: ${nextCursor}.`);
      cursor = nextCursor;
      availableKeys.push(...keys);
      scanCount++;
    } while (cursor !== 0);

    const availableApiKeys = availableKeys.map(key => key.split(':')[1]);
    console.log(`[${new Date().toISOString()}] [DIAG] Total available keys found: ${availableApiKeys.length}.`);

    if (availableApiKeys.length === 0) {
      console.log(`[${new Date().toISOString()}] [DIAG] No available keys. Checking if pool is empty.`);
      console.log(`[${new Date().toISOString()}] [DIAG] PRE: Executing redis.scan to check for any keys.`);
      const allKeysResult = await this.redis.scan(0, { match: 'key:*', count: 1 });
      console.log(`[${new Date().toISOString()}] [DIAG] POST: redis.scan for any keys completed. Found ${allKeysResult[1].length} keys.`);
      if (allKeysResult[1].length === 0) {
          console.error(`[${new Date().toISOString()}] [DIAG] CRITICAL: Key pool is completely empty.`);
          throw new NoAvailableKeysError('Key pool is completely empty. Please add keys.');
      }
      console.error(`[${new Date().toISOString()}] [DIAG] CRITICAL: All keys are in_use or disabled.`);
      throw new NoAvailableKeysError('All keys are currently in_use or disabled.');
    }

    availableApiKeys.sort();

    console.log(`[${new Date().toISOString()}] [DIAG] PRE: Getting last used index from Redis.`);
    const lastIndex = await this.redis.get(this.lastUsedIndexKey) || -1;
    console.log(`[${new Date().toISOString()}] [DIAG] POST: Got last used index: ${lastIndex}.`);

    const nextIndex = (Number(lastIndex) + 1) % availableApiKeys.length;
    const selectedApiKey = availableApiKeys[nextIndex];
    const keyHash = `key:${selectedApiKey}`;
    console.log(`[${new Date().toISOString()}] [DIAG] Selected key: ${selectedApiKey.substring(0, 4)}... at index ${nextIndex}.`);

    console.log(`[${new Date().toISOString()}] [DIAG] PRE: Starting pipeline to lock key.`);
    const p = this.redis.pipeline();
    p.hset(keyHash, { status: 'in_use' });
    p.set(this.lastUsedIndexKey, nextIndex);
    p.rename(`${keyHash}:available`, keyHash);

    await p.exec();
    console.log(`[${new Date().toISOString()}] [DIAG] POST: Pipeline executed. Key locked.`);

    console.log(`[${new Date().toISOString()}] [DIAG] getKey finished.`);
    return selectedApiKey;
  }

  /**
   * Handles a successful API call, making the key available again.
   * @param {string} apiKey The API key that was used successfully.
   */
  async handleSuccess(apiKey) {
    const keyHash = `key:${apiKey}`;
    console.log(`[${new Date().toISOString()}] [DIAG] PRE: handleSuccess for key ${apiKey.substring(0, 4)}...`);
    const p = this.redis.pipeline();
    p.hset(keyHash, { status: 'available', lastUsed: new Date().toISOString() });
    p.hincrby(keyHash, 'totalUses', 1);
    p.rename(keyHash, `${keyHash}:available`);
    await p.exec();
    console.log(`[${new Date().toISOString()}] [DIAG] POST: handleSuccess for key ${apiKey.substring(0, 4)}... completed.`);
  }

  /**
   * Handles a failed API call with tiered circuit-breaking logic.
   * @param {string} apiKey The API key that failed.
   * @param {number} httpStatusCode The HTTP status code from the failed call.
   * @throws {NonRetriableError} for specific non-retriable status codes.
   */
  async handleFailure(apiKey, httpStatusCode) {
    const statusCode = parseInt(httpStatusCode, 10);
    const keyHash = `key:${apiKey}`;
    let reason;
    console.log(`[${new Date().toISOString()}] [DIAG] PRE: handleFailure for key ${apiKey.substring(0, 4)}... with status ${statusCode}.`);

    // Determine reason based on status code
    if ([400, 404, 422].includes(statusCode)) {
      reason = `client_error_${statusCode}`;
    } else if ([401, 403].includes(statusCode)) {
      reason = 'invalid_auth';
    } else if (statusCode === 429) {
      reason = 'quota_exceeded';
    } else if (statusCode >= 500 && statusCode < 600) {
      reason = 'server_error';
    } else {
       reason = `unknown_error_${statusCode}`;
    }

    // Common failure handling for disabling a key
    const p = this.redis.pipeline();
    p.hset(keyHash, {
        status: 'disabled',
        reason: reason,
        lastFailure: new Date().toISOString()
    });
    p.hincrby(keyHash, 'totalFailures', 1);
    // Ensure it is not in available state by renaming
    p.rename(keyHash, `${keyHash}:disabled`);
    await p.exec();
    console.log(`[${new Date().toISOString()}] [DIAG] POST: handleFailure for key ${apiKey.substring(0, 4)}... completed. Reason: ${reason}.`);
  }
}

// No longer exporting a singleton instance

export {
    KeyManager,
    NoAvailableKeysError,
    NonRetriableError
};
