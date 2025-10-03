
// scripts/direct_validator.js
import dotenv from 'dotenv';
import { Redis } from '@upstash/redis';
import https from 'https';

// --- 1. Load Environment Variables ---
dotenv.config({ path: '.env.local' });

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error('Error: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in .env.local');
  process.exit(1);
}

// --- 2. Redis Connection ---
let redis;

function getRedisClient() {
  if (!redis) {
    console.log("Attempting to connect to Redis...");
    redis = new Redis({
      url: UPSTASH_REDIS_REST_URL.trim(),
      token: UPSTASH_REDIS_REST_TOKEN.trim(),
    });
  }
  return redis;
}

const KEYS_SET_NAME = 'gemini_keys_set';

async function fetchRandomKey() {
  try {
    const redisClient = getRedisClient();
    console.log("Successfully connected to Redis, fetching key...");
    const randomKey = await redisClient.srandmember(KEYS_SET_NAME);

    if (!randomKey) {
      console.error('Error: The gemini_keys_set is empty or does not exist in Redis.');
      process.exit(1);
    }

    console.log(`Successfully fetched key. Key: ${randomKey.substring(0, 8)}...`);
    return randomKey;
  } catch (error) {
    console.error('Redis connection or fetch failed:', error);
    process.exit(1);
  }
}

// --- 3. Google Gemini API Call ---
async function validateApiKey(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;

  const postData = JSON.stringify({
    'contents': [{
      'parts': [{
        'text': 'Hello, world!'
      }]
    }]
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  console.log(`Requesting URL: ${url}...`);

  const req = https.request(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log('--- API Response ---');
      try {
        console.log(JSON.parse(data));
      } catch (e) {
        console.error("Failed to parse JSON response:", data);
      }
    });
  });

  req.on('error', (e) => {
    console.error('--- API Request Failed ---');
    console.error(e);
  });

  req.write(postData);
  req.end();
}

// --- Main Execution ---
(async () => {
  const apiKey = await fetchRandomKey();
  await validateApiKey(apiKey);
})();
