// src/key_manager.js (Radical Simplicity Edition)
import { Redis } from '@upstash/redis';

let redis;

function getRedisClient() {
  if (!redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Upstash Redis environment variables are not configured.');
    }
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

const KEYS_QUEUE_NAME = 'keys_queue';

/**
 * Gets the next available key from the head of the queue.
 * This is a FIFO (First-In, First-Out) approach.
 * @returns {Promise<string|null>} The key, or null if the queue is empty.
 */
export async function getNextKey() {
  try {
    const redisClient = getRedisClient();
    // LPOP is an atomic operation.
    const key = await redisClient.lpop(KEYS_QUEUE_NAME);
    if (!key) {
        console.warn('[KeyManager] Key queue is empty.');
        return null;
    }
    return key;
  } catch (error) {
    console.error('[KeyManager] Failed to get next key from Redis:', error);
    return null; // On error, return null to prevent cascading failures.
  }
}

/**
 * Returns a key to the tail of the queue to be used again later.
 * @param {string} key - The key to return.
 * @returns {Promise<void>}
 */
export async function returnKey(key) {
    if (typeof key !== 'string' || key.length === 0) {
        console.error('[KeyManager] Attempted to return an invalid key.');
        return;
    }
  try {
    const redisClient = getRedisClient();
    // RPUSH is an atomic operation.
    await redisClient.rpush(KEYS_QUEUE_NAME, key);
  } catch (error) {
    console.error(`[KeyManager] Failed to return key ${key.substring(0,4)}... to Redis:`, error);
    // If returning the key fails, we log the error but don't throw.
    // This prevents a Redis failure from crashing the entire request.
    // The key will be temporarily out of rotation.
  }
}

/**
 * (Admin Function) Initializes the queue with a fresh set of keys, clearing any old ones.
 * @param {string[]} keys - The full list of keys to populate the queue with.
 */
export async function initializeKeys(keys) {
    const redisClient = getRedisClient();
    const tx = redisClient.multi();
    tx.del(KEYS_QUEUE_NAME);
    if (keys && keys.length > 0) {
        tx.rpush(KEYS_QUEUE_NAME, ...keys);
    }
    await tx.exec();
}
