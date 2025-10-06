// diagnose_redis.js
// A one-time script to definitively check the state of our Redis database.

import { Redis } from '@upstash/redis';
import { readFileSync } from 'fs';

import 'dotenv/config';

// --- Environment Loading ---
// Manually parsing is removed. The import above handles everything automatically and correctly.

// --- Main Diagnostics ---
async function runDiagnostics() {
  try {
    console.log('--- Starting Redis Diagnostics (with corrected env loading) ---');

    // The dotenv import above automatically populates process.env from .env.development.local
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

    if (!url || !token) {
      console.error('FATAL: Could not find or parse Redis credentials from .env.development.local');
      return;
    }

    console.log(`Connecting to Redis at: ${url.substring(0, 25)}...`);
    const redis = new Redis({ url, token });

    console.log('Checking state of old key structure...');
    const oldSetKeyCount = await redis.scard('active_keys');
    console.log(`>>> Result for 'active_keys' (Set): ${oldSetKeyCount} keys found.`);

    console.log('Checking state of NEW key structure...');
    const newQueueKeyCount = await redis.llen('keys_queue');
    console.log(`>>> Result for 'keys_queue' (List/Queue): ${newQueueKeyCount} keys found.`);

    console.log('\n--- Diagnostics Complete ---');

    if (oldSetKeyCount > 0 && newQueueKeyCount === 0) {
        console.log('\nCONCLUSION: Keys EXIST in the old Set structure but NOT in the new Queue. Data migration is required and has not run successfully.');
    } else if (oldSetKeyCount === 0 && newQueueKeyCount > 0) {
        console.log('\nCONCLUSION: Keys exist only in the new Queue structure. Data migration appears complete.');
    } else if (oldSetKeyCount === 0 && newQueueKeyCount === 0) {
        console.log('\nCONCLUSION: FATAL - No keys found in EITHER the old or new structure. The database is empty.');
    } else {
        console.log('\nCONCLUSION: Keys found in both structures. This is an inconsistent state that needs cleanup.');
    }

  } catch (error) {
    console.error('\n--- A CRITICAL ERROR OCCURRED DURING DIAGNOSTICS ---');
    console.error(error);
  }
}

runDiagnostics();
