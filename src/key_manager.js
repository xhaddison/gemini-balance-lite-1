// src/key_manager.js
import { Redis } from '@upstash/redis';

let redis;

// --- Redis Client Singleton ---
function getRedisClient() {
  if (!redis) {
    try {
      // In Vercel Edge Functions, environment variables provided by integrations
      // like Upstash are accessible via the standard `process.env` object.
      // This is the official, documented method. Using `Redis.fromEnv()` previously
      // failed because it may not be compatible with the Vercel Edge Runtime's
      // environment variable handling.
      if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error('Upstash Redis environment variables are not configured.');
      }
      redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    } catch (error) {
      // This will catch errors if the env vars are not set or if instantiation fails.
      console.error('[CRITICAL] Redis client instantiation failed. Ensure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are correctly set in your Vercel project.', error);
      throw new Error('Failed to connect to Upstash Redis. Please check server logs.');
    }
  }
  return redis;
}

// --- Constants ---
const ACTIVE_KEYS_SET = 'active_keys';
const COOLDOWN_KEYS_HASH = 'cooldown:keys';
const INVALID_KEYS_SET = 'invalid_keys';


/**
 * [Internal] Cleans the cooldown hash by moving expired keys back to the active set.
 * This is a critical maintenance task to ensure keys are recycled.
 */
async function cleanupCooldownKeys() {
  const redisClient = getRedisClient();
  const now = Math.floor(Date.now() / 1000);

  try {
    const cooldownKeys = await redisClient.hgetall(COOLDOWN_KEYS_HASH);
    if (!cooldownKeys) {
      return; // No keys in cooldown, nothing to do.
    }

    const keysToReactivate = [];
    const keysToRemoveFromCooldown = [];

    for (const key in cooldownKeys) {
      if (cooldownKeys[key] <= now) {
        keysToReactivate.push(key);
        keysToRemoveFromCooldown.push(key);
      }
    }

    if (keysToReactivate.length > 0) {
      const tx = redisClient.multi();
      tx.sadd(ACTIVE_KEYS_SET, ...keysToReactivate);
      tx.hdel(COOLDOWN_KEYS_HASH, ...keysToRemoveFromCooldown);
      await tx.exec();
      console.log(`[KeyManager] Reactivated ${keysToReactivate.length} key(s) from cooldown.`);
    }
  } catch (error) {
    console.error('[KeyManager] Error during cooldown cleanup:', error);
    // Do not throw, as the main logic should still try to proceed.
  }
}

// --- Public API ---

/**
 * Retrieves all keys from the Redis Set.
 * @returns {Promise<string[]>} A promise that resolves to an array of keys.
 */
export async function getAllKeys() {
  const redisClient = getRedisClient();
  // SMEMBERS is efficient for retrieving all members of a set.
  return await redisClient.smembers(ACTIVE_KEYS_SET);
}

/**
 * Adds a single valid key to the Redis Set.
 * @param {string} key - The API key to add.
 * @returns {Promise<{success: boolean, message: string}>} Operation result.
 */
export async function addKey(key) {
  if (!isValidKeyFormat(key)) {
    return { success: false, message: 'Invalid API key format.' };
  }
  try {
    const redisClient = getRedisClient();
    // SADD returns 1 if the key was new, 0 if it already existed.
    const result = await redisClient.sadd(ACTIVE_KEYS_SET, key);
    if (result > 0) {
        console.log(`[KeyManager] Successfully added key: ${key.substring(0, 4)}...`);
        return { success: true, message: 'Key added successfully.' };
    } else {
        return { success: false, message: 'Key already exists.' };
    }
  } catch (error) {
    console.error(`[KeyManager] Error adding key: ${key.substring(0, 4)}...`, error);
    return { success: false, message: 'An error occurred while adding the key.' };
  }
}

/**
 * Adds multiple Gemini API keys in bulk using a Redis Set.
 * @param {Array<string>} keys - An array of API keys to add.
 * @returns {Promise<{success: boolean, successfully_added: number, failed_entries: Array<object>}>} The result.
 */
