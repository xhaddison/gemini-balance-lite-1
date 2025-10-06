
import { createClient } from '@vercel/kv';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function getApiKey() {
  try {
    if (!process.env.KV_URL || !process.env.KV_REST_API_TOKEN) {
        throw new Error('KV_URL and KV_REST_API_TOKEN environment variables must be set.');
    }
    const kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const [cursor, keys] = await kv.scan(0);

    if (keys.length === 0) {
      throw new Error('No keys found in Vercel KV store.');
    }

    // Select a random key from the list
    const randomKeyName = keys[Math.floor(Math.random() * keys.length)];
    const apiKey = await kv.get(randomKeyName);

    if (!apiKey) {
      throw new Error(`Value for key '${randomKeyName}' is null or empty.`);
    }

    // Print only the key
    console.log(apiKey);

  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

getApiKey();
