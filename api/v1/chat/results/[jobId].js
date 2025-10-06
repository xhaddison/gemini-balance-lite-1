// API Endpoint: /api/v1/chat/results/[jobId]
// Allows clients to poll for the status and result of a submitted task.

import { Redis } from '@upstash/redis';

// --- Redis Client Initialization (re-usable) ---
let redis;
function getRedisClient() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
      throw new Error('Server configuration error: Redis connection credentials are not set.');
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

// --- Constants ---
const JOB_KEY_PREFIX = 'job_';

// --- The Result Polling Handler ---
export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: { message: 'Method Not Allowed' } }), { status: 405 });
  }

  // Vercel populates `request.query` for dynamic routes.
  // The filename `[jobId].js` makes `jobId` available in the query object.
  const { jobId } = request.query;

  if (!jobId || typeof jobId !== 'string') {
    return new Response(JSON.stringify({ error: { message: 'Job ID is required.', type: 'invalid_request_error' } }), { status: 400 });
  }

  try {
    const redisClient = getRedisClient();
    const jobRedisKey = `${JOB_KEY_PREFIX}${jobId}`;

    const jobData = await redisClient.json.get(jobRedisKey, '$');

    if (!jobData || jobData.length === 0) {
      return new Response(JSON.stringify({ error: { message: 'Job not found.', type: 'not_found_error' } }), { status: 404 });
    }

    // redis.json.get returns an array with the root object at index 0
    const task = jobData[0];

    // Sanitize the response to only return what the client needs
    const clientResponse = {
        jobId: task.jobId,
        status: task.status,
        submittedAt: task.submittedAt,
        completedAt: task.completedAt,
        result: task.result,
        error: task.error,
    };

    return new Response(JSON.stringify(clientResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[ResultsHandler] Critical unhandled error for jobId ${jobId}:`, error);
    return new Response(JSON.stringify({ error: { message: 'Internal Server Error.', type: 'internal_error' } }), { status: 500 });
  }
}