export async function addKeysBulk(keys) {
  const redisClient = getRedisClient();
  const failed_entries = [];
  const valid_keys_to_add = new Set();

  try {
    const existingKeys = new Set(await getAllKeys());

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i].trim();
      const line = i + 1;

      if (!key) continue;

      if (!isValidKeyFormat(key)) {
        failed_entries.push({ key: key, line, reason: '格式无效' });
      } else if (existingKeys.has(key)) {
        failed_entries.push({ key: key, line, reason: '密钥已存在' });
      } else if (valid_keys_to_add.has(key)) {
         failed_entries.push({ key: key, line, reason: '文件内重复' });
      } else {
        valid_keys_to_add.add(key);
      }
    }

    if (valid_keys_to_add.size > 0) {
      // Use SADD with multiple arguments for efficiency.
      await redisClient.sadd(ACTIVE_KEYS_SET, ...Array.from(valid_keys_to_add));
    }

    return {
      success: true,
      successfully_added: valid_keys_to_add.size,
      failed_entries,
    };

  } catch (error) {
    console.error('[KeyManager] Error during bulk key addition:', error);
    return {
      success: false,
      successfully_added: 0,
      failed_entries,
      message: 'An internal error occurred during the bulk operation.'
    };
  }
}

/**
 * Deletes a single key from the Redis Set.
 * @param {string} key - The API key to delete.
 * @returns {Promise<{success: boolean, message: string}>} Operation result.
 */
export async function deleteKey(key) {
  if (!isValidKeyFormat(key)) {
    return { success: false, message: 'Invalid API key format.' };
  }
  try {
    const redisClient = getRedisClient();
    // SREM returns 1 if the key was found and removed, 0 otherwise.
    const result = await redisClient.srem(ACTIVE_KEYS_SET, key);
    if (result > 0) {
      console.log(`[KeyManager] Successfully deleted key: ${key.substring(0, 4)}...`);
      return { success: true, message: 'Key deleted successfully.' };
    } else {
      console.warn(`[KeyManager] Attempted to delete a non-existent key: ${key.substring(0, 4)}...`);
      return { success: false, message: 'Key not found.' };
    }
  } catch (error) {
    console.error(`[KeyManager] Error deleting key: ${key.substring(0, 4)}...`, error);
    return { success: false, message: 'An error occurred while deleting the key.' };
  }
}

/**
 * Gets a random key efficiently from the Redis Set.
 * @returns {Promise<{key: string} | null>} A random key object or null if the set is empty.
 */
export async function getRandomKey() {
  await cleanupCooldownKeys(); // CRITICAL: Ensure cooldown is cleared before getting a key.
  const redisClient = getRedisClient();
  // SRANDMEMBER is the O(1) command to get a random element from a set.
  const randomKey = await redisClient.srandmember(ACTIVE_KEYS_SET);
  if (!randomKey) {
    console.error("[KeyManager] No keys available in the Redis set.");
    return null;
  }
  return { key: randomKey };
}

/**
 * Gets a specified number of random keys from the active set.
 * This is the primary function for the API router to get a pool of keys to try.
 * @param {number} [count=5] - The number of random keys to retrieve.
 * @returns {Promise<string[]>} An array of random keys. Returns an empty array if no keys are available.
 */
export async function getAvailableKeys(count = 5) {
  await cleanupCooldownKeys(); // Ensure cooldown is cleared before getting keys.
  const redisClient = getRedisClient();

  try {
    // SRANDMEMBER with a count argument returns an array of unique random elements.
    const keys = await redisClient.srandmember(ACTIVE_KEYS_SET, count);
    if (!keys || keys.length === 0) {
      console.error("[KeyManager] No active keys available to serve the request.");
      return [];
    }
    return keys;
  } catch (error) {
    console.error('[KeyManager] Error retrieving available keys:', error);
    return []; // Return empty array on error to prevent caller failure.
  }
}

/**
 * Verifies the admin key from the request headers.
 * @param {Request} request - The incoming request object.
 * @returns {boolean} True if the admin key is valid, false otherwise.
 */
export function verifyAdminKey(request, adminKey) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7);
  // Ensure both token and adminKey exist and are non-empty before comparing.
  return adminKey ? token.trim() === adminKey.trim() : false;
}

/**
 * Checks if a key exists in the Redis Set.
 * @param {string} key - The API key to validate.
 * @returns {Promise<boolean>} True if the key exists, false otherwise.
 */
export async function validateKey(key) {
  if (!isValidKeyFormat(key)) {
    return false;
  }
  try {
    const redisClient = getRedisClient();
    // SISMEMBER is the O(1) command to check for membership in a set.
    const result = await redisClient.sismember(ACTIVE_KEYS_SET, key);
    return result === 1;
  } catch (error) {
    console.error(`[KeyManager] Error validating key: ${key.substring(0, 4)}...`, error);
    return false; // On error, assume the key is not valid.
  }
}
