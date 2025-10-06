// src/key_manager.js
import { Redis } from '@upstash/redis';

let redis;

// --- Redis Client Singleton ---
function getRedisClient() {
  if (!redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      console.error('[CRITICAL] Upstash Redis environment variables are missing. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
      throw new Error('Upstash Redis credentials are not configured in environment variables.');
    }
    try {
      redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL.trim(),
        token: process.env.UPSTASH_REDIS_REST_TOKEN.trim(),
      });
    } catch (error) {
      console.error('[CRITICAL] Redis client instantiation failed:', error);
      throw error; // Re-throw the error after logging
    }
  }
  return redis;
}

// --- Constants ---
const KEYS_SET_NAME = 'gemini_keys_set';

// --- Private Helpers ---
function isValidKeyFormat(key) {
  return typeof key === 'string' && key.trim().length > 30;
}

// --- Public API ---

/**
 * Retrieves all keys from the Redis Set.
 * @returns {Promise<string[]>} A promise that resolves to an array of keys.
 */
export async function getAllKeys() {
  const redisClient = getRedisClient();
  // SMEMBERS is efficient for retrieving all members of a set.
  return await redisClient.smembers(KEYS_SET_NAME);
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
    const result = await redisClient.sadd(KEYS_SET_NAME, key);
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
      await redisClient.sadd(KEYS_SET_NAME, ...Array.from(valid_keys_to_add));
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
    const result = await redisClient.srem(KEYS_SET_NAME, key);
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
  const redisClient = getRedisClient();
  // SRANDMEMBER is the O(1) command to get a random element from a set.
  const randomKey = await redisClient.srandmember(KEYS_SET_NAME);
  if (!randomKey) {
    console.error("[KeyManager] No keys available in the Redis set.");
    return null;
  }
  return { key: randomKey };
}

/**
 * Verifies the admin key from the request headers.
 * @param {Request} request - The incoming request object.
 * @returns {boolean} True if the admin key is valid, false otherwise.
 */
export function verifyAdminKey(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7);
  const adminKey = process.env.ADMIN_LOGIN_KEY;
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
    const result = await redisClient.sismember(KEYS_SET_NAME, key);
    return result === 1;
  } catch (error) {
    console.error(`[KeyManager] Error validating key: ${key.substring(0, 4)}...`, error);
    return false; // On error, assume the key is not valid.
  }
}
