// src/key_manager.js
import Redis from 'ioredis';

let redis;

function getRedisClient(env) {
  if (!redis) {
    // ioredis can directly use the redis:// URL format
    redis = new Redis(env.UPSTASH_REDIS_REST_URL);
  }
  return redis;
}

const KEY_PREFIX = 'gemini_key:';

/**
 * Validates a Gemini API key format.
 * A typical key is a long alphanumeric string.
 * This is a basic check for non-empty strings.
 * @param {string} key The API key to validate.
 * @returns {boolean} True if the key format is valid, false otherwise.
 */
function isValidKeyFormat(key) {
  return typeof key === 'string' && key.trim().length > 30; // Basic sanity check
}

/**
 * Retrieves all Gemini API keys from the KV store.
 * @param {object} env The Cloudflare environment object.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of keys.
 */
export async function getAllKeys(env) {
  const redisClient = getRedisClient(env);
  const keys = await redisClient.keys(`${KEY_PREFIX}*`);
  return keys.map(key => key.substring(KEY_PREFIX.length));
}

/**
 * Adds a new Gemini API key to the KV store.
 * @param {string} key The API key to add.
 * @param {object} env The Cloudflare environment object.
 * @returns {Promise<{success: boolean, message: string}>} The result of the operation.
 */
export async function addKey(key, env) {
  if (!isValidKeyFormat(key)) {
    return { success: false, message: 'Invalid API key format.' };
  }
  try {
    const redisClient = getRedisClient(env);
    const keyWithPrefix = `${KEY_PREFIX}${key}`;
    await redisClient.set(keyWithPrefix, 'active'); // The value can be simple, e.g., 'active'
    console.log(`[KeyManager] Successfully added key: ${key.substring(0, 4)}...`);
    return { success: true, message: 'Key added successfully.' };
  } catch (error) {
    console.error(`[KeyManager] Error adding key: ${key.substring(0, 4)}...`, error);
    return { success: false, message: 'An error occurred while adding the key.' };
  }
}

/**
 * Deletes a Gemini API key from the KV store.
 * @param {string} key The API key to delete.
 * @param {object} env The Cloudflare environment object.
 * @returns {Promise<{success: boolean, message: string}>} The result of the operation.
 */
export async function deleteKey(key, env) {
  if (!isValidKeyFormat(key)) {
    // Still good to check format to avoid accidental deletion of unrelated keys
    return { success: false, message: 'Invalid API key format.' };
  }
  try {
    const redisClient = getRedisClient(env);
    const keyWithPrefix = `${KEY_PREFIX}${key}`;
    const result = await redisClient.del(keyWithPrefix);
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
 * Verifies the admin login key from the Authorization header.
 * @param {Request} request The incoming request object.
 * @param {object} env The Cloudflare environment object.
 * @returns {boolean} True if the key is valid, false otherwise.
 */
export function verifyAdminKey(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7); // "Bearer ".length
  return token === env.ADMIN_LOGIN_KEY;
}

/**
 * Selects a random, healthy API key from the pool.
 * @param {object} env The Cloudflare environment object.
 * @returns {Promise<string|null>} A random key or null if no keys are available.
 */
export async function getRandomKey(env) {
  const allKeys = await getAllKeys(env);
  if (allKeys.length === 0) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * allKeys.length);
  return allKeys[randomIndex];
}
