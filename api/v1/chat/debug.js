import { Redis } from '@upstash/redis'; // Revert to the standard library
import { v4 as uuidv4 } from 'uuid';

// REMOVED: `export const config = { runtime: 'edge' };`
// This will cause Vercel to use the default Node.js Serverless Runtime.

// --- Environment Variable Validation ---
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error('FATAL: Server configuration error. UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN environment variables are not set.');
}

// --- Redis Client Initialization (with standard library) ---
const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req) {
  try {
    const result = await redisClient.ping();
    return new Response(`OK - Redis client pinged successfully in Serverless environment. Response: ${result}`);
  } catch (error) {
    // Using toString() for better error details in the response
    return new Response("ERROR - Failed to ping Redis: " + error.toString(), { status: 500 });
  }
}
