
// load_keys.js
// A one-time script to load API keys from a file into the Redis queue.

import { Redis } from '@upstash/redis';
import { readFileSync } from 'fs';
import 'dotenv/config';

const KEYS_FILE_PATH = '/Users/addison/工具/API Keys/gemini-key.md';
const KEYS_QUEUE_NAME = 'keys_queue';

async function loadKeys() {
  try {
    console.log('--- Starting Key Loading Script ---');

    // 1. Connect to Redis
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

    if (!url || !token) {
      console.error('FATAL: Could not find or parse Redis credentials from .env.development.local');
      return;
    }

    console.log(`Connecting to Redis at: ${url.substring(0, 30)}...`);
    const redis = new Redis({ url, token });

    // 2. Read keys from file
    console.log(`Reading keys from: ${KEYS_FILE_PATH}`);
    const keysFileContent = readFileSync(KEYS_FILE_PATH, 'utf-8');
    const keys = keysFileContent.split('\n').map(k => k.trim()).filter(Boolean);

    if (keys.length === 0) {
      console.error('FATAL: No keys found in the specified file.');
      return;
    }

    console.log(`Found ${keys.length} keys to load.`);

    // 3. Load keys into Redis queue
    console.log(`Loading keys into Redis list: ${KEYS_QUEUE_NAME}`);
    // Use RPUSH to add all keys to the end of the list.
    // The command is sent as a single transaction for efficiency.
    const result = await redis.rpush(KEYS_QUEUE_NAME, ...keys);

    console.log(`Successfully loaded ${result} keys into the queue.`);
    console.log('--- Key Loading Complete ---');

  } catch (error) {
    console.error('An unexpected error occurred during the key loading process:');
    console.error(error);
  }
}

loadKeys();
