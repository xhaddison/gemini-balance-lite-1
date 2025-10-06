// src/key_manager.js
import { Redis } from '@upstash/redis';

let redisClient = null;

function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error('[CRITICAL] Upstash Redis environment variables are missing. UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set.');
    throw new Error('Upstash Redis environment variables are not configured.');
  }

  redisClient = new Redis({
    url: url,
    token: token,
  });

  return redisClient;
}

/**
 * Retrieves all Gemini API keys from Upstash Redis.
 *
 * @returns {Promise<string[]>} A promise that resolves to an array of API keys.
 */
export async function getAllKeys() {
  try {
    console.log("[REDIS_DIAG] --- Attempting to get Redis client.");
    const redis = getRedisClient();
    console.log("[REDIS_DIAG] --- Redis client acquired.");

    console.log("[REDIS_DIAG] --- Attempting to fetch keys from Redis...");
    // Using 'smembers' which is more appropriate for getting all members of a set.
    // Assuming keys are stored in a set named 'gemini_keys'. This is a common pattern.
    const keys = await redis.smembers('gemini_keys');
    console.log(`[REDIS_DIAG] --- Successfully fetched ${keys.length} keys.`);

    return keys;
  } catch (e) {
    console.error(`[REDIS_DIAG] --- CRITICAL ERROR in getAllKeys: ${e.message}`);
    throw e;
  }
}
